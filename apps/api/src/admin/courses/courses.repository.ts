// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminCourse,
  type AdminCourseList,
  type AdminCourseListQuery,
  type AdminHistoryEntry,
  type AdminOffering,
  type AdminOverrideMeta,
  type AdminReference,
  COURSE_KIND_LABELS,
  courseKind,
  type CourseKind,
  courseLevel,
  type CourseLevel,
  FORM_LANGUAGES,
  type FormMode,
  type SessionType,
  type SourceChannel,
} from '@oecp/schemas';
import { type Kysely, sql } from 'kysely';
import { loadAttributeDefinitions } from '../../attributes/attribute-definitions.js';
import type { Database, OverrideMap } from '../../db/database.js';
import { type Db, KYSELY } from '../../db/db.module.js';
import { HARVESTER_ACTOR } from '../../ingestion/canonical-writer.service.js';
import { loadCompleteness } from '../../ingestion/handbook-completeness.js';
import { courseImageFromRow } from '../../media/course-image.service.js';

/** A database handle or a transaction (both are `Kysely<Database>`). */
export type Reader = Kysely<Database>;

const iso = (d: Date | string): string => new Date(d).toISOString();
const isoOrNull = (d: Date | string | null): string | null => (d === null ? null : iso(d));
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

/** Stored override value → API shape (ISCED codes become `{code, is_primary}`). */
export function overrideValueToApi(key: string, value: unknown): unknown {
  if (key === 'isced_codes' && Array.isArray(value)) {
    return value.map((code, i) => ({ code: String(code), is_primary: i === 0 }));
  }
  return value ?? null;
}

interface ApiOverrides {
  overrides: Record<string, unknown>;
  override_meta: Record<string, AdminOverrideMeta>;
  source_values: Record<string, unknown>;
}

/** `overrides`, `override_meta` and `source_values` of a response, keys prefixed (`texts.de.`). */
function overridesToApi(map: OverrideMap | null | undefined, prefix = ''): ApiOverrides {
  const out: ApiOverrides = { overrides: {}, override_meta: {}, source_values: {} };
  const { overrides, override_meta, source_values } = out;
  for (const [field, entry] of Object.entries(map ?? {})) {
    const key = `${prefix}${field}`;
    overrides[key] = overrideValueToApi(field, entry.value);
    override_meta[key] = { by: entry.by, at: iso(entry.at) };
    // Entries without a recorded source (before sources were recorded) have none to show.
    if ('source' in entry) source_values[key] = overrideValueToApi(field, entry.source);
  }
  return out;
}

const CHANNEL_NAMES: Readonly<Record<SourceChannel, string>> = {
  oeapi: 'OEAPI',
  csv: 'CSV',
  form: 'form',
};

const list = (v: unknown): string =>
  Array.isArray(v) && v.length > 0 ? v.map(String).join(', ') : '';

/** One English line for an audit row of a course or offering. */
export function auditSummary(action: string, changes: Record<string, unknown>): string {
  const [entity, verb] = action.split('.');
  const subject = entity === 'course_offering' ? 'Offering' : 'Course';
  const status = changes['status'] as { from?: unknown; to?: unknown } | string | undefined;
  const transition =
    status && typeof status === 'object' ? `${String(status.from)} → ${String(status.to)}` : '';
  switch (verb) {
    case 'create':
      return `${subject} created${changes['revived'] ? ' again (was deleted)' : ''}`;
    case 'update': {
      const fields = list(changes['fields']);
      return fields ? `${subject} updated: ${fields}` : `${subject} saved without changes`;
    }
    case 'status': {
      const missing = list(changes['missing']);
      if (changes['publish_rule'] && missing) {
        return `Status ${transition}: IT Handbook fields missing (${missing})`;
      }
      return transition ? `Status ${transition}` : `${subject} status set`;
    }
    case 'overrides': {
      const set = list(changes['set']);
      const clear = list(changes['clear']);
      return [set && `Overrides set: ${set}`, clear && `overrides removed: ${clear}`]
        .filter(Boolean)
        .join('; ');
    }
    case 'delete':
      return `${subject} deleted`;
    case 'image_set':
      if (changes['metadata_only']) return `Image details updated: ${list(changes['fields'])}`;
      return changes['channel'] === 'csv'
        ? 'Image set from the CSV image_url'
        : changes['previous_key']
          ? 'Image replaced'
          : 'Image set';
    case 'image_removed':
      return 'Image removed';
    case 'withdraw':
      return `Withdrawn after ${String(changes['absent_count'] ?? 'repeated')} absences from the harvest`;
    case 'republish':
      return `Republished: seen again by the harvest (${transition})`;
    default:
      return action;
  }
}

