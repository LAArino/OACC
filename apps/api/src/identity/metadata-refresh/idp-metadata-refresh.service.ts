// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RunMetricsService } from '../../metrics/run-metrics.service.js';
import {
  type KeycloakIdentityProviderRepresentation,
  KeycloakAdminService,
} from '../keycloak-admin.service.js';
import {
  applyChanges,
  changedKeys,
  describeChange,
  desiredConfig,
  type ManagedKey,
} from './idp-config-diff.js';
import { IDP_METADATA_REFRESH_JOB } from './idp-metadata-refresh.constants.js';
import {
  IDP_METADATA_SETTINGS,
  type IdpMetadataSettings,
} from './idp-metadata-refresh.settings.js';
import { IDP_REFRESH_STORE, type IdpRefreshStore, type PartnerIdp } from './idp-refresh.store.js';
import { type LoadedAggregate, MetadataAggregateSource } from './metadata-aggregate.source.js';
import { extractIdpMetadata } from './saml-metadata.js';

export type IdpRefreshStatus = 'updated' | 'unchanged' | 'skipped' | 'failed';

export interface IdpRefreshResult {
  alias: string;
  organizationId: string | undefined;
  entityId: string | undefined;
  status: IdpRefreshStatus;
  /** Keys written (or, in a dry run, that would be written). */
  changes: ManagedKey[];
  warnings: string[];
  /** Reason of a `failed` or `skipped` status. */
  error?: string;
}

export interface IdpRefreshOptions {
  /** Compute and report the changes without writing to Keycloak or the audit log. */
  dryRun?: boolean;
  /** Restrict the run to these aliases (CLI `--alias`). */
  aliases?: readonly string[];
  /** Use a local aggregate instead of `OECP_IDP_METADATA_URL` (CLI `--file`). */
  file?: string;
  /** Verify the local file's signature; false only with `file` (CLI `--no-verify`). */
  verify?: boolean;
  /** Reuse a cached aggregate younger than this instead of downloading (start-up run). */
  reuseCacheMaxAgeMs?: number;
}

export interface IdpRefreshOutcome {
  /** `not_configured`: no URL and no file, nothing done. */
  status: 'completed' | 'not_configured';
  dryRun: boolean;
  aggregate?: {
    kind: LoadedAggregate['kind'];
    location: string;
    verified: boolean;
    sha256: string;
    bytes: number;
    entityCount: number;
    validUntil: string | null;
    fetchedAt: string | null;
  };
  /** Set when no usable aggregate could be obtained (every alias that needed it failed). */
  aggregateError?: string;
  warnings: string[];
  results: IdpRefreshResult[];
}

/** Whether the outcome must be reported as a failure (alert, CLI exit 1, failed job). */
export const outcomeFailed = (outcome: IdpRefreshOutcome): boolean =>
  outcome.aggregateError !== undefined || outcome.results.some((r) => r.status === 'failed');

/** Optional clock override (tests). */
export const IDP_REFRESH_CLOCK = Symbol('IDP_REFRESH_CLOCK');

interface Candidate {
  partner: PartnerIdp;
  result: IdpRefreshResult;
  entityId: string;
}

/**
 * The `idp-metadata-refresh` job (spec §4): keeps every partner's Keycloak SAML
 * IdP (signing certificates, SSO/SLO endpoints and their binding flags) in line
 * with the verified federation aggregate. Writes only changed managed keys, one
 * alias at a time; a failure for one alias never stops the others, and on any
 * failure the current Keycloak configuration is kept.
 */
@Injectable()
export class IdpMetadataRefreshService {
  private readonly logger = new Logger(IdpMetadataRefreshService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(IDP_METADATA_SETTINGS) private readonly settings: IdpMetadataSettings,
    @Inject(IDP_REFRESH_STORE) private readonly store: IdpRefreshStore,
    private readonly keycloak: KeycloakAdminService,
    private readonly source: MetadataAggregateSource,
    @Optional() @Inject(IDP_REFRESH_CLOCK) clock?: () => Date,
    /** Worker only (spec §10 metrics); absent in the CLI. */
    @Optional() private readonly metrics?: RunMetricsService,
  ) {
    this.now = clock ?? (() => new Date());
  }

