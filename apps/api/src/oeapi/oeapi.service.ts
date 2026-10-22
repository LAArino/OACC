// SPDX-License-Identifier: EUPL-1.2
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OeapiAcademicSessionsQuery,
  OeapiCoursesQuery,
  OeapiOfferingsQuery,
  OeapiOrganizationsQuery,
} from '@oecp/schemas';
import { type Clock, READ_API_CLOCK, utcToday } from '../catalogue/clock.js';
import { ProblemException } from '../common/problem.js';
import type { Env } from '../config/env.js';
import { fromIso6392 } from './languages.js';
import {
  type MappingContext,
  OECP_CONSUMER_KEY,
  type OrganizationRow,
  toPage,
  toV5AcademicSession,
  toV5Course,
  toV5Offering,
  toV5Organization,
  toV5OrganizationType,
  type V5AcademicSession,
  type V5Course,
  type V5Offering,
  type V5Organization,
  type V5Page,
} from './oeapi-v5.mapper.js';
import { type CourseFilter, OeapiRepository } from './oeapi.repository.js';

export const OEAPI_SPECIFICATION_URL =
  'https://open-education-api.github.io/specification/v5/docs.html';
export const OEAPI_DOCUMENTATION_URL = 'https://openonderwijsapi.nl/v5/';

/** v5 `level` → canonical levels (`null` = no level). */
const LEVELS: Readonly<Record<string, (string | null)[]>> = {
  bachelor: ['bachelor'],
  master: ['master'],
  doctoral: ['doctoral'],
  'associate degree': ['short_cycle'],
  undefined: ['other', null],
};

export interface OeapiServiceDocument {
  contactEmail: string;
  specification: string;
  documentation: string;
  ext: { oecp: { alliance: string | null; portal: string; publicApi: string } };
}

const notFound = (what: string) =>
  new ProblemException(HttpStatus.NOT_FOUND, 'oecp.request.not_found', `${what} not found`);

@Injectable()
export class OeapiService {
  constructor(
    private readonly repository: OeapiRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(READ_API_CLOCK) private readonly clock: Clock,
  ) {}

  private async context(): Promise<{ ctx: MappingContext; orgs: OrganizationRow[] }> {
    const orgs = await this.repository.organizations();
    const alliance = orgs.find((o) => o.org_type === 'alliance') ?? null;
    const baseUrl = this.config.get('OECP_PUBLIC_BASE_URL', { infer: true });
    return { ctx: { alliance, today: utcToday(this.clock()), baseUrl }, orgs };
  }

  /** v5 `consumer`: OACC serves its own consumer only; any other selects nothing. */
  private foreignConsumer(consumer: string | undefined): boolean {
    return consumer !== undefined && consumer !== OECP_CONSUMER_KEY;
  }

  async service(): Promise<OeapiServiceDocument> {
    const { ctx } = await this.context();
    const base = this.config.get('OECP_PUBLIC_BASE_URL', { infer: true });
    return {
      contactEmail: ctx.alliance?.contact_email ?? this.config.get('SMTP_FROM', { infer: true }),
      specification: OEAPI_SPECIFICATION_URL,
      documentation: OEAPI_DOCUMENTATION_URL,
      ext: {
        oecp: {
          alliance: ctx.alliance?.slug ?? null,
          portal: `${base}/`,
          publicApi: `${base}/api/public/v1`,
        },
      },
    };
  }

  // --- organizations -------------------------------------------------------------

  async organizations(query: OeapiOrganizationsQuery): Promise<V5Page<V5Organization>> {
    const { ctx, orgs } = await this.context();
    if (this.foreignConsumer(query.consumer)) return toPage([], query, 0);
    const q = query.q?.toLocaleLowerCase();
    const name = (o: OrganizationRow) => o.name.en.toLocaleLowerCase();
    const matching = orgs.filter(
      (o) =>
        (!query.organizationType || toV5OrganizationType(o.org_type) === query.organizationType) &&
        (!q ||
          Object.values(o.name).some((n) => n.toLocaleLowerCase().includes(q)) ||
          o.slug.includes(q)),
    );
    const sorts = query.sort.length ? query.sort : ['name'];
    matching.sort((a, b) => {
      for (const s of sorts) {
        const sign = s.startsWith('-') ? -1 : 1;
        const cmp = s.endsWith('name')
          ? name(a).localeCompare(name(b), 'en')
          : a.id.localeCompare(b.id);
        if (cmp !== 0) return sign * cmp;
      }
      return a.id.localeCompare(b.id);
    });
    const start = (query.pageNumber - 1) * query.pageSize;
    const expand = this.orgExpand(query.expand);
    const items = matching
      .slice(start, start + query.pageSize)
      .map((o) => toV5Organization(o, orgs, ctx.alliance, expand));
    return toPage(items, query, matching.length);
  }

  private orgExpand(expand: string[]) {
    return { parent: expand.includes('parent'), children: expand.includes('children') };
  }

  async organization(id: string, expand: string[]): Promise<V5Organization> {
    const { ctx, orgs } = await this.context();
    const org = orgs.find((o) => o.id === id);
    if (!org) throw notFound('Organization');
    return toV5Organization(org, orgs, ctx.alliance, this.orgExpand(expand));
  }

  async organizationCourses(id: string, query: OeapiCoursesQuery): Promise<V5Page<V5Course>> {
    const { ctx, orgs } = await this.context();
    if (!orgs.some((o) => o.id === id)) throw notFound('Organization');
    // The alliance root offers every course of the catalogue.
    const scope = ctx.alliance?.id === id ? undefined : id;
    return this.coursePage(query, { ctx, orgs }, scope);
  }

