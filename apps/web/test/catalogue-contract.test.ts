// SPDX-License-Identifier: EUPL-1.2
// The development fixtures must match the response schemas published by
// @oecp/schemas (`public-responses.ts`), so the UI is built against the real
// contract. Skipped when the installed schemas package does not export them.
//
// The fixtures already carry the additive members of DL 18 (course kind,
// levels, alliance attributes, application instructions, kind and attribute
// facets). While the installed schemas do not declare them yet, those members
// are removed before validating, so the rest of the contract is still checked;
// once the schemas declare them, the full fixtures are validated. The same holds
// for the members of DL 21 (course `instructors` and the five optional texts).
import { describe, expect, it } from 'vitest';
import course from './fixtures/catalogue/course.json';
import reference from './fixtures/catalogue/reference.json';
import search from './fixtures/catalogue/search.json';
import suggest from './fixtures/catalogue/suggest.json';

type Schema = {
  safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } };
  shape?: Record<string, unknown>;
};
const schemas = (await import('@oecp/schemas').catch(() => ({}))) as Record<string, unknown>;
const schema = (name: string) => schemas[name] as Schema | undefined;
const has = (name: string) => typeof schema(name)?.safeParse === 'function';
/** Whether a schema declares a member (strict object schemas expose `shape`). */
const declares = (name: string, key: string) =>
  !!schema(name)?.shape && key in schema(name)!.shape!;

type Json = Record<string, unknown>;
const omit = (value: Json, keys: readonly string[]): Json =>
  Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)));
const COURSE_DL18 = ['kind', 'levels', 'attributes'] as const;
const TEXTS_DL21 = [
  'mode_of_repetition',
  'methods',
  'literature',
  'privacy_notice',
  'remarks',
] as const;

/** The course fixture without the DL 21 members while the schema does not declare them. */
function courseForDl21(): Json {
  const c = structuredClone(course) as unknown as Json & { texts: Record<string, Json> };
  if (declares('publicCourseDetail', 'instructors')) return c;
  return {
    ...omit(c, ['instructors']),
    texts: Object.fromEntries(
      Object.entries(c.texts).map(([lang, text]) => [lang, omit(text, TEXTS_DL21)]),
    ),
  };
}

/** The fixtures as an API without the DL 18 members would send them. */
const legacy = {
  courseSearchResponse: () => {
    const s = structuredClone(search) as unknown as Json & { items: Json[]; facets: Json };
    return {
      ...s,
      items: s.items.map((item) => {
        const card = omit(item, COURSE_DL18);
        const next = card.next_offering as Json | null;
        return { ...card, next_offering: next ? omit(next, ['application_instructions']) : null };
      }),
      facets: omit(s.facets, ['kind', 'attributes']),
    };
  },
  publicCourseDetail: () => {
    const c = omit(courseForDl21(), COURSE_DL18) as Json & {
      offerings: Json[];
    };
    return { ...c, offerings: c.offerings.map((o) => omit(o, ['application_instructions'])) };
  },
  referenceResponse: () =>
    omit(structuredClone(reference) as unknown as Json, ['kinds', 'attribute_definitions']),
};

/** Fixture to validate: complete when the schema declares DL 18, else the legacy shape. */
const MARKERS: Record<keyof typeof legacy, [schemaName: string, key: string]> = {
  courseSearchResponse: ['publicCourseCard', 'kind'],
  publicCourseDetail: ['publicCourseDetail', 'kind'],
  referenceResponse: ['referenceResponse', 'attribute_definitions'],
};
function fixtureFor(name: keyof typeof legacy, full: unknown): unknown {
  const [schemaName, key] = MARKERS[name];
  if (!declares(schemaName, key)) return legacy[name]();
  return name === 'publicCourseDetail' ? courseForDl21() : full;
}

describe.skipIf(!has('courseSearchResponse'))('fixtures match the published contract', () => {
  it.each([
    ['courseSearchResponse', fixtureFor('courseSearchResponse', search)],
    ['publicCourseDetail', fixtureFor('publicCourseDetail', course)],
    ['suggestResponse', suggest],
    ['referenceResponse', fixtureFor('referenceResponse', reference)],
  ])('%s', (name, fixture) => {
    const result = schema(name)!.safeParse(fixture);
    expect(result.error?.issues ?? []).toEqual([]);
  });
});