  async runOnce(options: IdpRefreshOptions = {}): Promise<IdpRefreshOutcome> {
    const dryRun = options.dryRun ?? false;
    const verify = options.verify ?? true;
    if (!verify && !options.file) {
      throw new Error('Signature verification can only be skipped for a local file');
    }
    const outcome: IdpRefreshOutcome = { status: 'completed', dryRun, warnings: [], results: [] };
    if (!options.file && !this.settings.url) {
      this.logger.log(
        `${IDP_METADATA_REFRESH_JOB}: OECP_IDP_METADATA_URL is not set, nothing to do`,
      );
      return { ...outcome, status: 'not_configured' };
    }

    const candidates = await this.candidates(options, outcome.results);
    if (candidates.length > 0) {
      const now = this.now();
      let aggregate: LoadedAggregate | undefined;
      try {
        const load = { wanted: new Set(candidates.map((c) => c.entityId)), now };
        aggregate = options.file
          ? await this.source.fromFile(options.file, verify, load)
          : await this.source.fromUrl({ ...load, reuseCacheMaxAgeMs: options.reuseCacheMaxAgeMs });
      } catch (error) {
        outcome.aggregateError = (error as Error).message;
        this.logger.error(
          `${IDP_METADATA_REFRESH_JOB}: no usable aggregate: ${outcome.aggregateError}`,
        );
        for (const c of candidates) {
          Object.assign(c.result, {
            status: 'failed',
            error: `metadata unavailable: ${outcome.aggregateError}`,
          });
        }
      }
      if (aggregate) {
        outcome.aggregate = summary(aggregate);
        outcome.warnings.push(...aggregate.warnings);
        for (const c of candidates) {
          await this.refreshOne(c, aggregate, dryRun, now);
        }
      }
    }

    outcome.results.sort((a, b) => a.alias.localeCompare(b.alias));
    this.logSummary(outcome);
    if (!dryRun && !outcomeFailed(outcome)) this.metrics?.idpRefreshSucceeded(this.now());
    return outcome;
  }

  /** Reads each partner's Keycloak IdP; records skipped/failed results, returns the rest. */
  private async candidates(
    options: IdpRefreshOptions,
    results: IdpRefreshResult[],
  ): Promise<Candidate[]> {
    let partners = await this.store.partnerIdps();
    if (options.aliases?.length) {
      const wanted = new Set(options.aliases);
      for (const alias of wanted) {
        if (!partners.some((p) => p.alias === alias)) {
          results.push(
            blank(alias, undefined, 'failed', 'no organization has this keycloak_idp_alias'),
          );
        }
      }
      partners = partners.filter((p) => wanted.has(p.alias));
    }
    const candidates: Candidate[] = [];
    for (const partner of partners) {
      const result = blank(partner.alias, partner.organizationId, 'unchanged');
      results.push(result);
      let idp: KeycloakIdentityProviderRepresentation | undefined;
      try {
        idp = await this.keycloak.getIdentityProvider(partner.alias);
      } catch (error) {
        Object.assign(result, { status: 'failed', error: (error as Error).message });
        continue;
      }
      const skip = (reason: string) => Object.assign(result, { status: 'skipped', error: reason });
      if (!idp) {
        skip('identity provider not found in Keycloak');
        continue;
      }
      if (idp.providerId !== 'saml') {
        skip(`not a SAML identity provider (${idp.providerId ?? 'unknown'})`);
        continue;
      }
      if (idp.enabled === false && !this.settings.includeDisabled) {
        skip('identity provider disabled (OECP_IDP_METADATA_INCLUDE_DISABLED=false)');
        continue;
      }
      const entityId = idp.config?.idpEntityId?.trim();
      if (!entityId) {
        skip('idpEntityId is not configured');
        continue;
      }
      result.entityId = entityId;
      candidates.push({ partner, result, entityId });
    }
    return candidates;
  }