/** Organization fields the form needs: default time zone and authoritative channel. */
export interface FormOrganization {
  id: string;
  default_timezone: string;
  authoritative_channel: SourceChannel | null;
  form_mode: FormMode;
}

/** Reads of Channel C: reference data, course list, course and offering documents, history. */
@Injectable()
export class CoursesRepository {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  /** Undefined for unknown or deleted organizations. */
  async organization(id: string, db: Reader = this.db): Promise<FormOrganization | undefined> {
    const row = await db
      .selectFrom('organizations as o')
      .leftJoin('partner_integrations as pi', 'pi.organization_id', 'o.id')
      .select(['o.id', 'o.default_timezone', 'pi.authoritative_channel'])
      .where('o.id', '=', id)
      .where('o.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return undefined;
    const channel = row.authoritative_channel ?? null;
    return {
      id: row.id,
      default_timezone: row.default_timezone,
      authoritative_channel: channel,
      form_mode: channel === 'oeapi' ? 'overrides' : 'write',
    };
  }

  async reference(organization: FormOrganization): Promise<AdminReference> {
    const [modes, isced, definitions, sessions, units] = await Promise.all([
      this.db
        .selectFrom('delivery_modes')
        .select(['code', 'label'])
        .where('active', '=', true)
        .orderBy('sort_order')
        .orderBy('code')
        .execute(),
      this.db.selectFrom('isced_broad_fields').select(['code', 'label']).orderBy('code').execute(),
      loadAttributeDefinitions(this.db),
      this.db
        .selectFrom('academic_sessions')
        .select(['id', 'ext_id', 'name', 'session_type', 'start_date', 'end_date'])
        .where('organization_id', '=', organization.id)
        .where('deleted_at', 'is', null)
        .orderBy('start_date', 'desc')
        .orderBy('ext_id')
        .execute(),
      this.teachingUnits(organization.id),
    ]);
    return {
      organization_id: organization.id,
      default_timezone: organization.default_timezone,
      levels: [...courseLevel.options],
      kinds: courseKind.options.map((code) => ({
        code,
        label: { en: COURSE_KIND_LABELS[code] },
      })),
      delivery_modes: modes.map((m) => ({ code: m.code, label: m.label })),
      isced_broad_fields: isced.map((f) => ({ code: f.code, label: f.label })),
      languages: FORM_LANGUAGES.map((l) => ({ tag: l.tag, label: { en: l.label } })),
      attribute_definitions: definitions,
      academic_sessions: sessions.map((s) => ({
        id: s.id,
        ext_id: s.ext_id,
        name: s.name,
        session_type: s.session_type as SessionType,
        start_date: s.start_date,
        end_date: s.end_date,
      })),
      teaching_units: units,
      authoritative_channel: organization.authoritative_channel,
      form_mode: organization.form_mode,
    };
  }

  /** Non-deleted descendants with an `ext_id` (first by depth when codes repeat). */
  private async teachingUnits(
    organizationId: string,
  ): Promise<
    { id: string; ext_id: string; name: AdminReference['teaching_units'][number]['name'] }[]
  > {
    const { rows } = await sql<{
      id: string;
      ext_id: string;
      name: AdminReference['teaching_units'][number]['name'];
    }>`
      with recursive descendants(id, depth) as (
        select id, 0 from organizations where id = ${organizationId}
        union all
        select o.id, d.depth + 1
        from organizations o join descendants d on o.parent_id = d.id
        where d.depth < 32
      )
      select o.id, o.ext_id, o.name
      from organizations o join descendants d on d.id = o.id
      where o.id <> ${organizationId} and o.ext_id is not null and o.deleted_at is null
      order by d.depth, o.created_at`.execute(this.db);
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.ext_id) && seen.add(r.ext_id));
  }

  async list(organizationId: string, query: AdminCourseListQuery): Promise<AdminCourseList> {
    let base = this.db
      .selectFrom('courses as c')
      .where('c.organization_id', '=', organizationId)
      .where('c.deleted_at', 'is', null);
    if (query.status.length > 0) base = base.where('c.status', 'in', query.status);
    if (query.kind.length > 0) base = base.where('c.kind', 'in', query.kind);
    if (query.source_channel.length > 0) {
      base = base.where('c.source_channel', 'in', query.source_channel);
    }
    if (query.q) {
      const pattern = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
      base = base.where((eb) =>
        eb.or([
          eb('c.ext_id', 'ilike', pattern),
          eb.exists(
            eb
              .selectFrom('course_texts as t')
              .select(sql`1`.as('one'))
              .whereRef('t.course_id', '=', 'c.id')
              .where('t.title', 'ilike', pattern),
          ),
        ]),
      );
    }
    const [total, rows] = await Promise.all([
      base.select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow(),
      base
        .select([
          'c.id',
          'c.ext_id',
          'c.kind',
          'c.status',
          'c.source_channel',
          'c.ects',
          'c.levels',
          'c.updated_at',
          sql<{ title: string; lang: string } | null>`(
            select json_build_object('title', t.title, 'lang', t.lang) from course_texts t
            where t.course_id = c.id order by (t.lang = 'en') desc, t.lang limit 1)`.as('title'),
          sql<string>`(select count(*) from course_offerings o
            where o.course_id = c.id and o.deleted_at is null)`.as('offerings_count'),
          sql<boolean>`(c.overrides <> '{}'::jsonb
            or exists (select 1 from course_texts t
                       where t.course_id = c.id and t.overrides <> '{}'::jsonb)
            or exists (select 1 from course_offerings o where o.course_id = c.id
                       and o.deleted_at is null and o.overrides <> '{}'::jsonb))`.as(
            'has_overrides',
          ),
          sql<string | null>`(select min(o.start_date) from course_offerings o
            where o.course_id = c.id and o.deleted_at is null
              and o.status in ('draft', 'published') and o.start_date >= current_date)`.as(
            'next_start_date',
          ),
        ])
        .orderBy('c.updated_at', 'desc')
        .orderBy('c.id')
        .limit(query.page_size)
        .offset((query.page - 1) * query.page_size)
        .execute(),
    ]);
    const completeness = await loadCompleteness(
      this.db,
      rows.map((r) => r.id),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        ext_id: r.ext_id,
        kind: r.kind,
        status: r.status,
        source_channel: r.source_channel,
        title: r.title?.title ?? null,
        title_lang: r.title?.lang ?? null,
        ects: Number(r.ects),
        levels: r.levels as CourseLevel[],
        updated_at: iso(r.updated_at),
        offerings_count: Number(r.offerings_count),
        has_overrides: r.has_overrides,
        complete: completeness.get(r.id)?.complete ?? false,
        missing_count: completeness.get(r.id)?.missing.length ?? 0,
        next_start_date: r.next_start_date,
      })),
      page: query.page,
      page_size: query.page_size,
      total: Number(total.n),
    };
  }

  /** Organization of a non-deleted course. */
  async courseOrganization(id: string): Promise<string | undefined> {
    return (
      await this.db
        .selectFrom('courses')
        .select('organization_id')
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()
    )?.organization_id;
  }

  /** Organization and course of a non-deleted offering of a non-deleted course. */
  async offeringScope(
    id: string,
  ): Promise<{ organizationId: string; courseId: string } | undefined> {
    const row = await this.db
      .selectFrom('course_offerings as o')
      .innerJoin('courses as c', 'c.id', 'o.course_id')
      .select(['c.organization_id', 'c.id'])
      .where('o.id', '=', id)
      .where('o.deleted_at', 'is', null)
      .where('c.deleted_at', 'is', null)
      .executeTakeFirst();
    return row && { organizationId: row.organization_id, courseId: row.id };
  }

  /** The course as the admin UI shows it; undefined when unknown or deleted. */
  async course(id: string, db: Reader = this.db): Promise<AdminCourse | undefined> {
    const row = await db
      .selectFrom('courses as c')
      .leftJoin('organizations as tu', 'tu.id', 'c.teaching_unit_id')
      .selectAll('c')
      .select('tu.ext_id as teaching_unit_ext_id')
      .where('c.id', '=', id)
      .where('c.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return undefined;
    const [texts, isced, offerings] = await Promise.all([
      db
        .selectFrom('course_texts')
        .select([
          'lang',
          'title',
          'abstract',
          'description',
          'learning_outcomes',
          'prerequisites',
          'assessment',
          'mode_of_repetition',
          'methods',
          'literature',
          'privacy_notice',
          'remarks',
          'keywords',
          'is_machine_translated',
          'overrides',
        ])
        .where('course_id', '=', id)
        .orderBy('lang')
        .execute(),
      db
        .selectFrom('course_isced_codes')
        .select(['isced_code', 'is_primary'])
        .where('course_id', '=', id)
        .orderBy('is_primary', 'desc')
        .orderBy('isced_code')
        .execute(),
      this.offerings(db, { courseId: id }),
    ]);
    const completeness = (await loadCompleteness(db, [id])).get(id) ?? {
      complete: false,
      missing: [],
    };
    const course = overridesToApi(row.overrides);
    const textMap: AdminCourse['texts'] = {};
    for (const { lang, overrides, ...text } of texts) {
      textMap[lang] = text;
      const t = overridesToApi(overrides, `texts.${lang}.`);
      Object.assign(course.overrides, t.overrides);
      Object.assign(course.override_meta, t.override_meta);
      Object.assign(course.source_values, t.source_values);
    }
    return {
      id: row.id,
      organization_id: row.organization_id,
      ext_id: row.ext_id,
      source_ref: row.source_ref,
      source_channel: row.source_channel,
      status: row.status,
      kind: row.kind as CourseKind,
      level: row.level as CourseLevel | null,
      levels: row.levels as CourseLevel[],
      eqf_level: row.eqf_level,
      ects: Number(row.ects),
      teaching_hours: num(row.teaching_hours),
      info_url: row.info_url,
      contact_email: row.contact_email,
      teaching_unit_id: row.teaching_unit_id,
      teaching_unit_ext_id: row.teaching_unit_ext_id ?? null,
      isced_codes: isced.map((c) => ({ code: c.isced_code, is_primary: c.is_primary })),
      instructors: row.instructors,
      attributes: row.attributes,
      texts: textMap,
      image: courseImageFromRow(row),
      completeness,
      overrides: course.overrides,
      override_meta: course.override_meta,
      source_values: course.source_values,
      offerings,
      absent_count: row.absent_count,
      created_at: iso(row.created_at),
      updated_at: iso(row.updated_at),
      last_seen_at: isoOrNull(row.last_seen_at),
    };
  }

  async offering(id: string, db: Reader = this.db): Promise<AdminOffering | undefined> {
    return (await this.offerings(db, { offeringId: id }))[0];
  }

  /** Non-deleted offerings of a course (by start date), or one offering. */
  private async offerings(
    db: Reader,
    by: { courseId: string } | { offeringId: string },
  ): Promise<AdminOffering[]> {
    let query = db
      .selectFrom('course_offerings as o')
      .innerJoin('courses as c', 'c.id', 'o.course_id')
      .leftJoin('academic_sessions as s', 's.id', 'o.academic_session_id')
      .selectAll('o')
      .select(['c.ext_id as course_ext_id', 's.ext_id as session_ext_id', 's.name as session_name'])
      .where('o.deleted_at', 'is', null)
      .where('c.deleted_at', 'is', null);
    query =
      'courseId' in by
        ? query.where('o.course_id', '=', by.courseId)
        : query.where('o.id', '=', by.offeringId);
    const rows = await query.orderBy('o.start_date').orderBy('o.ext_offering_id').execute();
    if (rows.length === 0) return [];
    const modes = await db
      .selectFrom('course_offering_delivery_modes')
      .select(['offering_id', 'mode_code'])
      .where(
        'offering_id',
        'in',
        rows.map((r) => r.id),
      )
      .orderBy('mode_code')
      .execute();
    return rows.map((r) => {
      const { overrides, override_meta, source_values } = overridesToApi(r.overrides);
      return {
        id: r.id,
        course_id: r.course_id,
        course_ext_id: r.course_ext_id,
        ext_offering_id: r.ext_offering_id,
        source_ref: r.source_ref,
        source_channel: r.source_channel,
        status: r.status,
        academic_session_id: r.academic_session_id,
        academic_session_ext_id: r.session_ext_id ?? null,
        academic_session:
          r.academic_session_id && r.session_ext_id && r.session_name
            ? { id: r.academic_session_id, ext_id: r.session_ext_id, name: r.session_name }
            : null,
        start_date: r.start_date,
        end_date: r.end_date,
        enrol_start_date: r.enrol_start_date,
        application_deadline: r.application_deadline,
        timezone: r.timezone,
        teaching_languages: r.teaching_languages,
        delivery_modes: modes.filter((m) => m.offering_id === r.id).map((m) => m.mode_code),
        campus: r.campus,
        max_students: r.max_students,
        alliance_seats: r.alliance_seats,
        seats_available: r.seats_available,
        seats_updated_at: isoOrNull(r.seats_updated_at),
        application_url: r.application_url,
        application_instructions: r.application_instructions,
        overrides,
        override_meta,
        source_values,
        absent_count: r.absent_count,
        created_at: iso(r.created_at),
        updated_at: iso(r.updated_at),
        last_seen_at: isoOrNull(r.last_seen_at),
      };
    });
  }

  /**
   * Recent changes of a course and its offerings (deleted ones included): payloads
   * received by any channel (no bodies) and audit rows, newest first.
   */
  async history(courseId: string, limit: number): Promise<AdminHistoryEntry[]> {
    const course = await this.db
      .selectFrom('courses')
      .select(['id', 'organization_id', 'ext_id'])
      .where('id', '=', courseId)
      .executeTakeFirstOrThrow();
    const offeringIds = (
      await this.db
        .selectFrom('course_offerings')
        .select('id')
        .where('course_id', '=', courseId)
        .execute()
    ).map((r) => r.id);
    // Offerings are recorded as `<course code>#<offering code>`: a range on the index.
    const from = `${course.ext_id}#`;
    const to = `${course.ext_id}$`;
    const [ingests, audits] = await Promise.all([
      this.db
        .selectFrom('ext_metadata_history as h')
        .innerJoin('sync_runs as r', 'r.id', 'h.sync_run_id')
        .select([
          'h.received_at',
          'h.entity_type',
          'h.entity_id',
          'h.ext_id',
          'h.channel',
          'h.schema_version',
          'h.validation_result',
          'h.payload_sha256',
          'h.sync_run_id',
          'r.triggered_by',
          'r.trigger_kind',
        ])
        .where('h.organization_id', '=', course.organization_id)
        .where((eb) =>
          eb.or([
            eb.and([eb('h.entity_type', '=', 'course'), eb('h.ext_id', '=', course.ext_id)]),
            eb.and([
              eb('h.entity_type', '=', 'course_offering'),
              eb('h.ext_id', '>=', from),
              eb('h.ext_id', '<', to),
            ]),
          ]),
        )
        .orderBy('h.received_at', 'desc')
        .limit(limit)
        .execute(),
      this.db
        .selectFrom('audit_log')
        .select(['occurred_at', 'actor_sub', 'action', 'entity_type', 'entity_id', 'changes'])
        .where((eb) =>
          eb.or([
            eb.and([eb('entity_type', '=', 'course'), eb('entity_id', '=', courseId)]),
            ...(offeringIds.length > 0
              ? [
                  eb.and([
                    eb('entity_type', '=', 'course_offering'),
                    eb('entity_id', 'in', offeringIds),
                  ]),
                ]
              : []),
          ]),
        )
        .orderBy('occurred_at', 'desc')
        .limit(limit)
        .execute(),
    ]);
    const entries: AdminHistoryEntry[] = [
      ...ingests.map((h): AdminHistoryEntry => ({
        kind: 'history',
        at: iso(h.received_at),
        actor: h.triggered_by ?? (h.channel === 'oeapi' ? HARVESTER_ACTOR : 'system'),
        action: `ingest.${h.validation_result}`,
        entity_type: h.entity_type as 'course' | 'course_offering',
        entity_id: h.entity_id,
        ext_id: h.ext_id,
        channel: h.channel,
        sync_run_id: h.sync_run_id,
        summary: `${h.validation_result === 'accepted' ? 'Accepted' : 'Rejected'} ${CHANNEL_NAMES[h.channel]} payload${h.entity_type === 'course_offering' ? ` for offering ${h.ext_id.slice(course.ext_id.length + 1)}` : ''}`,
        details: {
          validation_result: h.validation_result,
          schema_version: h.schema_version,
          trigger_kind: h.trigger_kind,
          payload_sha256: h.payload_sha256.toString('hex'),
        },
      })),
      ...audits.map((a): AdminHistoryEntry => {
        const changes = a.changes ?? {};
        const runId = changes['sync_run_id'];
        const channel = changes['channel'];
        return {
          kind: 'audit',
          at: iso(a.occurred_at),
          actor: a.actor_sub,
          action: a.action,
          entity_type: a.entity_type as 'course' | 'course_offering',
          entity_id: a.entity_id,
          ext_id: typeof changes['ext_id'] === 'string' ? changes['ext_id'] : null,
          channel: channel === 'oeapi' || channel === 'csv' || channel === 'form' ? channel : null,
          sync_run_id: typeof runId === 'string' ? runId : null,
          summary: auditSummary(a.action, changes),
          details: changes,
        };
      }),
    ];
    // A form save writes its own audit row; the writer's row of the same run repeats it,
    // except a change made by the IT Handbook publication rule (decision 21c).
    const formRuns = new Set(
      entries
        .filter((e) => e.kind === 'audit' && e.channel === 'form' && e.sync_run_id !== null)
        .map((e) => e.sync_run_id),
    );
    const byRule = (e: AdminHistoryEntry) =>
      e.details['publish_rule'] !== undefined && e.details['missing'] !== undefined;
    return entries
      .filter(
        (e) =>
          !(e.kind === 'audit' && e.channel === null && formRuns.has(e.sync_run_id) && !byRule(e)),
      )
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, limit);
  }
}
