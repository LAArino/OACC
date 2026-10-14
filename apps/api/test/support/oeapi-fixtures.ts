// SPDX-License-Identifier: EUPL-1.2
/**
 * OEAPI v5 test dataset of a fictitious UIBK endpoint, with the edge cases the
 * Channel A mapping must handle (spec §6.2.4): ECTS 7.5, a German-only course,
 * `mul`, a past enrolment deadline, an http link, ISCED `ABCD`, max students
 * without enrolment counts, unmappable delivery modes, a non-ECTS study load and a
 * course without primaryCode.
 */

export const ROOT_ORGANIZATION = {
  organizationId: '0b6a2f0e-0000-4000-8000-000000000001',
  primaryCode: { codeType: 'schacHome', code: 'uibk.ac.at' },
  organizationType: 'root',
  name: [
    { language: 'de-AT', value: 'Universität Innsbruck' },
    { language: 'en-GB', value: 'University of Innsbruck' },
  ],
  shortName: 'UIBK',
};

export const SUB_UNIT = {
  organizationId: '0b6a2f0e-0000-4000-8000-000000000002',
  primaryCode: { codeType: 'identifier', code: 'uibk-fak-informatik' },
  organizationType: 'faculty',
  name: [{ language: 'de-AT', value: 'Fakultät für Informatik' }],
  shortName: 'INF',
};

export const SESSIONS = {
  ss2026: {
    academicSessionId: 'as-ss2026',
    academicSessionType: 'semester',
    primaryCode: { codeType: 'identifier', code: 'SS2026' },
    name: [
      { language: 'en-GB', value: 'Summer semester 2026' },
      { language: 'de-AT', value: 'Sommersemester 2026' },
    ],
    startDate: '2026-03-01',
    endDate: '2026-09-30',
  },
  ws2026: {
    academicSessionId: 'as-ws2026',
    academicSessionType: 'semester',
    name: [{ language: 'de-AT', value: 'Wintersemester 2026/27' }],
    startDate: '2026-10-01',
    endDate: '2027-02-28',
  },
} as const;

const eduxchange = [{ consumerKey: 'eduxchange', alliances: [{ name: 'aurora' }] }];

export interface FixtureOffering extends Record<string, unknown> {
  offeringId: string;
  /** Session id; the detail endpoint expands it from {@link SESSIONS}. */
  academicSession?: string;
  startDate: string;
}

export interface FixtureCourse extends Record<string, unknown> {
  courseId: string;
  offerings: FixtureOffering[];
}

