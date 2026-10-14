// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ErrorCode } from '@oecp/schemas';
import type { Selectable } from 'kysely';
import type { Env } from '../../config/env.js';
import type { PartnerIntegrationsTable } from '../../db/database.js';
import { SecretError, SecretsService } from '../../secrets/secrets.service.js';
import {
  type OeapiAuth,
  type OeapiClientDeps,
  OeapiError,
  OeapiV5Client,
} from './oeapi-v5.client.js';

export type PartnerIntegrationRow = Selectable<PartnerIntegrationsTable>;

/** Optional transport/DNS overrides (tests). */
export const OEAPI_CLIENT_DEPS = Symbol('OEAPI_CLIENT_DEPS');

export interface OeapiDeploymentSettings {
  gatewayUrl: string;
  surfeduhubSecretRef: string | undefined;
  allowInsecure: boolean;
}

/** `host[:port]` of a URL as compared with `approved_host` (lower case, default port omitted). */
export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether the integration can be harvested at all, without touching secrets or
 * the network: the first blocking problem, or null.
 */
export function integrationBlocker(
  row: PartnerIntegrationRow,
  settings: OeapiDeploymentSettings,
): { code: ErrorCode; detail: string } | null {
  if (row.access_mode === null) {
    return { code: 'oecp.integration.access_mode_required', detail: 'access_mode is not set' };
  }
  if (row.access_mode === 'surfeduhub') {
    if (!row.surfeduhub_endpoint_id) {
      return { code: 'oecp.integration.endpoint_id_required', detail: 'no SURFeduhub endpoint id' };
    }
    if (!settings.surfeduhubSecretRef) {
      return {
        code: 'oecp.integration.surfeduhub_unavailable',
        detail: 'SURFEDUHUB_SECRET_REF is not set',
      };
    }
    return null;
  }
  if (!row.base_url) {
    return { code: 'oecp.integration.base_url_required', detail: 'base_url is not set' };
  }
  const url = new URL(row.base_url);
  const secure = url.protocol === 'https:' && (url.port === '' || url.port === '443');
  if (!secure && !settings.allowInsecure) {
    return {
      code: 'oecp.integration.insecure_url',
      detail: `${row.base_url} is not https on port 443`,
    };
  }
  const host = hostOf(row.base_url);
  if (!row.approved_host || row.approved_host.toLowerCase() !== host) {
    return {
      code: 'oecp.oeapi.host_not_approved',
      detail: `host ${host} awaits alliance_admin approval`,
    };
  }
  return null;
}

/** Builds the OEAPI client of one `partner_integrations` row (credentials decrypted here). */
@Injectable()
export class OeapiClientFactory {
  readonly settings: OeapiDeploymentSettings;

  constructor(
    config: ConfigService<Env, true>,
    private readonly secrets: SecretsService,
    @Optional() @Inject(OEAPI_CLIENT_DEPS) private readonly deps: OeapiClientDeps = {},
  ) {
    this.settings = {
      gatewayUrl: config.get('SURFEDUHUB_GATEWAY_URL', { infer: true }),
      surfeduhubSecretRef: config.get('SURFEDUHUB_SECRET_REF', { infer: true }),
      allowInsecure: config.get('OECP_ALLOW_INSECURE_PARTNER_HTTP', { infer: true }),
    };
  }

  /** Throws {@link OeapiError} when the integration is not runnable or a secret cannot be read. */
  async create(
    row: PartnerIntegrationRow,
    options: { signal?: AbortSignal; pageSize?: number } = {},
  ): Promise<OeapiV5Client> {
    const blocker = integrationBlocker(row, this.settings);
    if (blocker) throw new OeapiError(blocker.code, blocker.detail);
    const common = {
      consumer: row.consumer_profile,
      pageSize: options.pageSize ?? row.page_size,
      maxRequestsPerSecond: Number(row.max_requests_per_second),
      allowInsecure: this.settings.allowInsecure,
      ...(options.signal ? { signal: options.signal } : {}),
    };
    if (row.access_mode === 'surfeduhub') {
      const credential = await this.reveal(this.settings.surfeduhubSecretRef ?? '');
      return new OeapiV5Client(
        {
          ...common,
          baseUrl: this.settings.gatewayUrl,
          allowedHost: hostOf(this.settings.gatewayUrl),
          auth: basic(credential),
          headers: { 'X-Route': `endpoint=${row.surfeduhub_endpoint_id}` },
        },
        this.deps,
      );
    }
    let auth: OeapiAuth = { scheme: 'none' };
    if (row.auth_scheme !== 'none') {
      if (!row.secret_ref) {
        throw new OeapiError('oecp.oeapi.secret_unavailable', 'No credential is stored');
      }
      const secret = await this.reveal(row.secret_ref);
      switch (row.auth_scheme) {
        case 'basic':
          auth = basic(secret);
          break;
        case 'bearer':
          auth = { scheme: 'bearer', token: secret };
          break;
        case 'api_key_header':
          auth = {
            scheme: 'api_key_header',
            headerName: row.api_key_header_name ?? 'X-API-Key',
            value: secret,
          };
          break;
      }
    }
    return new OeapiV5Client(
      { ...common, baseUrl: row.base_url ?? '', allowedHost: row.approved_host, auth },
      this.deps,
    );
  }

  private async reveal(ref: string): Promise<string> {
    try {
      return await this.secrets.reveal(ref);
    } catch (error) {
      if (error instanceof SecretError) {
        throw new OeapiError('oecp.oeapi.secret_unavailable', error.message);
      }
      throw error;
    }
  }
}

function basic(secret: string): OeapiAuth {
  const at = secret.indexOf(':');
  if (at < 0) {
    throw new OeapiError(
      'oecp.oeapi.secret_unavailable',
      'Basic credential is not username:password',
    );
  }
  return { scheme: 'basic', username: secret.slice(0, at), password: secret.slice(at + 1) };
}
