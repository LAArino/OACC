// SPDX-License-Identifier: EUPL-1.2
import { Injectable } from '@nestjs/common';
import {
  type AcademicSession,
  academicSession as academicSessionSchema,
  type Course,
  course as courseSchema,
  type CourseLevel,
  type CourseOffering,
  courseOffering as courseOfferingSchema,
  type CourseText,
  EMAIL_PATTERN,
  ERROR_CODES,
  type ErrorCode,
  type ErrorSeverityCode,
  type WarningSeverityCode,
  HANDBOOK_TEXT_FIELDS,
  type HandbookTextField,
  HTTPS_URL_PATTERN,
  INSTRUCTOR_MAX_LENGTH,
  INSTRUCTORS_MAX,
  issuesToProblemErrors,
  ISCED_CODE_PATTERN,
  type LocalizedLabel,
  type OeapiV5Course,
  oeapiV5Course,
  type OeapiV5LanguageTypedString,
  type OeapiV5Offering,
  oeapiV5Offering,
  type OeapiV5Organization,
  oeapiV5Organization,
  oeapiV5Person,
  type ProblemError,
  resolveLevels,
  type SessionType,
} from '@oecp/schemas';
import type { z } from 'zod';
import { normaliseLanguage } from './languages.js';

/** Organization-level facts the mapping needs (spec §6.2.4 "timezone", contact). */
export interface MappingContext {
  organization: {
    id: string;
    /** `organizations.ext_id`; when set, the OEAPI root organization must carry it. */
    extId: string | null;
    defaultTimezone: string;
    contactEmail: string | null;
  };
  /** Codes of `isced_broad_fields` (ISCED-F 2013 broad fields). */
  iscedBroadFields: ReadonlySet<string>;
  /** Fetch time; becomes `seats_updated_at`. */
  fetchedAt: Date;
}

/** Natural key and source id of an entity, as far as they could be read. */
export interface SourceIdentity {
  /** `primaryCode.code` (course), `primaryCode.code` or `offeringId` (offering). */
  extId: string | null;
  /** `courseId` / `offeringId`. */
  sourceRef: string | null;
}

export type MappingResult<T> =
  | { ok: true; value: T; identity: SourceIdentity; warnings: ProblemError[] }
  | { ok: false; identity: SourceIdentity; errors: ProblemError[]; warnings: ProblemError[] };

export interface MappedCourse {
  course: Course;
  source: OeapiV5Course;
}

export interface MappedOffering {
  offering: CourseOffering;
  /** Expanded `academicSession`, upserted before the offering. */
  session: AcademicSession | null;
  source: OeapiV5Offering;
}

/** Spec §6.2.4 "Delivery mode" [DL 7]; keys are lower-case with `-`/`_` read as spaces. */
const DELIVERY_MODES: Readonly<Record<string, string>> = {
  online: 'online',
  'distance learning': 'online',
  'on campus': 'presential',
  situated: 'presential',
  hybrid: 'hybrid',
};

const LEVELS: Readonly<Record<string, { level: CourseLevel; eqf: number }>> = {
  'associate degree': { level: 'short_cycle', eqf: 5 },
  bachelor: { level: 'bachelor', eqf: 6 },
  master: { level: 'master', eqf: 7 },
  doctoral: { level: 'doctoral', eqf: 8 },
};

const SESSION_TYPES: Readonly<Record<string, SessionType>> = {
  'academic year': 'academic_year',
  semester: 'semester',
  trimester: 'trimester',
  quarter: 'quarter',
  'testing period': 'testing_period',
  period: 'period',
};

const MAX_EXT_ID = 200;
const MAX_TITLE = 500;
const MAX_URL = 2048;

/** v5 text members → `course_texts` columns (spec §6.2.4). */
const TEXT_MEMBERS = [
  ['abstract', 'abstract'],
  ['description', 'description'],
  ['admissionRequirements', 'prerequisites'],
  ['assessment', 'assessment'],
] as const;

