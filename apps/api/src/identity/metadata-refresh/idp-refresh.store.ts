// SPDX-License-Identifier: EUPL-1.2
import type { Db } from '../../db/db.module.js';
import {
  IDP_METADATA_REFRESH_ACTOR,
  IDP_METADATA_REFRESH_AUDIT_ACTION,
} from './idp-metadata-refresh.constants.js';

export const IDP_REFRESH_STORE = Symbol('IDP_REFRESH_STORE');

export interface PartnerIdp {
  organizationId: string;
  slug: string;
  alias: string;
}

/** Database side of the refresh (a port, so the job is testable without PostgreSQL). */
export interface IdpRefreshStore {
  /** Organizations (not deleted) with a `keycloak_idp_alias`, by alias. */
  partnerIdps(): Promise<PartnerIdp[]>;
  /** One `audit_log` row `idp.metadata_refresh` per updated alias (no certificate bodies). */
  auditUpdate(organizationId: string, changes: Record<string, unknown>): Promise<void>;
}

export class KyselyIdpRefreshStore implements IdpRefreshStore {
  constructor(private readonly db: Db) {}

  async partnerIdps(): Promise<PartnerIdp[]> {
    const rows = await this.db
      .selectFrom('organizations')
      .select(['id', 'slug', 'keycloak_idp_alias'])
      .where('keycloak_idp_alias', 'is not', null)
      .where('deleted_at', 'is', null)
      .orderBy('keycloak_idp_alias')
      .execute();
    return rows.map((r) => ({ organizationId: r.id, slug: r.slug, alias: r.keycloak_idp_alias! }));
  }

  async auditUpdate(organizationId: string, changes: Record<string, unknown>): Promise<void> {
    await this.db
      .insertInto('audit_log')
      .values({
        actor_sub: IDP_METADATA_REFRESH_ACTOR,
        actor_org_id: null,
        action: IDP_METADATA_REFRESH_AUDIT_ACTION,
        entity_type: 'organization',
        entity_id: organizationId,
        changes,
      })
      .execute();
  }
}
