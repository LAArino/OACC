// SPDX-License-Identifier: EUPL-1.2
// Rules of the course and offering pages that mirror the admin API (spec §8.2,
// §8.3), so that the console offers only what the API accepts: when a record
// may be deleted, and whether its status is an override that can be reverted.

/** Why a course or offering cannot be deleted (i18n `admin.courses.deleteBlocked.*`). */
export type DeleteBlocker = 'harvested' | 'overridesMode' | 'published' | 'publishedOfferings';

interface DeletableRecord {
  source_channel: string;
  status: string;
  /** A course's offerings (an offering has none). */
  offerings?: readonly { status: string }[];
}

/**
 * The API refuses to delete harvested records (`harvested_not_deletable`), any
 * record of an organization in overrides mode (writes are disabled), published
 * records (`published_not_deletable`) and courses with published offerings
 * (`has_published_offerings`). Null when the delete is allowed.
 */
export function deleteBlocker(
  record: DeletableRecord,
  overridesMode: boolean,
): DeleteBlocker | null {
  if (record.source_channel === 'oeapi') return 'harvested';
  if (overridesMode) return 'overridesMode';
  if (record.status === 'published') return 'published';
  if (record.offerings?.some((o) => o.status === 'published')) return 'publishedOfferings';
  return null;
}

interface OverridableRecord {
  overrides: Readonly<Record<string, unknown>>;
  source_values: Readonly<Record<string, unknown>>;
}

/**
 * The status override of a harvested record (`overrides.status`), with the
 * partner's status from `source_values.status` (null when the API did not send
 * it); null when the status is not overridden.
 */
export function statusOverride(record: OverridableRecord): { source: string | null } | null {
  if (!Object.prototype.hasOwnProperty.call(record.overrides ?? {}, 'status')) return null;
  const source = record.source_values?.['status'];
  return { source: typeof source === 'string' ? source : null };
}
