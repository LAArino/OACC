// SPDX-License-Identifier: EUPL-1.2
/**
 * Data minimisation of harvested payloads before they are kept in
 * `ext_metadata_history.raw_payload` (spec §5.2, §6.2.4; GDPR art. 5(1)(c)).
 * OECP keeps only the instructor names it maps (decision 21a); the person
 * objects an endpoint returns are not kept, even in the raw history.
 */

/** Members dropped wherever they occur: v5 person lists. */
const PERSON_MEMBERS = new Set(['coordinators', 'persons']);
/** Inside `ext` (any depth): members whose name mentions a person. */
const EXT_PERSON_MEMBER = /person/i;

/**
 * A copy of `raw` without person data: every `coordinators` and `persons`
 * member at any depth, and every member of an `ext` object (at any depth below
 * it) whose name contains "person" (`ext.oecp.contactPerson`,
 * `ext.x.persons`…). Other values are kept as they are; `raw` is not modified.
 */
export function minimiseRawPayload(raw: unknown): unknown {
  return strip(raw, false);
}

function strip(value: unknown, insideExt: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => strip(item, insideExt));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (PERSON_MEMBERS.has(key)) continue;
    if (insideExt && EXT_PERSON_MEMBER.test(key)) continue;
    out[key] = strip(member, insideExt || key === 'ext');
  }
  return out;
}