export const COURSES: FixtureCourse[] = [
  {
    // Regular course: ECTS 7.5, English and German, two offerings.
    courseId: 'c-0001',
    primaryCode: { codeType: 'identifier', code: '703001' },
    name: [
      { language: 'en-GB', value: 'Machine Learning for Climate Science' },
      { language: 'en-US', value: 'Machine Learning for Climate Science (US)' },
      { language: 'de-AT', value: 'Maschinelles Lernen für die Klimaforschung' },
    ],
    abbreviation: 'MLCS',
    description: [
      { language: 'en-GB', value: 'Statistical learning applied to climate data.' },
      { language: 'de-AT', value: 'Statistisches Lernen mit Klimadaten.' },
    ],
    admissionRequirements: [{ language: 'en-GB', value: 'Linear algebra.' }],
    assessment: [{ language: 'en-GB', value: 'Project and oral exam.' }],
    learningOutcomes: [
      [
        { language: 'en-GB', value: 'Select suitable models.' },
        { language: 'de-AT', value: 'Geeignete Modelle wählen.' },
      ],
      [{ language: 'en-GB', value: 'Evaluate forecasts.' }],
    ],
    teachingLanguage: 'eng',
    level: 'master',
    studyLoad: { studyLoadUnit: 'ects', value: 7.5 },
    modeOfDelivery: ['on campus'],
    fieldsOfStudy: '0613',
    link: 'https://lfuonline.uibk.ac.at/public/lfuonline_lv.details?lvnr=703001',
    consumers: eduxchange,
    organization: SUB_UNIT.organizationId,
    offerings: [
      {
        offeringId: 'o-0001-a',
        primaryCode: { codeType: 'offeringCode', code: '703001-2026S' },
        offeringType: 'course',
        name: [{ language: 'en-GB', value: 'MLCS summer 2026' }],
        teachingLanguage: 'eng',
        modeOfDelivery: ['on campus', 'online'],
        startDate: '2026-03-02',
        endDate: '2026-06-30',
        enrollStartDate: '2026-01-15',
        enrollEndDate: '2026-02-20',
        academicSession: 'as-ss2026',
        maxNumberStudents: 30,
        enrolledNumberStudents: 20,
        pendingNumberStudents: 5,
        resultExpected: true,
        link: 'https://lfuonline.uibk.ac.at/apply/703001-2026S',
      },
      {
        // Past enrolment deadline: still a valid offering.
        offeringId: 'o-0001-b',
        primaryCode: { codeType: 'offeringCode', code: '703001-2026W' },
        offeringType: 'course',
        startDate: '2026-10-05',
        endDate: '2027-01-31',
        enrollStartDate: '2026-07-01',
        enrollEndDate: '2026-09-15',
        academicSession: 'as-ws2026',
        maxNumberStudents: 25,
        enrolledNumberStudents: 30,
        resultExpected: true,
      },
    ],
  },
  {
    // German-only course: stored as draft with oecp.content.english_missing.
    courseId: 'c-0002',
    primaryCode: { codeType: 'identifier', code: '608100' },
    name: [{ language: 'de-AT', value: 'Alpine Raumordnung' }],
    description: [{ language: 'de-AT', value: 'Planung im Alpenraum.' }],
    abstract: [{ language: 'en-GB', value: 'English abstract without an English title.' }],
    teachingLanguage: 'ger',
    level: 'bachelor',
    studyLoad: { studyLoadUnit: 'ects', value: 5 },
    modeOfDelivery: ['situated'],
    fieldsOfStudy: '0731',
    consumers: eduxchange,
    offerings: [
      {
        // Max without enrolled: no seats_available.
        offeringId: 'o-0002-a',
        primaryCode: { codeType: 'offeringCode', code: '608100-2026W' },
        startDate: '2026-10-01',
        endDate: '2027-01-31',
        maxNumberStudents: 40,
      },
    ],
  },
  {
    // Offering teachingLanguage `mul`: dropped with a warning, course language used.
    courseId: 'c-0003',
    primaryCode: { codeType: 'identifier', code: '402300' },
    name: [{ language: 'en', value: 'European Integration' }],
    teachingLanguage: 'eng',
    level: 'doctoral',
    studyLoad: { studyLoadUnit: 'ects', value: 2.5 },
    modeOfDelivery: ['hybrid'],
    fieldsOfStudy: '0312',
    consumers: eduxchange,
    offerings: [
      {
        offeringId: 'o-0003-a',
        primaryCode: { codeType: 'offeringCode', code: '402300-2026W' },
        teachingLanguage: 'mul',
        startDate: '2026-11-01',
        endDate: '2026-12-15',
      },
    ],
  },
  {
    // http link and ISCED `ABCD`: both warnings, course accepted.
    courseId: 'c-0004',
    primaryCode: { codeType: 'identifier', code: '510010' },
    name: [{ language: 'en-GB', value: 'Glaciology Field Course' }],
    teachingLanguage: 'eng',
    level: 'master',
    studyLoad: { studyLoadUnit: 'ects', value: 4 },
    modeOfDelivery: ['situated'],
    fieldsOfStudy: 'ABCD',
    link: 'http://www.uibk.ac.at/geographie/glaciology',
    consumers: eduxchange,
    offerings: [
      {
        // One mappable and one unmappable mode: warning only.
        offeringId: 'o-0004-a',
        primaryCode: { codeType: 'offeringCode', code: '510010-2026S' },
        modeOfDelivery: ['situated', 'telepathy'],
        startDate: '2026-07-01',
        endDate: '2026-07-14',
        link: 'http://www.uibk.ac.at/apply',
      },
    ],
  },
  {
    // Study load in hours: rejected; its offering is rejected too.
    courseId: 'c-0005',
    primaryCode: { codeType: 'identifier', code: '999001' },
    name: [{ language: 'en-GB', value: 'Summer School' }],
    teachingLanguage: 'eng',
    level: 'undefined',
    studyLoad: { studyLoadUnit: 'hour', value: 40 },
    modeOfDelivery: ['online'],
    consumers: eduxchange,
    offerings: [
      {
        offeringId: 'o-0005-a',
        primaryCode: { codeType: 'offeringCode', code: '999001-2026S' },
        startDate: '2026-08-01',
        endDate: '2026-08-15',
      },
    ],
  },
  {
    // No primaryCode: rejected (course natural key required, spec §6.2.4).
    courseId: 'c-0006',
    name: [{ language: 'en-GB', value: 'Course Without Code' }],
    teachingLanguage: 'eng',
    level: 'bachelor',
    studyLoad: { studyLoadUnit: 'ects', value: 3 },
    modeOfDelivery: ['online'],
    consumers: eduxchange,
    offerings: [],
  },
  {
    // Associate degree, Icelandic (ISO 639-2/B `ice`); offering without primaryCode
    // falls back to offeringId; another offering has no mappable mode.
    courseId: 'c-0007',
    primaryCode: { codeType: 'identifier', code: '120500' },
    name: [
      { language: 'en-GB', value: 'Nordic Sagas' },
      { language: 'is', value: 'Norrænar sögur' },
    ],
    teachingLanguage: 'ice',
    level: 'associate degree',
    studyLoad: { studyLoadUnit: 'ects', value: 6 },
    modeOfDelivery: ['distance-learning'],
    fieldsOfStudy: '0231',
    consumers: eduxchange,
    offerings: [
      {
        offeringId: 'o-0007-a',
        startDate: '2026-09-01',
        endDate: '2026-12-20',
      },
      {
        offeringId: 'o-0007-b',
        primaryCode: { codeType: 'offeringCode', code: '120500-X' },
        modeOfDelivery: ['telepathy'],
        startDate: '2026-09-01',
        endDate: '2026-12-20',
      },
      {
        // Started more than 365 days ago: outside the `since` window, never listed.
        offeringId: 'o-0007-old',
        primaryCode: { codeType: 'offeringCode', code: '120500-2024' },
        startDate: '2024-09-01',
        endDate: '2024-12-20',
      },
    ],
  },
];

/** Course as served by the endpoint (offerings are a separate resource). */
export function servedCourse(course: FixtureCourse): Record<string, unknown> {
  const { offerings: _offerings, ...rest } = course;
  return rest;
}

/** Offering as listed: academic session by id, course by id. */
export function listedOffering(course: FixtureCourse, offering: FixtureOffering) {
  return { ...offering, course: course.courseId };
}

/** Offering detail with `expand=academicSession`. */
export function expandedOffering(course: FixtureCourse, offering: FixtureOffering) {
  const session = offering.academicSession
    ? Object.values(SESSIONS).find((s) => s.academicSessionId === offering.academicSession)
    : undefined;
  return { ...listedOffering(course, offering), ...(session ? { academicSession: session } : {}) };
}