  private async refreshOne(
    { partner, result, entityId }: Candidate,
    aggregate: LoadedAggregate,
    dryRun: boolean,
    now: Date,
  ): Promise<void> {
    try {
      if (aggregate.scan.duplicates.has(entityId)) {
        throw new Error(`entity ${entityId} occurs more than once in the aggregate`);
      }
      const entity = aggregate.scan.entities.get(entityId);
      if (!entity) throw new Error(`entity ${entityId} not found in the aggregate`);
      if (entity.validUntil && entity.validUntil <= now) {
        throw new Error(
          `entity ${entityId} expired (validUntil ${entity.validUntil.toISOString()})`,
        );
      }
      const metadata = extractIdpMetadata(entity.element);

      // Re-read just before writing: the download may have taken a while.
      const idp = await this.keycloak.getIdentityProvider(partner.alias);
      if (!idp) throw new Error('identity provider disappeared from Keycloak');
      const current = idp.config ?? {};
      if ((current.idpEntityId ?? '').trim() !== entityId) {
        throw new Error('idpEntityId changed in Keycloak during the run');
      }
      const target = desiredConfig(metadata, current, now);
      result.warnings.push(...target.warnings);
      const keys = changedKeys(current, target.desired);
      result.changes = keys;
      if (keys.length === 0) {
        result.status = 'unchanged';
        return;
      }
      result.status = 'updated';
      if (dryRun) return;

      await this.keycloak.updateIdentityProvider(partner.alias, {
        ...idp,
        config: applyChanges(current, target.desired, keys),
      });
      const changes = Object.fromEntries(
        keys.map((k) => [k, describeChange(k, current, target.desired)]),
      );
      try {
        await this.store.auditUpdate(partner.organizationId, {
          alias: partner.alias,
          idp_entity_id: entityId,
          keys,
          changes,
          source: aggregate.kind,
          aggregate_sha256: aggregate.scan.sha256,
        });
      } catch (error) {
        // Keycloak is already updated: report, but do not mark the alias failed.
        result.warnings.push(`audit row not written: ${(error as Error).message}`);
        this.logger.error(
          `Audit of the ${partner.alias} IdP update failed: ${(error as Error).message}`,
        );
      }
    } catch (error) {
      Object.assign(result, { status: 'failed', changes: [], error: (error as Error).message });
    }
  }

  private logSummary(outcome: IdpRefreshOutcome): void {
    const count = (s: IdpRefreshStatus) => outcome.results.filter((r) => r.status === s).length;
    for (const r of outcome.results) {
      const line = `${r.alias}: ${r.status}${r.changes.length ? ` [${r.changes.join(', ')}]` : ''}${r.error ? ` (${r.error})` : ''}`;
      if (r.status === 'failed') this.logger.error(line);
      else if (r.status === 'skipped' || r.warnings.length)
        this.logger.warn(r.warnings.length ? `${line}; ${r.warnings.join('; ')}` : line);
      else this.logger.log(line);
    }
    const message =
      `${IDP_METADATA_REFRESH_JOB}${outcome.dryRun ? ' (dry run)' : ''}: ` +
      `${count('updated')} ${outcome.dryRun ? 'to update' : 'updated'}, ${count('unchanged')} unchanged, ` +
      `${count('skipped')} skipped, ${count('failed')} failed` +
      (outcome.aggregate ? ` (aggregate from ${outcome.aggregate.kind})` : '');
    if (outcomeFailed(outcome)) this.logger.error(message);
    else this.logger.log(message);
  }
}

function blank(
  alias: string,
  organizationId: string | undefined,
  status: IdpRefreshStatus,
  error?: string,
): IdpRefreshResult {
  return {
    alias,
    organizationId,
    entityId: undefined,
    status,
    changes: [],
    warnings: [],
    ...(error ? { error } : {}),
  };
}

function summary(aggregate: LoadedAggregate): NonNullable<IdpRefreshOutcome['aggregate']> {
  return {
    kind: aggregate.kind,
    location: aggregate.location,
    verified: aggregate.verified,
    sha256: aggregate.scan.sha256,
    bytes: aggregate.scan.bytes,
    entityCount: aggregate.scan.entityCount,
    validUntil: aggregate.scan.validUntil?.toISOString() ?? null,
    fetchedAt: aggregate.fetchedAt?.toISOString() ?? null,
  };
}
