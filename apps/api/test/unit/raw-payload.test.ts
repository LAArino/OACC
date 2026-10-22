// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { minimiseRawPayload } from '../../src/ingestion/oeapi/raw-payload.js';

describe('minimiseRawPayload (spec §5.2, §6.2.4)', () => {
  it('drops coordinators, persons and ext members about persons, keeps the rest', () => {
    const raw = {
      courseId: 'c-1',
      primaryCode: { code: '703001' },
      coordinators: [{ personId: 'p-1', displayName: 'Ana Pérez', mail: 'ana@uibk.example' }],
      persons: ['p-2'],
      name: [{ language: 'en', value: 'Machine Learning' }],
      ext: {
        oecp: {
          instructors: ['Ana Pérez'],
          contactPerson: { name: 'Bo' },
          texts: { remarks: [{ language: 'en', value: 'r' }] },
        },
        partner: { responsiblePersons: ['x'], room: 'B12', inner: { personRef: 'p-3' } },
      },
      offerings: [{ offeringId: 'o-1', coordinators: ['p-4'], ext: { lecturerPersonId: 'p-5' } }],
    };
    const copy = structuredClone(raw);
    expect(minimiseRawPayload(raw)).toEqual({
      courseId: 'c-1',
      primaryCode: { code: '703001' },
      name: [{ language: 'en', value: 'Machine Learning' }],
      ext: {
        // The names OACC republishes (decision 21a) stay: instructors are not persons objects.
        oecp: { instructors: ['Ana Pérez'], texts: { remarks: [{ language: 'en', value: 'r' }] } },
        partner: { room: 'B12', inner: {} },
      },
      offerings: [{ offeringId: 'o-1', ext: {} }],
    });
    expect(raw).toEqual(copy); // not modified
  });

  it('keeps members outside ext whose name mentions persons, and scalars', () => {
    expect(minimiseRawPayload({ personalDevelopment: true })).toEqual({
      personalDevelopment: true,
    });
    expect(minimiseRawPayload(null)).toBeNull();
    expect(minimiseRawPayload('x')).toBe('x');
    expect(minimiseRawPayload([{ persons: 1, a: 2 }])).toEqual([{ a: 2 }]);
  });
});
