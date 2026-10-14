// SPDX-License-Identifier: EUPL-1.2
import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { AdminOrganization, OrganizationInputValue } from '@oecp/schemas';
import { type Selectable, sql, type Transaction } from 'kysely';
import { ProblemException } from '../../common/problem.js';
import type { Database, OrganizationsTable } from '../../db/database.js';
import { type Db, KYSELY } from '../../db/db.module.js';
import {
  KeycloakAdminService,
  OECP_ORG_ID_ATTRIBUTE,
} from '../../identity/keycloak-admin.service.js';
import type { AdminPrincipal } from '../auth/claims.js';

export const ORGANIZATIONS_CLOCK = Symbol('ORGANIZATIONS_CLOCK');

/** Spec §2: the `parent_id` chain is at most 32 levels deep. */
export const MAX_ORGANIZATION_DEPTH = 32;

type OrganizationRow = Selectable<OrganizationsTable>;
type OrganizationWithCounts = OrganizationRow & {
  courses_total: number | null;
  courses_published: number | null;
  sub_units: number | null;
};

/** Columns written from {@link OrganizationInputValue} (besides `slug` and `partner_id`). */
const INPUT_COLUMNS = [
  'org_type',
  'is_partner',
  'parent_id',
  'name',
  'country_code',
  'schac_home_organization',
  'keycloak_idp_alias',
  'contact_email',
  'default_timezone',
  'ui_languages',
  'website_url',
  'logo_url',
  'erasmus_code',
  'pic',
  'ext_id',
] as const;

/** Unique columns other than `slug` (DDL), checked before writing for a precise 409. */
const UNIQUE_COLUMNS = [
  'schac_home_organization',
  'erasmus_code',
  'pic',
  'keycloak_idp_alias',
] as const;

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

export function toApiOrganization(row: OrganizationWithCounts): AdminOrganization {
  return {
    id: row.id,
    slug: row.slug,
    org_type: row.org_type,
    is_partner: row.is_partner,
    parent_id: row.parent_id,
    partner_id: row.partner_id,
    name: row.name,
    country_code: row.country_code,
    schac_home_organization: row.schac_home_organization,
    keycloak_idp_alias: row.keycloak_idp_alias,
    contact_email: row.contact_email,
    default_timezone: row.default_timezone,
    ui_languages: row.ui_languages,
    website_url: row.website_url,
    logo_url: row.logo_url,
    erasmus_code: row.erasmus_code,
    pic: row.pic,
    ext_id: row.ext_id,
    deleted_at: iso(row.deleted_at),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    counts: {
      courses_total: row.courses_total ?? 0,
      courses_published: row.courses_published ?? 0,
      sub_units: row.sub_units ?? 0,
    },
  };
}