class Issues {
  readonly errors: ProblemError[] = [];
  readonly warnings: ProblemError[] = [];

  constructor(private readonly extId: () => string | null) {}

  /** Only codes the catalogue marks as errors (spec §6.6: one severity per code). */
  error(code: ErrorSeverityCode, pointer: string, detail?: string): void {
    this.errors.push(this.make(code, 'error', pointer, detail));
  }

  /** Only codes the catalogue marks as warnings. */
  warn(code: WarningSeverityCode, pointer: string, detail?: string): void {
    this.warnings.push(this.make(code, 'warning', pointer, detail));
  }

  private make(
    code: ErrorCode,
    severity: 'error' | 'warning',
    pointer: string,
    detail?: string,
  ): ProblemError {
    const message = detail ? `${ERROR_CODES[code].message}: ${detail}` : ERROR_CODES[code].message;
    const issue: ProblemError = { code, severity, message, pointer };
    const extId = this.extId();
    if (extId) issue.ext_id = extId;
    return issue;
  }
}

/** RFC 6901 pointer from a Zod path. */
function pointer(path: readonly PropertyKey[]): string {
  return path.map((p) => '/' + String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

function schemaIssues(issues: Issues, error: z.ZodError, primaryCodeCode: ErrorSeverityCode): void {
  for (const issue of error.issues) {
    const code: ErrorSeverityCode =
      issue.path[0] === 'primaryCode' ? primaryCodeCode : 'oecp.oeapi.invalid_payload';
    issues.error(code, pointer(issue.path), issue.message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringAt(value: unknown, ...path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === 'string' && current.length > 0 ? current : null;
}

/** https URL accepted by the DDL (`^https://`) and the canonical schema; else null. */
function httpsLink(value: string | undefined): { url: string | null; insecure: boolean } {
  if (value === undefined || value.trim() === '') return { url: null, insecure: false };
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol === 'https:' &&
      HTTPS_URL_PATTERN.test(trimmed) &&
      trimmed.length <= MAX_URL
    ) {
      return { url: trimmed, insecure: false };
    }
  } catch {
    // not a URL
  }
  return { url: null, insecure: true };
}

/**
 * Per-language values of a LanguageTypedString array, keyed by normalised primary
 * subtag; the first variant of a language wins (`en-GB` before `en-US`).
 */
function byLanguage(
  list: readonly OeapiV5LanguageTypedString[] | undefined,
  base: string,
  issues: Issues,
): Map<string, string> {
  const out = new Map<string, string>();
  (list ?? []).forEach((entry, i) => {
    const lang = normaliseLanguage(entry.language);
    if (lang.kind === 'invalid') {
      issues.warn('oecp.oeapi.invalid_language', `${base}/${i}/language`, entry.language);
      return;
    }
    if (lang.kind === 'dropped') {
      issues.warn('oecp.oeapi.language_dropped', `${base}/${i}/language`, entry.language);
      return;
    }
    const value = entry.value.trim();
    if (value && !out.has(lang.code)) out.set(lang.code, value);
  });
  return out;
}

/** Teaching language (ISO 639-2) → `teaching_languages` entry; warnings for unusable codes. */
function teachingLanguage(
  value: string | undefined,
  at: string,
  issues: Issues,
): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const lang = normaliseLanguage(value);
  if (lang.kind === 'ok') return lang.code;
  issues.warn(
    lang.kind === 'dropped' ? 'oecp.oeapi.language_dropped' : 'oecp.oeapi.invalid_language',
    at,
    value,
  );
  return undefined;
}

/** `{lang: text}` label containing `en` (DDL CHECK); falls back to the first language. */
function label(values: Map<string, string>): LocalizedLabel | null {
  const first = values.values().next();
  if (first.done) return null;
  const out: Record<string, string> = {};
  for (const [lang, value] of values) out[lang] = value.slice(0, MAX_TITLE);
  if (!out['en']) out['en'] = first.value.slice(0, MAX_TITLE);
  return out as LocalizedLabel;
}

/**
 * Channel A mapping, OEAPI v5 → canonical DTOs (spec §6.2.4). Pure: no I/O; every
 * rejection and warning carries a JSON Pointer into the harvested document.
 */
@Injectable()
export class OeapiV5Adapter {
  /**
   * Validates the root organization (`GET /organizations?organizationType=root`).
   * It is matched to the partner of the integration, never created; when the
   * partner has an `ext_id`, the root must carry it as `primaryCode.code` or
   * `organizationId`.
   */
  mapRootOrganization(
    raw: unknown,
    ctx: MappingContext,
  ): MappingResult<{ organization: OeapiV5Organization }> {
    const identity: SourceIdentity = {
      extId: stringAt(raw, 'primaryCode', 'code') ?? stringAt(raw, 'organizationId'),
      sourceRef: stringAt(raw, 'organizationId'),
    };
    const issues = new Issues(() => identity.extId);
    const parsed = oeapiV5Organization.safeParse(raw);
    if (!parsed.success) {
      schemaIssues(issues, parsed.error, 'oecp.oeapi.invalid_payload');
      return { ok: false, identity, errors: issues.errors, warnings: issues.warnings };
    }
    const org = parsed.data;
    if (org.organizationType !== 'root') {
      issues.error('oecp.oeapi.root_not_matched', '/organizationType', org.organizationType);
    }
    const expected = ctx.organization.extId;
    if (expected && expected !== org.primaryCode?.code && expected !== org.organizationId) {
      issues.error(
        'oecp.oeapi.root_not_matched',
        '/primaryCode/code',
        `expected ${expected}, got ${org.primaryCode?.code ?? org.organizationId}`,
      );
    }
    if (issues.errors.length > 0) {
      return { ok: false, identity, errors: issues.errors, warnings: issues.warnings };
    }
    return { ok: true, identity, value: { organization: org }, warnings: issues.warnings };
  }

  mapCourse(raw: unknown, ctx: MappingContext): MappingResult<MappedCourse> {
    const identity: SourceIdentity = {
      extId: stringAt(raw, 'primaryCode', 'code'),
      sourceRef: stringAt(raw, 'courseId'),
    };
    const issues = new Issues(() => identity.extId);
    const reject = () =>
      ({ ok: false, identity, errors: issues.errors, warnings: issues.warnings }) as const;

    const parsed = oeapiV5Course.safeParse(raw);
    if (!parsed.success) {
      schemaIssues(issues, parsed.error, 'oecp.oeapi.missing_primary_code');
      return reject();
    }
    const src = parsed.data;
    const extId = src.primaryCode?.code.trim();
    if (!extId) {
      issues.error('oecp.oeapi.missing_primary_code', '/primaryCode');
      return reject();
    }
    if (extId.length > MAX_EXT_ID) {
      issues.error('oecp.content.invalid_value', '/primaryCode/code', `longer than ${MAX_EXT_ID}`);
      return reject();
    }
    identity.extId = extId;

    // studyLoad → ects: unit ects, 0 < value ≤ 120 (numeric(5,2)).
    const load = src.studyLoad;
    if (!load) {
      issues.error('oecp.oeapi.study_load_unit', '/studyLoad', 'missing');
    } else if (load.studyLoadUnit !== 'ects') {
      issues.error('oecp.oeapi.study_load_unit', '/studyLoad/studyLoadUnit', load.studyLoadUnit);
    } else if (!(Math.round(load.value * 100) / 100 > 0) || load.value > 120) {
      issues.error('oecp.oeapi.study_load_unit', '/studyLoad/value', String(load.value));
    }
    if (issues.errors.length > 0 || !load) return reject();
    const ects = Math.round(load.value * 100) / 100;

    const texts = this.texts(src, issues);
    handbookTexts(raw, texts, issues);
    const instructors = coordinators(src.coordinators, issues) ?? extInstructors(raw, issues);

    // fieldsOfStudy → ISCED-F codes; first valid is primary.
    const isced: string[] = [];
    if (src.fieldsOfStudy !== undefined && src.fieldsOfStudy.trim() !== '') {
      for (const code of src.fieldsOfStudy.split(/[\s,;|]+/).filter(Boolean)) {
        if (!ISCED_CODE_PATTERN.test(code)) {
          issues.warn('oecp.oeapi.invalid_isced', '/fieldsOfStudy', code);
        } else if (!ctx.iscedBroadFields.has(code.slice(0, 2))) {
          issues.warn('oecp.oeapi.unknown_isced_field', '/fieldsOfStudy', code);
        } else if (!isced.includes(code)) {
          isced.push(code);
        }
      }
    }

    const level = src.level === undefined ? undefined : LEVELS[src.level.trim().toLowerCase()];
    const link = httpsLink(src.link);
    if (link.insecure) issues.warn('oecp.oeapi.insecure_link', '/link', src.link);

    const english = texts['en'] !== undefined;
    if (!english) issues.warn('oecp.oeapi.english_missing', '/name');

    const contact = ctx.organization.contactEmail;
    const levels = resolveLevels(src.level === undefined ? null : (level?.level ?? 'other'), null);
    const candidate: Course = {
      ext_id: extId,
      source_ref: src.courseId,
      status: english ? 'published' : 'draft',
      // OEAPI v5 has no course kind; partners never send alliance attributes
      // (manual overrides of both survive every harvest).
      kind: 'course',
      ects,
      level: levels.level,
      levels: levels.levels,
      eqf_level: level?.eqf ?? null,
      teaching_hours: null,
      teaching_unit_ext_id: null,
      info_url: link.url,
      contact_email: contact && EMAIL_PATTERN.test(contact) ? contact : null,
      isced_codes: isced,
      instructors,
      texts,
      attributes: {},
    };
    const checked = courseSchema.safeParse(candidate);
    if (!checked.success) {
      issues.errors.push(...withExtId(issuesToProblemErrors(checked.error.issues), extId));
      return reject();
    }
    return {
      ok: true,
      identity,
      value: { course: checked.data, source: src },
      warnings: issues.warnings,
    };
  }

  /**
   * Maps an offering of an accepted course. Teaching language and delivery modes
   * fall back to the course's values (spec §6.2.4).
   */
  mapOffering(
    raw: unknown,
    course: MappedCourse,
    ctx: MappingContext,
  ): MappingResult<MappedOffering> {
    const identity: SourceIdentity = {
      extId: stringAt(raw, 'primaryCode', 'code') ?? stringAt(raw, 'offeringId'),
      sourceRef: stringAt(raw, 'offeringId'),
    };
    const issues = new Issues(() => identity.extId);
    const reject = () =>
      ({ ok: false, identity, errors: issues.errors, warnings: issues.warnings }) as const;

    const parsed = oeapiV5Offering.safeParse(raw);
    if (!parsed.success) {
      schemaIssues(issues, parsed.error, 'oecp.oeapi.invalid_payload');
      return reject();
    }
    const src = parsed.data;
    const extId = src.primaryCode?.code.trim() || src.offeringId;
    identity.extId = extId;
    if (extId.length > MAX_EXT_ID) {
      issues.error('oecp.content.invalid_value', '/primaryCode/code', `longer than ${MAX_EXT_ID}`);
      return reject();
    }

    // Teaching language: the offering's, else the course's.
    // (A course value equal to the offering's unusable one is not reported twice.)
    const language =
      teachingLanguage(src.teachingLanguage, '/teachingLanguage', issues) ??
      (course.source.teachingLanguage === src.teachingLanguage
        ? undefined
        : teachingLanguage(course.source.teachingLanguage, '/teachingLanguage', issues));
    if (!language) {
      issues.error(
        'oecp.oeapi.missing_teaching_language',
        '/teachingLanguage',
        `offering ${src.teachingLanguage ?? '(none)'}, course ${course.source.teachingLanguage ?? '(none)'}`,
      );
    }

    // Delivery modes: the offering's, else the course's; none mappable → reject.
    const fromOffering = (src.modeOfDelivery?.length ?? 0) > 0;
    const sourceModes = (fromOffering ? src.modeOfDelivery : course.source.modeOfDelivery) ?? [];
    const modes: string[] = [];
    const unmapped: string[] = [];
    for (const value of sourceModes) {
      const code =
        DELIVERY_MODES[
          value
            .trim()
            .toLowerCase()
            .replace(/[-_\s]+/g, ' ')
        ];
      if (code) {
        if (!modes.includes(code)) modes.push(code);
      } else {
        unmapped.push(value);
      }
    }
    const modesDetail = `${sourceModes.length ? sourceModes.join(', ') : '(none)'}${fromOffering ? '' : ' (course value)'}`;
    if (modes.length === 0) {
      issues.error('oecp.oeapi.unmappable_delivery_mode', '/modeOfDelivery', modesDetail);
    } else if (unmapped.length > 0) {
      issues.warn('oecp.oeapi.delivery_mode_dropped', '/modeOfDelivery', unmapped.join(', '));
    }

    // Seats [DL 8]: only when max and enrolled are present.
    let maxStudents: number | null = null;
    let seatsAvailable: number | null = null;
    if (src.maxNumberStudents !== undefined) {
      if (src.maxNumberStudents > 0) {
        maxStudents = src.maxNumberStudents;
        if (src.enrolledNumberStudents !== undefined) {
          const pending = src.pendingNumberStudents ?? 0;
          seatsAvailable = Math.max(0, maxStudents - src.enrolledNumberStudents - pending);
        }
      } else {
        issues.warn('oecp.oeapi.invalid_student_counts', '/maxNumberStudents', '0');
      }
    }

    const link = httpsLink(src.link);
    if (link.insecure) issues.warn('oecp.oeapi.insecure_link', '/link', src.link);

    const session = this.session(src, issues);
    const instructions = applicationInstructions(raw, issues);
    if (issues.errors.length > 0 || !language) return reject();

    const candidate: CourseOffering = {
      course_ext_id: course.course.ext_id,
      ext_offering_id: extId,
      source_ref: src.offeringId,
      status: 'published',
      academic_session_ext_id: session.extId,
      start_date: src.startDate,
      end_date: src.endDate,
      enrol_start_date: src.enrollStartDate ?? null,
      application_deadline: src.enrollEndDate ?? null,
      timezone: ctx.organization.defaultTimezone,
      teaching_languages: [language],
      delivery_modes: modes,
      campus: null,
      max_students: maxStudents,
      alliance_seats: null,
      seats_available: seatsAvailable,
      seats_updated_at: seatsAvailable === null ? null : ctx.fetchedAt.toISOString(),
      application_url: link.url,
      application_instructions: instructions,
    };
    const checked = courseOfferingSchema.safeParse(candidate);
    if (!checked.success) {
      issues.errors.push(
        ...withExtId(issuesToProblemErrors(checked.error.issues), extId).map((e) => ({
          ...e,
          pointer: SOURCE_POINTERS[e.pointer ?? ''] ?? e.pointer,
        })),
      );
      return reject();
    }
    return {
      ok: true,
      identity,
      value: { offering: checked.data, session: session.value, source: src },
      warnings: issues.warnings,
    };
  }

  /** `course_texts` per language; only languages with a `name` get a row (title is required). */
  private texts(src: OeapiV5Course, issues: Issues): Record<string, CourseText> {
    const titles = byLanguage(src.name, '/name', issues);
    const texts: Record<string, CourseText> = {};
    for (const [lang, title] of titles) {
      if (title.length > MAX_TITLE) {
        issues.warn('oecp.oeapi.value_truncated', '/name', `${lang} title`);
      }
      texts[lang] = {
        title: title.slice(0, MAX_TITLE),
        abstract: null,
        description: null,
        learning_outcomes: null,
        prerequisites: null,
        assessment: null,
        mode_of_repetition: null,
        methods: null,
        literature: null,
        privacy_notice: null,
        remarks: null,
        keywords: [],
        is_machine_translated: false,
      };
    }
    const orphans = new Set<string>();
    const assign = (lang: string, column: keyof CourseText, value: string) => {
      const text = texts[lang];
      if (text) (text as Record<string, unknown>)[column] = value;
      else orphans.add(lang);
    };
    for (const [member, column] of TEXT_MEMBERS) {
      for (const [lang, value] of byLanguage(src[member], `/${member}`, issues)) {
        assign(lang, column, value);
      }
    }
    // learningOutcomes: one LanguageTypedString[] per outcome; joined by blank lines.
    const outcomes = new Map<string, string[]>();
    (src.learningOutcomes ?? []).forEach((variants, i) => {
      for (const [lang, value] of byLanguage(variants, `/learningOutcomes/${i}`, issues)) {
        outcomes.set(lang, [...(outcomes.get(lang) ?? []), value]);
      }
    });
    for (const [lang, values] of outcomes) assign(lang, 'learning_outcomes', values.join('\n\n'));
    for (const lang of orphans) {
      issues.warn('oecp.oeapi.text_without_title', '/name', lang);
    }
    return texts;
  }

  /** Expanded `academicSession` → `academic_sessions` (ext_id = academicSessionId). */
  private session(
    src: OeapiV5Offering,
    issues: Issues,
  ): { extId: string | null; value: AcademicSession | null } {
    const ref = src.academicSession;
    if (ref === undefined) return { extId: null, value: null };
    if (typeof ref === 'string') return { extId: ref, value: null };
    const name = label(byLanguage(ref.name, '/academicSession/name', issues));
    const parent =
      ref.parent === undefined
        ? null
        : typeof ref.parent === 'string'
          ? ref.parent
          : ref.parent.academicSessionId;
    const candidate = {
      ext_id: ref.academicSessionId,
      parent_ext_id: parent,
      session_type: SESSION_TYPES[(ref.academicSessionType ?? '').trim().toLowerCase()] ?? 'period',
      name: name ?? { en: ref.primaryCode?.code ?? ref.academicSessionId },
      start_date: ref.startDate,
      end_date: ref.endDate,
    };
    const checked = academicSessionSchema.safeParse(candidate);
    if (!checked.success) {
      issues.warn(
        'oecp.content.session_ignored',
        '/academicSession',
        checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
      return { extId: null, value: null };
    }
    return { extId: checked.data.ext_id, value: checked.data };
  }
}

const MAX_INSTRUCTIONS = 20_000;
const INSTRUCTIONS_POINTER = '/ext/oecp/applicationInstructions';
const INSTRUCTORS_POINTER = '/ext/oecp/instructors';
const MAX_HANDBOOK_TEXT = 20_000;

/** Display name of an expanded v5 `Person`: `displayName`, else given name + surname. */
function personName(value: unknown): string | null {
  const parsed = oeapiV5Person.safeParse(value);
  if (!parsed.success) return null;
  const p = parsed.data;
  const display = p.displayName?.trim();
  if (display) return display;
  const surname = (p.surname ?? p.surName)?.trim();
  const given = p.givenName?.trim();
  if (!given || !surname) return null;
  return [given, p.surnamePrefix?.trim(), surname].filter(Boolean).join(' ');
}

/** Distinct names, cut to the DDL limits (200 characters, 50 entries) with a warning. */
function cleanInstructors(names: readonly string[], pointer: string, issues: Issues): string[] {
  const out: string[] = [];
  for (const name of names) {
    let value = name.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (value.length > INSTRUCTOR_MAX_LENGTH) {
      issues.warn('oecp.oeapi.value_truncated', pointer, `instructor name`);
      value = value.slice(0, INSTRUCTOR_MAX_LENGTH).trim();
    }
    if (!out.includes(value)) out.push(value);
  }
  if (out.length > INSTRUCTORS_MAX) {
    issues.warn('oecp.oeapi.value_truncated', pointer, `${out.length} instructors`);
    return out.slice(0, INSTRUCTORS_MAX);
  }
  return out;
}

/**
 * v5 course `coordinators` → `instructors` (decision 21a). Only persons the
 * endpoint already returns expanded with a name (`displayName`, or `givenName`
 * and `surname`) are used; bare `personId`s are ignored: the harvester makes no
 * extra request and never looks persons up.
 *
 * GDPR: the names of teaching staff are personal data. OACC republishes only
 * the names the university itself publishes in its course catalogue for this
 * course, for the same purpose (informing prospective students), under the
 * alliance's public-interest task (decision 21a; the partner's access
 * agreement covers the republication, spec §10). Nothing else of the `Person`
 * (e-mail, phone, affiliation, ids) is read or kept in the canonical record.
 *
 * `undefined` when the course has no coordinator with a name (the OACC
 * extension `ext.oecp.instructors` may then supply them).
 */
function coordinators(value: unknown, issues: Issues): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    issues.warn('oecp.oeapi.invalid_coordinators', '/coordinators', 'expected an array');
    return undefined;
  }
  const names = value.map(personName).filter((n): n is string => n !== null);
  if (names.length === 0) return undefined;
  return cleanInstructors(names, '/coordinators', issues);
}

/**
 * Optional OACC extension `ext.oecp.instructors` (string[], as the OACC read API
 * emits it), used when `coordinators` gives no name. Anything else is ignored
 * with a warning; absent → `[]`.
 */
function extInstructors(raw: unknown, issues: Issues): string[] {
  const value = extOecp(raw)?.['instructors'];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    issues.warn('oecp.oeapi.invalid_extension', INSTRUCTORS_POINTER, 'expected [string]');
    return [];
  }
  return cleanInstructors(value as string[], INSTRUCTORS_POINTER, issues);
}

