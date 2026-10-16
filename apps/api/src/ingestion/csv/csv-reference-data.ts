// SPDX-License-Identifier: EUPL-1.2
import type { AdminCsvReference } from '@oecp/schemas';
import type { Db } from '../../db/db.module.js';
import { teachingUnits } from '../teaching-units.js';

/**
 * The reference lists a CSV upload of `organizationId` is validated against
 * (spec §6.3): ISCED-F broad fields, active delivery modes, sub-unit codes and
 * the organization's non-deleted course codes. Shared by the server-side run
 * (`CsvIngestionService`) and `GET /api/admin/v1/reference`, so the browser
 * validator checks exactly what the server checks. Teaching languages are not
 * restricted (`language_tags: null`): any well-formed BCP 47 tag passes.
 */
export async function loadCsvReferenceLists(
  db: Db,
  organizationId: string,
): Promise<AdminCsvReference> {
  const [isced, modes, units, courses] = await Promise.all([
    db.selectFrom('isced_broad_fields').select('code').orderBy('code').execute(),
    db
      .selectFrom('delivery_modes')
      .select('code')
      .where('active', '=', true)
      .orderBy('code')
      .execute(),
    teachingUnits(db, organizationId),
    db
      .selectFrom('courses')
      .select('ext_id')
      .where('organization_id', '=', organizationId)
      .where('deleted_at', 'is', null)
      .orderBy('ext_id')
      .execute(),
  ]);
  return {
    organization_id: organizationId,
    language_tags: null,
    delivery_modes: modes.map((r) => r.code),
    isced_broad_fields: isced.map((r) => r.code),
    teaching_unit_codes: [...units.keys()].sort(),
    course_codes: courses.map((r) => r.ext_id),
  };
}
