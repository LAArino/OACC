// SPDX-License-Identifier: EUPL-1.2
/**
 * Small published catalogue for the read-API integration suites, on top of the
 * organizations of test-database.ts. "Today" is {@link FIXTURE_NOW} (2026-10-14).
 *
 * | Course | Org | Status | Texts | Offerings |
 * |---|---|---|---|---|
 * | A Introduction to Quantum Computing | uibk | published | en, de | A2 past (presential, de), A3 2026-12 (presential, de), A1 2027-03 (online, en; session 2027S) |
 * | B Mediterranean History | urv | published | en, ca | B1 2026-11 (presential+hybrid, ca+es), B2 2027-02 cancelled |
 * | C History of Universities | uibk (unit: faculty) | published | en, de | C1 past only |
 * | F Applied Statistics | urv | published | en | F1 draft offering only |
 * | D Quantum Draft | urv | draft | en | D1 published offering of a draft course |
 * | E Deleted Quantum Course | uibk | published, deleted | en | E1 |
 *
 * Decision 18: Aurora's attribute definitions are seeded. A is a `course`
 * (master; hub, SDGs 4 and 9, free, LOUIS), B a `bip` (bachelor and master; SDG 4,
 * not free, open to the alliance; B1 has application instructions in en and ca),
 * C a `lecture_series` (bachelor; free).
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../src/db/database.js';
import { seedAttributeDefinitions } from './attribute-definitions.js';
import { ORG } from './test-database.js';

export const FIXTURE_NOW = new Date('2026-10-14T10:00:00Z');

const id = (n: number) => `0c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const COURSE = { A: id(1), B: id(2), C: id(3), D: id(4), E: id(5), F: id(6) } as const;
export const OFFERING = {
  A1: id(11),
  A2: id(12),
  A3: id(13),
  B1: id(21),
  B2: id(22),
  C1: id(31),
  D1: id(41),
  E1: id(51),
  F1: id(61),
} as const;
export const SESSION = { year: id(91), summer: id(92) } as const;

export const LONG_ABSTRACT =
  'The Mediterranean has connected peoples, goods and ideas for millennia. This course follows ' +
  'its port cities from antiquity to the present day, reading sources on trade, migration, ' +
  'religion and empire, and asks how a shared sea shaped the politics and everyday life of the ' +
  'societies around it, from Barcelona and Marseille to Alexandria and Istanbul.';

export async function insertCatalogueFixture(db: Kysely<Database>): Promise<void> {
  await seedAttributeDefinitions(db);
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('academic_sessions')
      .values({
        id: SESSION.year,
        organization_id: ORG.uibk,
        ext_id: '2026/27',
        session_type: 'academic_year',
        name: { en: 'Academic year 2026/27', de: 'Studienjahr 2026/27' },
        start_date: '2026-10-01',
        end_date: '2027-09-30',
        source_channel: 'oeapi',
      })
      .execute();
    await trx
      .insertInto('academic_sessions')
      .values({
        id: SESSION.summer,
        organization_id: ORG.uibk,
        ext_id: '2027S',
        parent_id: SESSION.year,
        session_type: 'semester',
        name: { en: 'Summer semester 2027' },
        start_date: '2027-03-01',
        end_date: '2027-09-30',
        source_channel: 'oeapi',
      })
      .execute();

    const course = (values: Record<string, unknown>) =>
      trx
        .insertInto('courses')
        .values({ source_channel: 'csv', ...values } as never)
        .execute();
    await course({
      id: COURSE.A,
      organization_id: ORG.uibk,
      ext_id: '703001',
      status: 'published',
      ects: 6,
      kind: 'course',
      level: 'master',
      levels: ['master'],
      attributes: {
        educational_hub: ['digital_society_global_citizenship'],
        sdg: ['sdg04', 'sdg09'],
        free_course: true,
        competence_framework: 'louis',
      },
      eqf_level: 7,
      teaching_hours: 45,
      info_url: 'https://uibk.example/courses/703001',
      instructors: ['Course team, University of Innsbruck'],
    });
    await course({
      id: COURSE.B,
      organization_id: ORG.urv,
      ext_id: 'HIST-210',
      status: 'published',
      ects: 5,
      kind: 'bip',
      level: 'bachelor',
      levels: ['bachelor', 'master'],
      attributes: { sdg: ['sdg04'], free_course: false, open_to_alliance: true },
      contact_email: 'history@urv.example',
    });
    await course({
      id: COURSE.C,
      organization_id: ORG.uibk,
      teaching_unit_id: ORG.uibkFaculty,
      ext_id: '610300',
      status: 'published',
      ects: 3,
      kind: 'lecture_series',
      level: 'bachelor',
      levels: ['bachelor'],
      attributes: { free_course: true },
    });
    await course({ id: COURSE.D, organization_id: ORG.urv, ext_id: 'DRAFT-1', ects: 4 });
    await course({
      id: COURSE.E,
      organization_id: ORG.uibk,
      ext_id: 'GONE-1',
      status: 'published',
      ects: 4,
      deleted_at: '2026-09-01T00:00:00Z',
    });
    await course({
      id: COURSE.F,
      organization_id: ORG.urv,
      ext_id: 'STAT-100',
      status: 'published',
      ects: 7.5,
    });

    await trx
      .insertInto('course_texts')
      .values([
        {
          course_id: COURSE.A,
          lang: 'en',
          title: 'Introduction to Quantum Computing',
          abstract:
            'Qubits, quantum gates and algorithms for students of physics and computer science.',
          description: 'We also look at the history of quantum mechanics.',
          learning_outcomes: 'Explain superposition.\n\nImplement Grover search.',
          prerequisites: 'Linear algebra.',
          assessment: 'Written exam.',
          mode_of_repetition: 'Every winter semester.',
          methods: 'Exercises on a photonic simulator.',
          literature: 'Selected chapters of a standard textbook.',
          privacy_notice: 'Recordings follow the zebrafish policy.',
          remarks: 'Includes a cryostat laboratory visit.',
          keywords: ['qubits', 'entanglement'],
        },
        {
          course_id: COURSE.A,
          lang: 'de',
          title: 'Einführung in die Quanteninformatik',
          description: 'Qubits und Quantengatter für Studierende der Physik.',
          learning_outcomes: 'Superposition erklären.\n\nGrover-Suche implementieren.',
        },
        {
          course_id: COURSE.B,
          lang: 'en',
          title: 'Mediterranean History',
          abstract: LONG_ABSTRACT,
        },
        {
          course_id: COURSE.B,
          lang: 'ca',
          title: 'Història de la Mediterrània',
          abstract: 'Les ciutats portuàries de la Mediterrània, de l’antiguitat fins avui.',
        },
        { course_id: COURSE.C, lang: 'en', title: 'History of Universities' },
        {
          course_id: COURSE.C,
          lang: 'de',
          title: 'Geschichte der Universitäten',
          description: 'Die Universität im Wandel der Jahrhunderte.',
        },
        { course_id: COURSE.D, lang: 'en', title: 'Quantum Draft' },
        { course_id: COURSE.E, lang: 'en', title: 'Deleted Quantum Course' },
        { course_id: COURSE.F, lang: 'en', title: 'Applied Statistics' },
      ])
      .execute();

    await trx
      .insertInto('course_isced_codes')
      .values([
        { course_id: COURSE.A, isced_code: '0533', broad_code: '05', is_primary: true },
        { course_id: COURSE.A, isced_code: '0613', broad_code: '06', is_primary: false },
        { course_id: COURSE.B, isced_code: '0222', broad_code: '02', is_primary: true },
        { course_id: COURSE.C, isced_code: '0222', broad_code: '02', is_primary: true },
        { course_id: COURSE.F, isced_code: '0542', broad_code: '05', is_primary: true },
      ])
      .execute();

    const offering = (
      offeringId: string,
      courseId: string,
      values: Record<string, unknown>,
      modes: string[],
    ) => ({
      row: { id: offeringId, course_id: courseId, source_channel: 'csv', ...values },
      modes,
    });
    const offerings = [
      offering(
        OFFERING.A1,
        COURSE.A,
        {
          ext_offering_id: '703001-2027S',
          status: 'published',
          academic_session_id: SESSION.summer,
          start_date: '2027-03-01',
          end_date: '2027-06-30',
          enrol_start_date: '2026-12-01',
          application_deadline: '2027-01-31',
          timezone: 'Europe/Vienna',
          teaching_languages: ['en'],
          max_students: 30,
          alliance_seats: 5,
          seats_available: 12,
          seats_updated_at: '2026-10-13T08:00:00Z',
          application_url: 'https://uibk.example/apply/703001-2027S',
        },
        ['online'],
      ),
      offering(
        OFFERING.A2,
        COURSE.A,
        {
          ext_offering_id: '703001-2025W',
          status: 'published',
          start_date: '2025-10-01',
          end_date: '2026-01-31',
          timezone: 'Europe/Vienna',
          teaching_languages: ['de'],
        },
        ['presential'],
      ),
      offering(
        OFFERING.A3,
        COURSE.A,
        {
          ext_offering_id: '703001-2026W',
          status: 'published',
          start_date: '2026-12-01',
          end_date: '2027-01-31',
          timezone: 'Europe/Vienna',
          teaching_languages: ['de'],
          campus: 'Technik',
        },
        ['presential'],
      ),
      offering(
        OFFERING.B1,
        COURSE.B,
        {
          ext_offering_id: 'HIST-210-2026',
          status: 'published',
          start_date: '2026-11-02',
          end_date: '2027-01-29',
          application_deadline: '2026-10-20',
          timezone: 'Europe/Madrid',
          teaching_languages: ['ca', 'es'],
          application_instructions: {
            en: 'Apply through the Aurora office of your home university.',
            ca: 'Sol·liciteu-ho a l’oficina Aurora de la vostra universitat.',
          },
        },
        ['presential', 'hybrid'],
      ),
      offering(
        OFFERING.B2,
        COURSE.B,
        {
          ext_offering_id: 'HIST-210-2027',
          status: 'cancelled',
          start_date: '2027-02-01',
          end_date: '2027-05-31',
          timezone: 'Europe/Madrid',
          teaching_languages: ['ca'],
        },
        ['presential'],
      ),
      offering(
        OFFERING.C1,
        COURSE.C,
        {
          ext_offering_id: '610300-2025S',
          status: 'published',
          start_date: '2025-03-01',
          end_date: '2025-06-30',
          timezone: 'Europe/Vienna',
          teaching_languages: ['en'],
        },
        ['presential'],
      ),
      offering(
        OFFERING.D1,
        COURSE.D,
        {
          ext_offering_id: 'DRAFT-1-2027',
          status: 'published',
          start_date: '2027-01-10',
          end_date: '2027-03-10',
          timezone: 'Europe/Madrid',
          teaching_languages: ['en'],
        },
        ['online'],
      ),
      offering(
        OFFERING.E1,
        COURSE.E,
        {
          ext_offering_id: 'GONE-1-2027',
          status: 'published',
          start_date: '2027-01-10',
          end_date: '2027-03-10',
          timezone: 'Europe/Vienna',
          teaching_languages: ['en'],
        },
        ['online'],
      ),
      offering(
        OFFERING.F1,
        COURSE.F,
        {
          ext_offering_id: 'STAT-100-2027',
          status: 'draft',
          start_date: '2027-01-10',
          end_date: '2027-03-10',
          timezone: 'Europe/Madrid',
          teaching_languages: ['fr'],
        },
        ['coil'],
      ),
    ];
    await trx
      .insertInto('course_offerings')
      .values(offerings.map((o) => o.row) as never)
      .execute();
    await trx
      .insertInto('course_offering_delivery_modes')
      .values(
        offerings.flatMap((o) =>
          o.modes.map((mode_code) => ({ offering_id: o.row.id, mode_code })),
        ),
      )
      .execute();
  });
}
