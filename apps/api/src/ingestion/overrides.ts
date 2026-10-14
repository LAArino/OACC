// SPDX-License-Identifier: EUPL-1.2
/**
 * Overrides (spec §5 "Overrides", §6.5): manual values over harvested data, kept
 * in the `overrides` jsonb of `courses`, `course_texts` and `course_offerings` as
 * `{"<field>": {"value": <json>, "by": "<sub>", "at": "<ISO 8601>", "source": <json>}}`.
 *
 * `source` is the value the source (harvester, CSV) last delivered for the field;
 * the writer refreshes it on every changed payload, so removing an override
 * restores the last harvested value without waiting for the next harvest. `null`
 * means the source has no value; an entry without `source` (written before this
 * member existed) cannot be restored immediately: its column keeps the value
 * until the next harvest rewrites the record.
 */
export interface OverrideEntry {
  value: unknown;
  by: string;
  at: string;
  source?: unknown;
}
export type OverrideMap = Record<string, OverrideEntry>;

export function hasOverrides(map: OverrideMap | null | undefined): map is OverrideMap {
  return map !== null && map !== undefined && Object.keys(map).length > 0;
}

/**
 * Stores `values` as overrides. A field already overridden keeps its `source`;
 * otherwise the source is its current value (columns hold the source value of
 * fields without override).
 */
export function setOverrides(
  map: OverrideMap | null | undefined,
  values: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
  by: string,
  at: string,
): OverrideMap {
  const out: OverrideMap = { ...map };
  for (const [field, value] of Object.entries(values)) {
    const previous = map?.[field];
    const source = previous && 'source' in previous ? previous.source : (current[field] ?? null);
    out[field] = { value, by, at, source };
  }
  return out;
}

export interface ClearedOverrides {
  map: OverrideMap;
  /** Source values of the cleared fields whose source is known. */
  restored: Record<string, unknown>;
  /** Cleared fields without a recorded source (legacy entries). */
  unknownSource: string[];
}

/** Removes the overrides of `fields` (absent ones are ignored). */
export function clearOverrides(
  map: OverrideMap | null | undefined,
  fields: readonly string[],
): ClearedOverrides {
  const out: OverrideMap = { ...map };
  const restored: Record<string, unknown> = {};
  const unknownSource: string[] = [];
  for (const field of fields) {
    const entry = out[field];
    if (!entry) continue;
    delete out[field];
    if ('source' in entry) restored[field] = entry.source ?? null;
    else unknownSource.push(field);
  }
  return { map: out, restored, unknownSource };
}

/** Records the source values of the overridden fields; the map itself is not changed. */
export function withSources(
  map: OverrideMap | null | undefined,
  source: Readonly<Record<string, unknown>>,
): OverrideMap {
  const out: OverrideMap = {};
  for (const [field, entry] of Object.entries(map ?? {})) {
    out[field] = { ...entry, source: field in source ? (source[field] ?? null) : null };
  }
  return out;
}
