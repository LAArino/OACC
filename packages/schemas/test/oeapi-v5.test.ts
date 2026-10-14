// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  oeapiV5AcademicSession,
  oeapiV5Course,
  oeapiV5Offering,
  oeapiV5Organization,
  oeapiV5Page,
  oeapiV5PageEnvelope,
} from '../src/index.js';

const course = {
  courseId: '123e4567-e89b-12d3-a456-426614174000',
  primaryCode: { codeType: 'identifier', code: 'INFOMQNM' },
  name: [{ language: 'en-GB', value: 'Academic and Professional Writing' }],
  abbreviation: 'INFOMQNM',
  description: [{ language: 'en-GB', value: 'A course.' }],
  teachingLanguage: 'eng',
  level: 'master',
  studyLoad: { studyLoadUnit: 'ects', value: 7.5 },
  modeOfDelivery: ['on campus'],
  learningOutcomes: [[{ language: 'en-GB', value: 'Write.' }]],
  fieldsOfStudy: '0232',
  link: 'https://example.org/c',
  consumers: [{ consumerKey: 'eduxchange', extra: true }],
  organization: '123e4567-e89b-12d3-a456-123514174000',
  ext: { anything: [1, 2] },
};

describe('OEAPI v5 schemas', () => {
  it('accepts a v5 course and keeps unknown members', () => {
    const parsed = oeapiV5Course.parse(course);
    expect(parsed.ext).toEqual({ anything: [1, 2] });
    expect(parsed.consumers?.[0]).toEqual({ consumerKey: 'eduxchange', extra: true });
  });

  it('requires courseId and a non-empty name', () => {
    const { courseId: _id, ...withoutId } = course;
    expect(oeapiV5Course.safeParse(withoutId).success).toBe(false);
    expect(oeapiV5Course.safeParse({ ...course, name: [] }).success).toBe(false);
    expect(oeapiV5Course.safeParse({ ...course, name: [{ language: 'en' }] }).success).toBe(false);
  });

  it('is strict on the types of the members it reads', () => {
    expect(oeapiV5Course.safeParse({ ...course, studyLoad: { value: 5 } }).success).toBe(false);
    expect(oeapiV5Course.safeParse({ ...course, modeOfDelivery: 'online' }).success).toBe(false);
    expect(oeapiV5Course.safeParse({ ...course, primaryCode: { code: 'X' } }).success).toBe(false);
  });

  it('accepts offerings with an academic session id or expanded object', () => {
    const offering = {
      offeringId: 'o-1',
      primaryCode: { codeType: 'offeringCode', code: 'INFOMQNM-26S' },
      offeringType: 'course',
      startDate: '2026-02-01',
      endDate: '2026-06-30',
      academicSession: 'as-1',
      maxNumberStudents: 30,
      resultExpected: true,
    };
    expect(oeapiV5Offering.safeParse(offering).success).toBe(true);
    const expanded = {
      ...offering,
      academicSession: {
        academicSessionId: 'as-1',
        name: [{ language: 'en', value: 'Summer semester 2026' }],
        startDate: '2026-02-01',
        endDate: '2026-07-31',
        parent: { academicSessionId: 'ay-2026' },
      },
    };
    expect(oeapiV5Offering.safeParse(expanded).success).toBe(true);
    expect(oeapiV5Offering.safeParse({ ...offering, startDate: '01/02/2026' }).success).toBe(false);
    expect(oeapiV5Offering.safeParse({ ...offering, maxNumberStudents: -1 }).success).toBe(false);
    const { endDate: _end, ...withoutEnd } = offering;
    expect(oeapiV5Offering.safeParse(withoutEnd).success).toBe(false);
  });

  it('validates academic sessions and organizations', () => {
    expect(
      oeapiV5AcademicSession.safeParse({
        academicSessionId: 'x',
        name: [{ language: 'en', value: 'x' }],
        startDate: '2026-01-01',
      }).success,
    ).toBe(false);
    expect(
      oeapiV5Organization.safeParse({
        organizationId: 'org',
        organizationType: 'root',
        name: [{ language: 'de-AT', value: 'Universität Innsbruck' }],
        shortName: 'UIBK',
        primaryCode: { codeType: 'schacHome', code: 'uibk.ac.at' },
      }).success,
    ).toBe(true);
  });

  it('parses the pagination envelope; totalPages is optional', () => {
    const page = {
      pageSize: 10,
      pageNumber: 1,
      hasPreviousPage: false,
      hasNextPage: true,
      items: [course],
    };
    expect(oeapiV5PageEnvelope.parse(page).items).toHaveLength(1);
    expect(oeapiV5Page(oeapiV5Course).parse(page).items[0]?.courseId).toBe(course.courseId);
    expect(oeapiV5PageEnvelope.safeParse({ ...page, hasNextPage: undefined }).success).toBe(false);
    expect(oeapiV5PageEnvelope.safeParse({ ...page, pageNumber: 0 }).success).toBe(false);
  });
});
