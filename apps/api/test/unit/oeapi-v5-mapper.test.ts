// SPDX-License-Identifier: EUPL-1.2
import { oeapiV5Course, oeapiV5Offering, oeapiV5Organization, oeapiV5Page } from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import { fromIso6392, toIso6392T } from '../../src/oeapi/languages.js';
import {
  type CourseBundle,
  lts,
  type OrganizationRow,
  toLearningOutcomes,
  toPage,
  toV5Course,
  toV5Level,
  toV5Mode,
  toV5Modes,
  toV5Offering,
  toV5Organization,
  toV5SessionType,
  v5ParentId,
} from '../../src/oeapi/oeapi-v5.mapper.js';

const org = (over: Partial<OrganizationRow>): OrganizationRow => ({
  id: 'org',
  parent_id: null,
  partner_id: null,
  org_type: 'institution',
  is_partner: false,
  slug: 'org',
  name: { en: 'Org' },
  schac_home_organization: null,
  erasmus_code: null,
  pic: null,
  country_code: null,
  website_url: null,
  logo_url: null,
  contact_email: null,
  ...over,
});

const alliance = org({ id: 'a', org_type: 'alliance', slug: 'aurora', name: { en: 'Aurora' } });
const partner = org({
  id: 'p',
  is_partner: true,
  partner_id: 'p',
  slug: 'uibk',
  name: { de: 'Universität Innsbruck', en: 'University of Innsbruck' },
  schac_home_organization: 'uibk.ac.at',
  erasmus_code: 'A INNSBRU01',
  pic: '999999999',
  country_code: 'AT',
  website_url: 'https://www.uibk.ac.at',
});
const faculty = org({ id: 'f', org_type: 'faculty', parent_id: 'p', partner_id: 'p', slug: 'fac' });
const unit = org({ id: 'u', org_type: 'campus', partner_id: 'p', slug: 'campus' });
const all = [alliance, partner, faculty, unit];

describe('vocabularies', () => {
  it.each([
    ['presential', 'on campus'],
    ['online', 'online'],
    ['coil', 'online'],
    ['hybrid', 'hybrid'],
    ['blended', 'hybrid'],
    ['joint_delivery', 'hybrid'],
    ['x-studio', 'hybrid'],
  ])('mode %s → %s', (code, v5) => expect(toV5Mode(code)).toBe(v5));

  it('deduplicates and orders modes', () => {
    expect(toV5Modes(['blended', 'coil', 'online', 'presential', 'hybrid'])).toEqual([
      'on campus',
      'online',
      'hybrid',
    ]);
  });

  it.each([
    ['bachelor', 'bachelor'],
    ['master', 'master'],
    ['doctoral', 'doctoral'],
    ['short_cycle', 'associate degree'],
    ['other', 'undefined'],
    [null, 'undefined'],
  ])('level %s → %s', (level, v5) => expect(toV5Level(level)).toBe(v5));

  it('maps session types', () => {
    expect(toV5SessionType('academic_year')).toBe('academic year');
    expect(toV5SessionType('testing_period')).toBe('testing period');
    expect(toV5SessionType('semester')).toBe('semester');
  });

  it.each([
    ['en', 'eng'],
    ['de', 'deu'],
    ['en-GB', 'eng'],
    ['nl', 'nld'],
    ['cs', 'ces'],
    ['is', 'isl'],
    ['fr', 'fra'],
    ['ca', 'cat'],
    ['rup', 'rup'],
    ['xx', 'und'],
  ])('language %s → ISO 639-2/T %s', (tag, code) => expect(toIso6392T(tag)).toBe(code));

  it('reads B and T codes back', () => {
    expect(fromIso6392('ger')).toBe('de');
    expect(fromIso6392('deu')).toBe('de');
    expect(fromIso6392('eng')).toBe('en');
    expect(fromIso6392('mul')).toBeNull();
  });
});

