// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { auditSummary, overrideValueToApi } from '../../src/admin/courses/courses.repository.js';
import { changedKeys, iscedList } from '../../src/admin/courses/course-dto.js';
import {
  clearOverrides,
  hasOverrides,
  setOverrides,
  withSources,
} from '../../src/ingestion/overrides.js';

const AT = '2026-10-14T10:00:00.000Z';

describe('override maps', () => {
  it('records the current value as source of a new override and keeps it on re-set', () => {
    const first = setOverrides({}, { ects: 6 }, { ects: 5, status: 'published' }, 'sub-1', AT);
    expect(first).toEqual({ ects: { value: 6, by: 'sub-1', at: AT, source: 5 } });
    // The column now holds 6, but the source is still 5.
    const second = setOverrides(first, { ects: 7 }, { ects: 6 }, 'sub-2', AT);
    expect(second['ects']).toEqual({ value: 7, by: 'sub-2', at: AT, source: 5 });
    expect(setOverrides(null, { info_url: null }, {}, 's', AT)['info_url']?.source).toBeNull();
  });

  it('clears overrides, restoring known sources and reporting legacy entries', () => {
    const map = {
      ects: { value: 6, by: 's', at: AT, source: 5 },
      info_url: { value: null, by: 's', at: AT, source: 'https://x.example' },
      kind: { value: 'bip', by: 's', at: AT },
    };
    const cleared = clearOverrides(map, ['ects', 'kind', 'missing']);
    expect(cleared.map).toEqual({ info_url: map.info_url });
    expect(cleared.restored).toEqual({ ects: 5 });
    expect(cleared.unknownSource).toEqual(['kind']);
    expect(map.ects).toBeDefined(); // input untouched
  });

  it('refreshes sources without touching values', () => {
    const map = { ects: { value: 6, by: 's', at: AT, source: 5 } };
    expect(withSources(map, { ects: 8 })).toEqual({
      ects: { value: 6, by: 's', at: AT, source: 8 },
    });
    expect(withSources(map, {})['ects']?.source).toBeNull();
    expect(withSources(undefined, { ects: 1 })).toEqual({});
    expect(hasOverrides({})).toBe(false);
    expect(hasOverrides(null)).toBe(false);
    expect(hasOverrides(map)).toBe(true);
  });
});

describe('API shapes of overrides', () => {
  it('turns stored ISCED lists into {code, is_primary}', () => {
    expect(overrideValueToApi('isced_codes', ['0613', '0611'])).toEqual([
      { code: '0613', is_primary: true },
      { code: '0611', is_primary: false },
    ]);
    expect(overrideValueToApi('ects', 6)).toBe(6);
    expect(overrideValueToApi('info_url', undefined)).toBeNull();
    expect(
      iscedList([
        { code: '0611', is_primary: false },
        { code: '0613', is_primary: true },
      ]),
    ).toEqual(['0613', '0611']);
    expect(iscedList([])).toEqual([]);
  });

  it('lists changed keys and summarises audit rows', () => {
    expect(changedKeys({ a: 1, b: [1], c: null }, { a: 1, b: [2], d: 3 })).toEqual(['b', 'd']);
    expect(auditSummary('course.update', { fields: ['ects', 'texts.en'] })).toBe(
      'Course updated: ects, texts.en',
    );
    expect(
      auditSummary('course_offering.status', { status: { from: 'draft', to: 'published' } }),
    ).toBe('Status draft → published');
    expect(auditSummary('course.overrides', { set: ['ects'], clear: ['status'] })).toBe(
      'Overrides set: ects; overrides removed: status',
    );
    expect(auditSummary('course.create', { revived: true })).toBe(
      'Course created again (was deleted)',
    );
    expect(auditSummary('course.withdraw', { absent_count: 3 })).toBe(
      'Withdrawn after 3 absences from the harvest',
    );
    expect(auditSummary('something.else', {})).toBe('something.else');
  });
});
