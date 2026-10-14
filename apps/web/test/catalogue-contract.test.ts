// SPDX-License-Identifier: EUPL-1.2
// The development fixtures must match the response schemas published by
// @oecp/schemas (`public-responses.ts`), so the UI is built against the real
// contract. Skipped when the installed schemas package does not export them.
import { describe, expect, it } from 'vitest';
import course from './fixtures/catalogue/course.json';
import reference from './fixtures/catalogue/reference.json';
import search from './fixtures/catalogue/search.json';
import suggest from './fixtures/catalogue/suggest.json';

type Schema = { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } };
const schemas = (await import('@oecp/schemas').catch(() => ({}))) as Record<string, unknown>;
const has = (name: string) =>
  typeof (schemas[name] as Schema | undefined)?.safeParse === 'function';

describe.skipIf(!has('courseSearchResponse'))('fixtures match the published contract', () => {
  it.each([
    ['courseSearchResponse', search],
    ['publicCourseDetail', course],
    ['suggestResponse', suggest],
    ['referenceResponse', reference],
  ])('%s', (name, fixture) => {
    const result = (schemas[name] as Schema).safeParse(fixture);
    expect(result.error?.issues ?? []).toEqual([]);
  });
});
