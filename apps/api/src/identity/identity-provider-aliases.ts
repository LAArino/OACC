// SPDX-License-Identifier: EUPL-1.2
import { Injectable, Logger } from '@nestjs/common';
import { isIdpAlias } from '@oecp/schemas';
import { KeycloakAdminService } from './keycloak-admin.service.js';

/** How long the set of enabled aliases is reused. */
export const IDP_ALIASES_TTL_MS = 5 * 60 * 1000;
/** After a failure, Keycloak is not asked again for this long. */
export const IDP_ALIASES_RETRY_MS = 30 * 1000;

export const IDENTITY_PROVIDER_ALIASES = Symbol('IDENTITY_PROVIDER_ALIASES');

/** Aliases of the realm's enabled identity providers, or null when unknown. */
export interface IdentityProviderAliasesPort {
  enabled(): Promise<ReadonlySet<string> | null>;
}

/**
 * Cached set of enabled Keycloak identity provider aliases, so the public
 * reference names only IdPs Keycloak can route to (`kc_idp_hint`). Fails open:
 * when Keycloak does not answer, the last known set is used if there is one,
 * else null (no alias is exposed).
 */
@Injectable()
export class IdentityProviderAliases implements IdentityProviderAliasesPort {
  private readonly logger = new Logger(IdentityProviderAliases.name);
  private cached: { aliases: ReadonlySet<string>; expiresAt: number } | undefined;
  private retryAfter = 0;
  private pending: Promise<ReadonlySet<string> | null> | undefined;

  constructor(
    private readonly keycloak: KeycloakAdminService,
    private readonly now: () => number = Date.now,
  ) {}

  async enabled(): Promise<ReadonlySet<string> | null> {
    const now = this.now();
    if (this.cached && this.cached.expiresAt > now) return this.cached.aliases;
    if (now < this.retryAfter) return this.cached?.aliases ?? null;
    this.pending ??= this.refresh().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async refresh(): Promise<ReadonlySet<string> | null> {
    try {
      const providers = await this.keycloak.listIdentityProviders();
      const aliases = new Set(
        providers.filter((p) => p.enabled !== false && isIdpAlias(p.alias)).map((p) => p.alias),
      );
      this.cached = { aliases, expiresAt: this.now() + IDP_ALIASES_TTL_MS };
      return aliases;
    } catch (error) {
      this.retryAfter = this.now() + IDP_ALIASES_RETRY_MS;
      this.logger.warn(
        `Identity providers unavailable (${(error as Error).message}); ` +
          (this.cached ? 'using the last known aliases' : 'no IdP alias is published'),
      );
      return this.cached?.aliases ?? null;
    }
  }
}