/**
 * Organization management (spec §2, §8 "Organizations"), alliance_admin for
 * writes. The rules of `oecp seed-organizations` apply: a partner is its own
 * partner (`partner_id = id`), sub-units inherit `partner_id` from the nearest
 * partner up the `parent_id` chain; deletion is soft and only of unused
 * organizations.
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly keycloak: KeycloakAdminService,
    @Optional() @Inject(ORGANIZATIONS_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  /** `scope` undefined = every organization. */
  async list(scope: readonly string[] | undefined, includeDeleted: boolean) {
    if (scope?.length === 0) return [];
    let query = this.withCounts(this.db);
    if (scope) query = query.where('o.id', 'in', scope);
    if (!includeDeleted) query = query.where('o.deleted_at', 'is', null);
    const rows = await query
      .orderBy(sql`o.org_type = 'alliance'`, 'desc')
      .orderBy('o.is_partner', 'desc')
      .orderBy('o.slug')
      .execute();
    return rows.map(toApiOrganization);
  }

  /** 404 for unknown ids, and for deleted ones unless `includeDeleted`. */
  async get(id: string, includeDeleted = false): Promise<AdminOrganization> {
    let query = this.withCounts(this.db).where('o.id', '=', id);
    if (!includeDeleted) query = query.where('o.deleted_at', 'is', null);
    const row = await query.executeTakeFirst();
    if (!row) throw notFound();
    return toApiOrganization(row);
  }

  async create(input: OrganizationInputValue, admin: AdminPrincipal): Promise<AdminOrganization> {
    const id = await this.db.transaction().execute(async (trx) => {
      await this.lockOrganizations(trx);
      const existing = await trx
        .selectFrom('organizations')
        .select(['id', 'deleted_at'])
        .where('slug', '=', input.slug)
        .executeTakeFirst();
      if (existing) {
        throw new ProblemException(
          409,
          'oecp.content.duplicate_slug',
          existing.deleted_at
            ? `Slug ${input.slug} belongs to a deleted organization; restore it instead`
            : `Slug ${input.slug} is taken`,
        );
      }
      await this.assertUnique(trx, input, null);
      const parent = await this.checkParent(trx, input.parent_id, null);
      const newId = randomUUID();
      const partnerId = input.is_partner ? newId : (parent?.partner_id ?? null);
      await this.assertExtIdUnique(trx, partnerId, input.ext_id, null);
      await trx
        .insertInto('organizations')
        .values({ id: newId, slug: input.slug, partner_id: partnerId, ...values(input) })
        .execute();
      await trx
        .insertInto('audit_log')
        .values({
          actor_sub: admin.sub,
          actor_org_id: admin.orgId ?? null,
          action: 'organization.create',
          entity_type: 'organization',
          entity_id: newId,
          changes: { slug: input.slug, partner_id: partnerId, ...values(input) },
        })
        .execute();
      return newId;
    });
    this.logger.log(`Organization ${input.slug} (${id}) created by ${admin.sub}`);
    return this.get(id);
  }

  /** Full replace; `slug` must not change. Deleted organizations must be restored first. */
  async update(
    id: string,
    input: OrganizationInputValue,
    admin: AdminPrincipal,
  ): Promise<AdminOrganization> {
    await this.db.transaction().execute(async (trx) => {
      await this.lockOrganizations(trx);
      const before = await trx
        .selectFrom('organizations')
        .selectAll()
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!before) throw notFound();
      if (input.slug !== before.slug) {
        throw new ProblemException(
          409,
          'oecp.content.slug_immutable',
          `The slug is ${before.slug}; it cannot change`,
        );
      }
      await this.assertUnique(trx, input, id);
      const parent = await this.checkParent(trx, input.parent_id, id);
      const partnerId = input.is_partner ? id : (parent?.partner_id ?? null);
      await this.assertExtIdUnique(trx, partnerId, input.ext_id, id);

      const next = { ...values(input), partner_id: partnerId };
      const changes: Record<string, unknown> = {};
      for (const key of [...INPUT_COLUMNS, 'partner_id'] as const) {
        const from = before[key];
        const to = next[key];
        if (canonicalJson(from) !== canonicalJson(to)) changes[key] = { from, to };
      }
      if (Object.keys(changes).length === 0) return;

      await trx.updateTable('organizations').set(next).where('id', '=', id).execute();
      if ('partner_id' in changes) await this.propagatePartner(trx, id);
      if ('keycloak_idp_alias' in changes) {
        changes['note'] =
          'Identity provider changed: administrators of this organization must sign in through ' +
          `${input.keycloak_idp_alias ?? 'a local account'}; tokens with another idp claim are ` +
          'refused (oecp.auth.idp_mismatch) and pending invitation links name the new alias';
      }
      await trx
        .insertInto('audit_log')
        .values({
          actor_sub: admin.sub,
          actor_org_id: admin.orgId ?? null,
          action: 'organization.update',
          entity_type: 'organization',
          entity_id: id,
          changes: { slug: before.slug, ...changes },
        })
        .execute();
    });
    return this.get(id);
  }

  /**
   * Soft delete, refused (409 `oecp.content.organization_in_use`) while the
   * organization has courses, sub-units, administrators (Keycloak users with
   * `oecp_org_id`), pending invitations or an enabled harvest.
   */
  async remove(id: string, admin: AdminPrincipal): Promise<void> {
    const current = await this.db
      .selectFrom('organizations')
      .select(['id'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!current) throw notFound();
    // Outside the transaction: an HTTP call must not hold row locks.
    const admins = (await this.keycloak.findUsersByAttribute(OECP_ORG_ID_ATTRIBUTE, id)).length;

    await this.db.transaction().execute(async (trx) => {
      await this.lockOrganizations(trx);
      const row = await trx
        .selectFrom('organizations')
        .select(['slug'])
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!row) throw notFound();
      const usage = await this.usage(trx, id);
      const reasons = [
        plural(usage.courses, 'course'),
        plural(usage.subUnits, 'sub-unit'),
        plural(admins, 'administrator'),
        plural(usage.pendingInvitations, 'pending invitation'),
        usage.harvestEnabled ? 'an enabled harvest' : null,
      ].filter((r): r is string => r !== null);
      if (reasons.length > 0) {
        throw new ProblemException(
          409,
          'oecp.content.organization_in_use',
          `${row.slug} still has ${reasons.join(', ')}`,
        );
      }
      await trx
        .updateTable('organizations')
        .set({ deleted_at: this.now() })
        .where('id', '=', id)
        .execute();
      await trx
        .insertInto('audit_log')
        .values({
          actor_sub: admin.sub,
          actor_org_id: admin.orgId ?? null,
          action: 'organization.delete',
          entity_type: 'organization',
          entity_id: id,
          changes: { slug: row.slug },
        })
        .execute();
    });
  }

  /** Undeletes; idempotent. A sub-unit of a deleted parent: 409 `oecp.content.invalid_parent`. */
  async restore(id: string, admin: AdminPrincipal): Promise<AdminOrganization> {
    await this.db.transaction().execute(async (trx) => {
      await this.lockOrganizations(trx);
      const row = await trx
        .selectFrom('organizations')
        .select(['slug', 'parent_id', 'deleted_at'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw notFound();
      if (!row.deleted_at) return;
      if (row.parent_id) {
        const parent = await trx
          .selectFrom('organizations')
          .select(['slug', 'deleted_at'])
          .where('id', '=', row.parent_id)
          .executeTakeFirst();
        if (!parent || parent.deleted_at) {
          throw new ProblemException(
            409,
            'oecp.content.invalid_parent',
            `Restore the parent organization ${parent?.slug ?? row.parent_id} first`,
          );
        }
      }
      await trx
        .updateTable('organizations')
        .set({ deleted_at: null })
        .where('id', '=', id)
        .execute();
      await trx
        .insertInto('audit_log')
        .values({
          actor_sub: admin.sub,
          actor_org_id: admin.orgId ?? null,
          action: 'organization.restore',
          entity_type: 'organization',
          entity_id: id,
          changes: { slug: row.slug, deleted_at: { from: iso(row.deleted_at), to: null } },
        })
        .execute();
    });
    return this.get(id);
  }

  private withCounts(db: Db | Transaction<Database>) {
    return db
      .selectFrom('organizations as o')
      .selectAll('o')
      .select((eb) => [
        eb
          .selectFrom('courses as c')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('c.organization_id', '=', 'o.id')
          .where('c.deleted_at', 'is', null)
          .as('courses_total'),
        eb
          .selectFrom('courses as c')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('c.organization_id', '=', 'o.id')
          .where('c.deleted_at', 'is', null)
          .where('c.status', '=', 'published')
          .as('courses_published'),
        eb
          .selectFrom('organizations as s')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('s.parent_id', '=', 'o.id')
          .where('s.deleted_at', 'is', null)
          .as('sub_units'),
      ]);
  }

  /**
   * Organization writes are rare; one transaction-scoped advisory lock makes the
   * parent, cycle and uniqueness checks race-free without locking whole trees.
   */
  private async lockOrganizations(trx: Transaction<Database>): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtext('oecp-organizations'))`.execute(trx);
  }

  private async assertUnique(
    trx: Transaction<Database>,
    input: OrganizationInputValue,
    selfId: string | null,
  ): Promise<void> {
    for (const column of UNIQUE_COLUMNS) {
      const value = input[column];
      if (value === null) continue;
      let query = trx.selectFrom('organizations').select(['slug']).where(column, '=', value);
      if (selfId) query = query.where('id', '<>', selfId);
      const other = await query.executeTakeFirst();
      if (other) {
        throw new ProblemException(
          409,
          'oecp.content.duplicate_identifier',
          `${column} ${value} is already used by organization ${other.slug}`,
        );
      }
    }
  }

  /** DDL UNIQUE (partner_id, ext_id): codes are unique within a partner. */
  private async assertExtIdUnique(
    trx: Transaction<Database>,
    partnerId: string | null,
    extId: string | null,
    selfId: string | null,
  ): Promise<void> {
    if (partnerId === null || extId === null) return;
    let query = trx
      .selectFrom('organizations')
      .select(['slug'])
      .where('partner_id', '=', partnerId)
      .where('ext_id', '=', extId);
    if (selfId) query = query.where('id', '<>', selfId);
    const other = await query.executeTakeFirst();
    if (other) {
      throw new ProblemException(
        409,
        'oecp.content.duplicate_identifier',
        `ext_id ${extId} is already used by organization ${other.slug} of the same partner`,
      );
    }
  }

  /**
   * The parent must exist, not be deleted, not be the organization itself or one
   * of its descendants, and keep the chain within {@link MAX_ORGANIZATION_DEPTH}.
   */
  private async checkParent(
    trx: Transaction<Database>,
    parentId: string | null,
    selfId: string | null,
  ): Promise<{ id: string; partner_id: string | null } | undefined> {
    if (parentId === null) return undefined;
    const invalid = (detail: string) =>
      new ProblemException(422, 'oecp.content.invalid_parent', detail);
    if (parentId === selfId) throw invalid('An organization cannot be its own parent');
    const parent = await trx
      .selectFrom('organizations')
      .select(['id', 'partner_id', 'deleted_at'])
      .where('id', '=', parentId)
      .executeTakeFirst();
    if (!parent) throw invalid('The parent organization does not exist');
    if (parent.deleted_at) throw invalid('The parent organization is deleted');

    const { rows: ancestors } = await sql<{ id: string; depth: number }>`
      with recursive ancestors(id, parent_id, depth) as (
        select id, parent_id, 1 from organizations where id = ${parentId}
        union all
        select o.id, o.parent_id, a.depth + 1
        from organizations o join ancestors a on o.id = a.parent_id
        where a.depth <= ${MAX_ORGANIZATION_DEPTH}
      )
      select id, depth from ancestors`.execute(trx);
    if (selfId && ancestors.some((a) => a.id === selfId)) {
      throw invalid('The parent is a sub-unit of this organization (cycle)');
    }
    const subtreeHeight = selfId ? await this.subtreeHeight(trx, selfId) : 0;
    if (ancestors.length + 1 + subtreeHeight > MAX_ORGANIZATION_DEPTH + 1) {
      throw invalid(`The parent chain would exceed ${MAX_ORGANIZATION_DEPTH} levels`);
    }
    return { id: parent.id, partner_id: parent.partner_id };
  }

  /** Levels below the organization (0 for a leaf). */
  private async subtreeHeight(trx: Transaction<Database>, id: string): Promise<number> {
    const { rows } = await sql<{ height: number }>`
      with recursive descendants(id, depth) as (
        select id, 0 from organizations where id = ${id}
        union all
        select o.id, d.depth + 1 from organizations o join descendants d on o.parent_id = d.id
        where d.depth < ${MAX_ORGANIZATION_DEPTH + 1}
      )
      select max(depth)::int as height from descendants`.execute(trx);
    return rows[0]?.height ?? 0;
  }

  /**
   * Recomputes `partner_id` below `rootId` after its partner changed: each
   * descendant gets the nearest partner up the chain (itself if it is one).
   */
  private async propagatePartner(trx: Transaction<Database>, rootId: string): Promise<void> {
    await sql`
      with recursive tree(id, partner, depth) as (
        select o.id, o.partner_id, 0 from organizations o where o.id = ${rootId}
        union all
        select c.id, case when c.is_partner then c.id else t.partner end, t.depth + 1
        from organizations c join tree t on c.parent_id = t.id
        where t.depth < ${MAX_ORGANIZATION_DEPTH}
      )
      update organizations o set partner_id = t.partner
      from tree t
      where o.id = t.id and t.depth > 0 and o.partner_id is distinct from t.partner`.execute(trx);
  }

  private async usage(trx: Transaction<Database>, id: string) {
    const { rows } = await sql<{
      courses: number;
      sub_units: number;
      pending_invitations: number;
      harvest_enabled: boolean;
    }>`select
        (select count(*)::int from courses where organization_id = ${id} and deleted_at is null) as courses,
        (select count(*)::int from organizations where parent_id = ${id} and deleted_at is null) as sub_units,
        (select count(*)::int from admin_invitations where organization_id = ${id}
           and accepted_at is null and revoked_at is null and expires_at > ${this.now()}) as pending_invitations,
        exists (select 1 from partner_integrations where organization_id = ${id} and enabled) as harvest_enabled`.execute(
      trx,
    );
    const r = rows[0]!;
    return {
      courses: r.courses,
      subUnits: r.sub_units,
      pendingInvitations: r.pending_invitations,
      harvestEnabled: r.harvest_enabled,
    };
  }
}

function values(input: OrganizationInputValue) {
  return {
    org_type: input.org_type,
    is_partner: input.is_partner,
    parent_id: input.parent_id,
    name: input.name,
    country_code: input.country_code,
    schac_home_organization: input.schac_home_organization,
    keycloak_idp_alias: input.keycloak_idp_alias,
    contact_email: input.contact_email,
    default_timezone: input.default_timezone,
    ui_languages: input.ui_languages,
    website_url: input.website_url,
    logo_url: input.logo_url,
    erasmus_code: input.erasmus_code,
    pic: input.pic,
    ext_id: input.ext_id,
  };
}

/** JSON with object keys sorted (jsonb does not keep key order). */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function notFound(): ProblemException {
  return new ProblemException(404, 'oecp.request.not_found', 'Organization not found');
}

function plural(n: number, noun: string): string | null {
  if (n === 0) return null;
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