function extOecp(raw: unknown): Record<string, unknown> | null {
  const ext = isRecord(raw) && isRecord(raw['ext']) ? raw['ext'] : null;
  return ext && isRecord(ext['oecp']) ? ext['oecp'] : null;
}

/** `course_texts` column → member of `ext.oecp.texts` (camelCase, as the read API emits it). */
const HANDBOOK_TEXT_MEMBERS: Readonly<Record<HandbookTextField, string>> = {
  mode_of_repetition: 'modeOfRepetition',
  methods: 'methods',
  literature: 'literature',
  privacy_notice: 'privacyNotice',
  remarks: 'remarks',
};

/**
 * Optional OACC extension `ext.oecp.texts.{modeOfRepetition, methods, literature,
 * privacyNotice, remarks}` (decision 21b; OEAPI v5 has no such members): each
 * LanguageTypedString[] or `{lang: text}`, assigned to the languages that have a
 * title. Malformed members are ignored with a warning.
 */
function handbookTexts(raw: unknown, texts: Record<string, CourseText>, issues: Issues): void {
  const ext = extOecp(raw)?.['texts'];
  if (ext === undefined || ext === null) return;
  if (!isRecord(ext)) {
    issues.warn('oecp.oeapi.invalid_extension', '/ext/oecp/texts', 'expected an object');
    return;
  }
  for (const field of HANDBOOK_TEXT_FIELDS) {
    const member = HANDBOOK_TEXT_MEMBERS[field];
    const pointer = `/ext/oecp/texts/${member}`;
    const list = languageTypedStrings(ext[member]);
    if (list === undefined) continue;
    if (list === null) {
      issues.warn('oecp.oeapi.invalid_extension', pointer, 'expected [{language, value}]');
      continue;
    }
    for (const [lang, value] of byLanguage(list, pointer, issues)) {
      const text = texts[lang];
      if (!text) {
        issues.warn('oecp.oeapi.text_without_title', pointer, lang);
        continue;
      }
      if (value.length > MAX_HANDBOOK_TEXT) {
        issues.warn('oecp.oeapi.value_truncated', pointer, `${lang} text`);
      }
      text[field] = value.slice(0, MAX_HANDBOOK_TEXT);
    }
  }
}

