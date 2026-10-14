// SPDX-License-Identifier: EUPL-1.2
import type { AcademicSession, Course, CourseOffering, ProblemError } from '@oecp/schemas';
import type {
  OeapiV5Course,
  OeapiV5Offering,
  OeapiV5Organization,
  OeapiV5Page,
} from './oeapi-v5.types.js';

/** Resolved `partner_integrations` row plus decrypted credential, for one run. */
export interface HarvestTarget {
  organizationId: string;
  accessMode: 'direct' | 'surfeduhub';
  /** `base_url` (direct) or the gateway URL (surfeduhub). */
  baseUrl: string;
  surfeduhubEndpointId: string | null;
  consumerProfile: string;
  pageSize: number;
  maxRequestsPerSecond: number;
  auth:
    | { scheme: 'none' }
    | { scheme: 'basic'; username: string; password: string }
    | { scheme: 'bearer'; token: string }
    | { scheme: 'api_key_header'; headerName: string; value: string };
  /** Organization default, used when OEAPI carries no time zone. */
  defaultTimezone: string;
  signal: AbortSignal;
}

/** Outcome of mapping one source entity; issues carry JSON Pointers into the source. */
export type MappingResult<T> =
  | { ok: true; value: T; warnings: ProblemError[] }
  | { ok: false; errors: ProblemError[]; warnings: ProblemError[] };

/**
 * Channel A source adapter (spec §6.2): fetches OEAPI v5 in the order of §6.2.3,
 * paging on `hasNextPage` (cap 1,000 pages), and maps payloads to canonical DTOs (§6.2.4).
 */
export interface OeapiV5Adapter {
  /** `GET /organizations?organizationType=root` */
  fetchRootOrganization(target: HarvestTarget): Promise<OeapiV5Organization>;
  /** `GET /courses?consumer={consumer_profile}` */
  listCourses(target: HarvestTarget): AsyncIterable<OeapiV5Page<OeapiV5Course>>;
  /** `GET /courses/{courseId}/offerings?since={YYYY-MM-DD}` */
  listOfferings(
    target: HarvestTarget,
    courseId: string,
    since: string,
  ): AsyncIterable<OeapiV5Page<OeapiV5Offering>>;
  /** `GET /offerings/{offeringId}?expand=academicSession` */
  fetchOffering(target: HarvestTarget, offeringId: string): Promise<OeapiV5Offering>;

  mapCourse(course: OeapiV5Course, target: HarvestTarget): MappingResult<Course>;
  mapOffering(
    offering: OeapiV5Offering,
    course: { source: OeapiV5Course; canonical: Course },
    target: HarvestTarget,
  ): MappingResult<{ offering: CourseOffering; session: AcademicSession | null }>;
}