  // --- courses -------------------------------------------------------------------

  async courses(query: OeapiCoursesQuery): Promise<V5Page<V5Course>> {
    return this.coursePage(query, await this.context());
  }

  private async coursePage(
    query: OeapiCoursesQuery,
    { ctx, orgs }: { ctx: MappingContext; orgs: OrganizationRow[] },
    organizationId?: string,
  ): Promise<V5Page<V5Course>> {
    if (this.foreignConsumer(query.consumer)) return toPage([], query, 0);
    const filter: CourseFilter = { organizationId, q: query.q, modes: query.modeOfDelivery };
    if (query.teachingLanguage) {
      const language = fromIso6392(query.teachingLanguage);
      if (!language) return toPage([], query, 0);
      filter.language = language;
    }
    if (query.level) {
      const levels = LEVELS[query.level];
      if (!levels) return toPage([], query, 0);
      filter.levels = levels;
    }
    const { ids, total } = await this.repository.coursePage(filter, query, query.sort);
    const bundles = await this.repository.courseBundles(ids);
    const expandOrg = query.expand.includes('organization');
    const items = bundles.map((b) =>
      toV5Course(b, ctx, {
        organization: expandOrg
          ? this.expandedOrganization(b.course.organization_id, ctx, orgs)
          : undefined,
      }),
    );
    return toPage(items, query, total);
  }

  private expandedOrganization(
    id: string,
    ctx: MappingContext,
    orgs: OrganizationRow[],
  ): V5Organization | undefined {
    const org = orgs.find((o) => o.id === id);
    return org ? toV5Organization(org, orgs, ctx.alliance) : undefined;
  }

  async course(id: string, expand: string[]): Promise<V5Course> {
    const { ctx, orgs } = await this.context();
    const [bundle] = await this.repository.courseBundles([id]);
    if (!bundle) throw notFound('Course');
    return toV5Course(bundle, ctx, {
      organization: expand.includes('organization')
        ? this.expandedOrganization(bundle.course.organization_id, ctx, orgs)
        : undefined,
    });
  }

  // --- offerings -----------------------------------------------------------------

  /** v5 `since` defaults to today: only offerings starting today or later. */
  async courseOfferings(id: string, query: OeapiOfferingsQuery): Promise<V5Page<V5Offering>> {
    const { ctx } = await this.context();
    const [bundle] = await this.repository.courseBundles([id]);
    if (!bundle) throw notFound('Course');
    if (this.foreignConsumer(query.consumer)) return toPage([], query, 0);
    const { rows, total } = await this.repository.offeringPage(
      id,
      { since: query.since ?? ctx.today, until: query.until },
      query,
      query.sort,
    );
    const sessions = query.expand.includes('academicSession')
      ? await this.sessionMap(rows.map((o) => o.academic_session_id))
      : new Map<string, V5AcademicSession>();
    const course = query.expand.includes('course') ? toV5Course(bundle, ctx) : undefined;
    const items = rows.map((o) =>
      toV5Offering(o, bundle, ctx, {
        academicSession: o.academic_session_id ? sessions.get(o.academic_session_id) : undefined,
        course,
      }),
    );
    return toPage(items, query, total);
  }

  private async sessionMap(ids: (string | null)[]): Promise<Map<string, V5AcademicSession>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    const rows = await this.repository.sessions(unique);
    return new Map(rows.map((s) => [s.id, toV5AcademicSession(s)]));
  }

  async offering(id: string, expand: string[]): Promise<V5Offering> {
    const { ctx } = await this.context();
    const offering = await this.repository.offering(id);
    if (!offering) throw notFound('Offering');
    const [bundle] = await this.repository.courseBundles([offering.course_id]);
    if (!bundle) throw notFound('Offering');
    const sessions =
      expand.includes('academicSession') && offering.academic_session_id
        ? await this.sessionMap([offering.academic_session_id])
        : new Map<string, V5AcademicSession>();
    return toV5Offering(offering, bundle, ctx, {
      academicSession: offering.academic_session_id
        ? sessions.get(offering.academic_session_id)
        : undefined,
      course: expand.includes('course') ? toV5Course(bundle, ctx) : undefined,
    });
  }

  // --- academic sessions ---------------------------------------------------------

  async academicSessions(query: OeapiAcademicSessionsQuery): Promise<V5Page<V5AcademicSession>> {
    if (this.foreignConsumer(query.consumer)) return toPage([], query, 0);
    const { rows, total } = await this.repository.sessionPage(
      {
        sessionType: query.academicSessionType?.replace(/ /g, '_'),
        parent: query.parent,
      },
      query,
      query.sort,
    );
    return toPage(await this.expandSessions(rows, query.expand), query, total);
  }

  async academicSession(id: string, expand: string[]): Promise<V5AcademicSession> {
    const [row] = await this.repository.sessions([id]);
    if (!row) throw notFound('Academic session');
    const [session] = await this.expandSessions([row], expand);
    return session!;
  }

  private async expandSessions(
    rows: Awaited<ReturnType<OeapiRepository['sessions']>>,
    expand: string[],
  ): Promise<V5AcademicSession[]> {
    const parents = expand.includes('parent')
      ? await this.sessionMap(rows.map((s) => s.parent_id))
      : new Map<string, V5AcademicSession>();
    const children = await this.repository.sessionChildren(rows.map((s) => s.id));
    return rows.map((s) =>
      toV5AcademicSession(s, {
        parent: s.parent_id ? parents.get(s.parent_id) : undefined,
        children: children
          .filter((c) => c.parent_id === s.id)
          .map((c) => (expand.includes('children') ? toV5AcademicSession(c) : c.id)),
      }),
    );
  }
}