/** LanguageTypedString[] or `{lang: text}` → list; `undefined` when absent, `null` when malformed. */
function languageTypedStrings(value: unknown): OeapiV5LanguageTypedString[] | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value.every(
      (v) => isRecord(v) && typeof v['language'] === 'string' && typeof v['value'] === 'string',
    )
      ? (value as OeapiV5LanguageTypedString[])
      : null;
  }
  if (isRecord(value) && Object.values(value).every((v) => typeof v === 'string')) {
    return Object.entries(value).map(([language, text]) => ({ language, value: text as string }));
  }
  return null;
}

/**
 * Optional `ext.oecp.applicationInstructions` of an offering (an OACC extension a
 * partner may send, as the OACC read API does): LanguageTypedString[], or an object
 * keyed by language. Anything else is ignored with a warning; absent → `{}`.
 */
function applicationInstructions(raw: unknown, issues: Issues): Record<string, string> {
  const ext = isRecord(raw) && isRecord(raw['ext']) ? raw['ext'] : null;
  const oecp = ext && isRecord(ext['oecp']) ? ext['oecp'] : null;
  const value = oecp ? oecp['applicationInstructions'] : undefined;
  if (value === undefined || value === null) return {};
  let list: OeapiV5LanguageTypedString[];
  if (Array.isArray(value)) {
    if (
      !value.every(
        (v) => isRecord(v) && typeof v['language'] === 'string' && typeof v['value'] === 'string',
      )
    ) {
      issues.warn(
        'oecp.oeapi.invalid_extension',
        INSTRUCTIONS_POINTER,
        'expected [{language, value}]',
      );
      return {};
    }
    list = value as OeapiV5LanguageTypedString[];
  } else if (isRecord(value) && Object.values(value).every((v) => typeof v === 'string')) {
    list = Object.entries(value).map(([language, text]) => ({ language, value: text as string }));
  } else {
    issues.warn(
      'oecp.oeapi.invalid_extension',
      INSTRUCTIONS_POINTER,
      'expected [{language, value}]',
    );
    return {};
  }
  const out: Record<string, string> = {};
  for (const [lang, text] of [...byLanguage(list, INSTRUCTIONS_POINTER, issues)].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (text.length > MAX_INSTRUCTIONS) {
      issues.warn('oecp.oeapi.value_truncated', INSTRUCTIONS_POINTER, `${lang} text`);
    }
    out[lang] = text.slice(0, MAX_INSTRUCTIONS);
  }
  return out;
}

/** Canonical offering field → member of the harvested offering. */
const SOURCE_POINTERS: Readonly<Record<string, string>> = {
  '/start_date': '/startDate',
  '/end_date': '/endDate',
  '/enrol_start_date': '/enrollStartDate',
  '/application_deadline': '/enrollEndDate',
  '/max_students': '/maxNumberStudents',
  '/seats_available': '/enrolledNumberStudents',
  '/application_url': '/link',
};

function withExtId(errors: ProblemError[], extId: string): ProblemError[] {
  return errors.map((e) => ({ ...e, ext_id: extId }));
}