describe('helpers', () => {
  it('lts drops empty values and puts English first', () => {
    expect(
      lts([
        ['de', 'Hallo'],
        ['ca', null],
        ['en', 'Hello'],
        ['fr', ' '],
        ['ca', 'Hola'],
      ]),
    ).toEqual([
      { language: 'en', value: 'Hello' },
      { language: 'ca', value: 'Hola' },
      { language: 'de', value: 'Hallo' },
    ]);
  });

  it('splits learning outcomes per blank line when the languages agree', () => {
    expect(
      toLearningOutcomes([
        { lang: 'en', learning_outcomes: 'One.\n\nTwo.' },
        { lang: 'de', learning_outcomes: 'Eins.\n \nZwei.' },
      ]),
    ).toEqual([
      [
        { language: 'en', value: 'One.' },
        { language: 'de', value: 'Eins.' },
      ],
      [
        { language: 'en', value: 'Two.' },
        { language: 'de', value: 'Zwei.' },
      ],
    ]);
    expect(
      toLearningOutcomes([
        { lang: 'en', learning_outcomes: 'One.\n\nTwo.' },
        { lang: 'de', learning_outcomes: 'Alles.' },
      ]),
    ).toEqual([
      [
        { language: 'en', value: 'One.\n\nTwo.' },
        { language: 'de', value: 'Alles.' },
      ],
    ]);
    expect(toLearningOutcomes([{ lang: 'en', learning_outcomes: null }])).toBeUndefined();
  });

  it('pages', () => {
    expect(toPage([1, 2], { pageSize: 2, pageNumber: 2 }, 5)).toEqual({
      pageSize: 2,
      pageNumber: 2,
      hasPreviousPage: true,
      hasNextPage: true,
      totalPages: 3,
      items: [1, 2],
    });
    expect(toPage([], { pageSize: 10, pageNumber: 1 }, 0)).toMatchObject({
      hasNextPage: false,
      totalPages: 0,
    });
  });
});

describe('organizations', () => {
  it('hangs partners under the alliance and sub-units under their parent or partner', () => {
    expect(v5ParentId(alliance, alliance)).toBeNull();
    expect(v5ParentId(partner, alliance)).toBe('a');
    expect(v5ParentId(faculty, alliance)).toBe('p');
    expect(v5ParentId(unit, alliance)).toBe('p');
    expect(v5ParentId(partner, null)).toBeNull();
  });

  it('maps codes, names, links and the tree', () => {
    const v5 = toV5Organization(partner, all, alliance);
    expect(v5).toEqual({
      organizationId: 'p',
      primaryCode: { codeType: 'schacHome', code: 'uibk.ac.at' },
      organizationType: 'institute',
      name: [
        { language: 'en', value: 'University of Innsbruck' },
        { language: 'de', value: 'Universität Innsbruck' },
      ],
      shortName: 'uibk',
      link: 'https://www.uibk.ac.at',
      addresses: [{ addressType: 'postal', countryCode: 'AT' }],
      otherCodes: [
        { codeType: 'identifier', code: 'uibk' },
        { codeType: 'x-erasmusCode', code: 'A INNSBRU01' },
        { codeType: 'x-pic', code: '999999999' },
      ],
      parent: 'a',
      children: ['f', 'u'],
      ext: { oecp: { slug: 'uibk', orgType: 'institution', isPartner: true } },
    });
    expect(oeapiV5Organization.safeParse(v5).success).toBe(true);
    expect(toV5Organization(unit, all, alliance).organizationType).toBe('branch');
    expect(toV5Organization(partner, all, alliance, { parent: true }).parent).toMatchObject({
      organizationId: 'a',
      organizationType: 'root',
    });
  });
});

