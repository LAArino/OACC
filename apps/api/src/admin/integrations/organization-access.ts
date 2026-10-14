// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { ProblemException } from '../../common/problem.js';
import { type Db, KYSELY } from '../../db/db.module.js';
import type { AdminPrincipal } from '../auth/claims.js';

/**
 * Organization scope of admin endpoints (spec §2, §4): `alliance_admin` may act on
 * every organization; `partner_admin` on the organization of its `org_id` claim
 * and that organization's descendants (`parent_id` chain).
 */
@Injectable()
export class OrganizationAccess {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  /** Throws 404 for unknown or deleted organizations and 403 outside the caller's scope. */
  async assert(admin: AdminPrincipal, organizationId: string): Promise<void> {
    const organization = await this.db
      .selectFrom('organizations')
      .select(['id'])
      .where('id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!organization) {
      throw new ProblemException(404, 'oecp.request.not_found', 'Organization not found');
    }
    if (admin.roles.includes('alliance_admin')) return;
    if (admin.roles.includes('partner_admin') && admin.orgId) {
      if (admin.orgId === organizationId) return;
      const { rows } = await sql<{ id: string }>`
        with recursive ancestors(id, parent_id, depth) as (
          select id, parent_id, 0 from organizations where id = ${organizationId}
          union all
          select o.id, o.parent_id, a.depth + 1
          from organizations o join ancestors a on o.id = a.parent_id
          where a.depth < 32
        )
        select id from ancestors where id = ${admin.orgId} limit 1`.execute(this.db);
      if (rows.length > 0) return;
    }
    throw new ProblemException(403, 'oecp.auth.forbidden_organization');
  }

  /**
   * Organizations the caller may read: undefined (all) for an alliance_admin,
   * else the `org_id` organization and its descendants (deleted ones included,
   * so callers can decide whether to show them).
   */
  async scope(admin: AdminPrincipal): Promise<string[] | undefined> {
    if (admin.roles.includes('alliance_admin')) return undefined;
    if (!admin.roles.includes('partner_admin') || !admin.orgId) return [];
    const { rows } = await sql<{ id: string }>`
      with recursive descendants(id, depth) as (
        select id, 0 from organizations where id = ${admin.orgId}
        union all
        select o.id, d.depth + 1
        from organizations o join descendants d on o.parent_id = d.id
        where d.depth < 32
      )
      select distinct id from descendants`.execute(this.db);
    return rows.map((r) => r.id);
  }
}