const bundle: CourseBundle = {
  course: {
    id: 'c',
    organization_id: 'p',
    teaching_unit_id: 'f',
    ext_id: 'C-1',
    kind: 'bip',
    ects: '7.50',
    level: 'short_cycle',
    levels: ['short_cycle', 'bachelor'],
    attributes: { free_course: true, sdg: ['sdg04'] },
    eqf_level: 5,
    teaching_hours: null,
    info_url: null,
    contact_email: 'c@uibk.example',
    updated_at: new Date('2026-10-01T00:00:00Z'),
  },
  texts: [
    {
      course_id: 'c',
      lang: 'en',
      title: 'Title',
      abstract: 'Abstract',
      description: null,
      learning_outcomes: null,
      prerequisites: null,
      assessment: null,
      keywords: [],
    },
    {
      course_id: 'c',
      lang: 'nl',
      title: 'Titel',
      abstract: null,
      description: 'Beschrijving',
      learning_outcomes: null,
      prerequisites: null,
      assessment: null,
      keywords: ['k'],
    },
  ],
  isced: [{ course_id: 'c', isced_code: '061301', is_primary: true }],
  offerings: [
    {
      id: 'o1',
      course_id: 'c',
      ext_offering_id: 'C-1-A',
      status: 'published',
      academic_session_id: null,
      start_date: '2026-01-01',
      end_date: '2026-02-01',
      enrol_start_date: null,
      application_deadline: null,
      timezone: 'Europe/Amsterdam',
      teaching_languages: ['nl'],
      campus: null,
      max_students: null,
      alliance_seats: null,
      seats_available: null,
      seats_updated_at: null,
      application_url: null,
      application_instructions: {},
      modes: ['blended'],
    },
    {
      id: 'o2',
      course_id: 'c',
      ext_offering_id: 'C-1-B',
      status: 'cancelled',
      academic_session_id: 's',
      start_date: '2027-01-01',
      end_date: '2027-02-01',
      enrol_start_date: null,
      application_deadline: null,
      timezone: 'Europe/Amsterdam',
      teaching_languages: ['en', 'nl'],
      campus: 'Main',
      max_students: 20,
      alliance_seats: 2,
      seats_available: 0,
      seats_updated_at: new Date('2026-10-02T00:00:00Z'),
      application_url: 'https://x.example/apply',
      application_instructions: { nl: 'Via het Aurora-bureau.', en: 'Via the Aurora office.' },
      modes: ['presential'],
    },
  ],
};
const ctx = { alliance, today: '2026-10-14' };

describe('courses and offerings', () => {
  it('maps a course; sparse members are omitted, descriptions fall back to the abstract', () => {
    const v5 = toV5Course(bundle, ctx);
    expect(v5).toMatchObject({
      courseId: 'c',
      primaryCode: { codeType: 'identifier', code: 'C-1' },
      abbreviation: 'C-1',
      description: [
        { language: 'en', value: 'Abstract' },
        { language: 'nl', value: 'Beschrijving' },
      ],
      // no upcoming published offering: the latest published one's first language
      teachingLanguage: 'nld',
      level: 'associate degree',
      studyLoad: { studyLoadUnit: 'ects', value: 7.5 },
      modeOfDelivery: ['hybrid'], // published offerings only
      fieldsOfStudy: '0613',
      consumers: [{ consumerKey: 'oecp', alliances: [{ name: 'aurora' }] }],
      organization: 'p',
      ext: {
        oecp: {
          teachingUnit: 'f',
          keywords: [{ language: 'nl', value: ['k'] }],
          kind: 'bip',
          level: 'short_cycle',
          levels: ['short_cycle', 'bachelor'],
          attributes: { free_course: true, sdg: ['sdg04'] },
        },
      },
    });
    for (const key of ['firstStartDate', 'learningOutcomes', 'admissionRequirements', 'link']) {
      expect(v5).not.toHaveProperty(key);
    }
    expect(oeapiV5Course.safeParse(v5).success).toBe(true);
  });

  it('maps an offering with seats in ext.oecp', () => {
    const v5 = toV5Offering(bundle.offerings[1]!, bundle, ctx);
    expect(v5).toMatchObject({
      offeringId: 'o2',
      primaryCode: { codeType: 'offeringCode', code: 'C-1-B' },
      offeringType: 'course',
      teachingLanguage: 'eng',
      modeOfDelivery: ['on campus'],
      resultExpected: true,
      maxNumberStudents: 20,
      link: 'https://x.example/apply',
      academicSession: 's',
      course: 'c',
      organization: 'p',
      ext: {
        oecp: {
          status: 'cancelled',
          campus: 'Main',
          allianceSeats: 2,
          seatsAvailable: 0,
          seatsUpdatedAt: '2026-10-02T00:00:00.000Z',
          teachingLanguages: ['en', 'nl'],
          deliveryModes: ['presential'],
          applicationInstructions: [
            { language: 'en', value: 'Via the Aurora office.' },
            { language: 'nl', value: 'Via het Aurora-bureau.' },
          ],
        },
      },
    });
    expect(toV5Offering(bundle.offerings[0]!, bundle, ctx).ext.oecp).not.toHaveProperty(
      'applicationInstructions',
    );
    expect(v5).not.toHaveProperty('enrolledNumberStudents');
    expect(oeapiV5Offering.safeParse(v5).success).toBe(true);
    expect(
      oeapiV5Page(oeapiV5Offering).safeParse(toPage([v5], { pageSize: 10, pageNumber: 1 }, 1))
        .success,
    ).toBe(true);
  });
});
