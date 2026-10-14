// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
// Course wizard pages (spec §6.4, §8.1) with a signed-in administrator (useAuth
// mocked) and the admin API answered by a fake `$fetch` (helpers/admin.ts).
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CoursePage from '../app/pages/(admin)/admin/courses/[id]/index.vue';
import OfferingPage from '../app/pages/(admin)/admin/courses/[id]/offerings/[offeringId].vue';
import NewOfferingPage from '../app/pages/(admin)/admin/courses/[id]/offerings/new.vue';
import CoursesPage from '../app/pages/(admin)/admin/courses/index.vue';
import NewCoursePage from '../app/pages/(admin)/admin/courses/new.vue';
import { createFakeFetch, type FakeRequest, fixtures, ORG_ID, type Route } from './helpers/admin';
import {
  COURSE_ID,
  course,
  courseList,
  handbookCourse,
  history,
  listItem,
  OFFERING_ID,
  offering,
  reference,
  validationProblem,
} from './helpers/adminCourses';
import { axeViolations } from './helpers/catalogue';

const net = vi.hoisted(() => ({
  fetch: undefined as
    | undefined
    | (((...args: unknown[]) => unknown) & {
        create: (...args: unknown[]) => unknown;
      }),
}));
mockNuxtImport('$fetch', () =>
  Object.assign((...args: unknown[]) => net.fetch!(...args), {
    create: (...args: unknown[]) => net.fetch!.create(...args),
  }),
);

const auth = vi.hoisted(() => ({ signedIn: true, token: 'token-0', count: 0 }));
mockNuxtImport('useAuth', () => () => ({
  user: { value: null },
  isAuthenticated: {
    get value() {
      return auth.signedIn;
    },
  },
  accessToken: {
    get value() {
      return auth.signedIn ? auth.token : undefined;
    },
  },
  login: async () => undefined,
  logout: async () => undefined,
  handleCallback: async () => '/en/admin',
}));

const ME = 'GET /api/admin/v1/me';
const PUBLIC_REFERENCE = 'GET /api/public/v1/reference';
const REFERENCE = `GET /api/admin/v1/organizations/${ORG_ID}/reference`;
const LIST = `GET /api/admin/v1/organizations/${ORG_ID}/courses`;
const CREATE = `POST /api/admin/v1/organizations/${ORG_ID}/courses`;
const COURSE = `GET /api/admin/v1/courses/${COURSE_ID}`;
const PUT = `PUT /api/admin/v1/courses/${COURSE_ID}`;
const PATCH = `PATCH /api/admin/v1/courses/${COURSE_ID}/overrides`;
const STATUS = `POST /api/admin/v1/courses/${COURSE_ID}/status`;
const DELETE = `DELETE /api/admin/v1/courses/${COURSE_ID}`;
const HISTORY = `GET /api/admin/v1/courses/${COURSE_ID}/history`;
const CREATE_OFFERING = `POST /api/admin/v1/courses/${COURSE_ID}/offerings`;
const PUT_OFFERING = `PUT /api/admin/v1/offerings/${OFFERING_ID}`;
const PATCH_OFFERING = `PATCH /api/admin/v1/offerings/${OFFERING_ID}/overrides`;
const OFFERING_STATUS = `POST /api/admin/v1/offerings/${OFFERING_ID}/status`;

const ok =
  (body: unknown, status = 200): Route =>
  () => ({ status, body: structuredClone(body) });
const fail =
  (status: number, body: unknown): Route =>
  () => ({ status, body });

let calls: FakeRequest[] = [];
function serve(routes: Record<string, Route>) {
  const fake = createFakeFetch({
    [ME]: ok(fixtures.me(['partner_admin'])),
    [PUBLIC_REFERENCE]: ok(fixtures.reference),
    [REFERENCE]: ok(reference()),
    [LIST]: ok(courseList([listItem(1), listItem(2, { has_overrides: true, status: 'draft' })])),
    [COURSE]: ok(course()),
    [HISTORY]: ok(history()),
    ...routes,
  });
  calls = fake.calls;
  net.fetch = fake.fetch;
}
const callsTo = (key: string) => calls.filter((c) => `${c.method} ${c.url}` === key);

beforeEach(() => {
  auth.signedIn = true;
  // A new token per test: `/me` and the reference data are cached per token.
  auth.token = `token-${++auth.count}`;
  serve({});
});
const mounted: { unmount: () => void }[] = [];
afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mountPage(component: unknown, route: string) {
  const w = await mountSuspended(component as never, { route, attachTo: document.body });
  mounted.push(w);
  await flushPromises();
  return w;
}
type Wrapper = Awaited<ReturnType<typeof mountPage>>;

const button = (w: Wrapper, text: string) => {
  const found = w.findAll('button').find((b) => b.text() === text);
  if (!found)
    throw new Error(
      `No button "${text}" in: ${w
        .findAll('button')
        .map((b) => b.text())
        .join(' | ')}`,
    );
  return found;
};
const byId = (w: Wrapper, id: string) => w.find(`[id="${id}"]`);
async function click(w: Wrapper, text: string) {
  await button(w, text).trigger('click');
  await flushPromises();
}

/** The optional IT Handbook texts of a language left empty [DL 21]. */
const NO_HANDBOOK_TEXTS = {
  methods: null,
  mode_of_repetition: null,
  literature: null,
  remarks: null,
  privacy_notice: null,
};

const listQuery = () => callsTo(LIST).at(-1)!.query;
const rowCells = (w: Wrapper, selector = '.admin-table') =>
  w
    .find(selector)
    .findAll('tbody tr')
    .map((r) => r.findAll('th, td').map((c) => c.text()));
const summaryItems = (w: Wrapper) =>
  w.findAll('.admin-error-summary li a').map((a) => [a.text(), a.attributes('href')]);
const activeId = () => (document.activeElement as HTMLElement | null)?.id;
const stepButtons = (w: Wrapper) => w.findAll('.admin-steps button');
async function setField(w: Wrapper, id: string, value: string) {
  await byId(w, id).setValue(value);
}

describe('courses list', () => {
  it('lists the courses with links, badges and the New course button', async () => {
    const w = await mountPage(CoursesPage, '/en/admin/courses');
    expect(w.find('h1').text()).toBe('Courses');
    expect(callsTo(LIST)).toHaveLength(1);
    expect(w.find('a.button').text()).toBe('New course');
    expect(w.find('a.button').attributes('href')).toBe('/en/admin/courses/new');
    expect(listQuery()).toEqual({ page: 1, page_size: 25 });
    expect(w.find('caption').text()).toBe('Courses 1–2 of 2');
    expect(w.findAll('thead th').map((th) => th.text())).toEqual([
      'Course code',
      'Title',
      'Type of course',
      'Status',
      'Source',
      'ECTS',
      'Levels',
      'Offerings',
      'Last updated',
      'Overrides',
    ]);
    const rows = rowCells(w);
    expect(rows[0]!.slice(0, 8)).toEqual([
      'TEST-101',
      'Course 1',
      'Course',
      'Published',
      'CSV upload',
      '5',
      'Bachelor, Master',
      '2',
    ]);
    expect(rows[0]![9]).toBe('No');
    expect(rows[1]![3]).toBe('Draft');
    expect(rows[1]![9]).toBe('Overridden');
    expect(w.find('tbody th a').attributes('href')).toBe(`/en/admin/courses/${listItem(1).id}`);
    expect(w.find('[role="status"]').text()).toBe('2 courses found');

    const push = vi.spyOn(useRouter(), 'push').mockResolvedValue(undefined);
    await w.findAll('tbody tr')[1]!.findAll('td')[0]!.trigger('click');
    expect(push).toHaveBeenCalledWith(`/en/admin/courses/${listItem(2).id}`);
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('filters by search, status, kind and source through the URL', async () => {
    const w = await mountPage(CoursesPage, '/en/admin/courses');
    await setField(w, 'courses-q', ' statistics ');
    const legendGroup = (legend: string) =>
      w.findAll('fieldset').find((f) => f.find('legend').text() === legend)!;
    const tick = async (legend: string, label: string) => {
      const group = legendGroup(legend);
      const input = group
        .findAll('li')
        .find((li) => li.find('label').text() === label)!
        .find('input');
      await input.setValue(true);
    };
    await tick('Status', 'Draft');
    await tick('Status', 'Withdrawn');
    await tick('Type of course', 'Blended intensive programme (BIP)');
    await tick('Source', 'OEAPI harvest');
    await w.find('form[role="search"]').trigger('submit');
    await vi.waitFor(() => expect(callsTo(LIST)).toHaveLength(2));
    expect(listQuery()).toEqual({
      q: 'statistics',
      status: ['draft', 'withdrawn'],
      kind: ['bip'],
      source_channel: ['oeapi'],
      page: 1,
      page_size: 25,
    });
    expect(useRouter().currentRoute.value.query).toEqual({
      q: 'statistics',
      status: ['draft', 'withdrawn'],
      kind: ['bip'],
      source_channel: ['oeapi'],
    });

    await click(w, 'Clear filters');
    await vi.waitFor(() => expect(callsTo(LIST)).toHaveLength(3));
    expect(listQuery()).toEqual({ page: 1, page_size: 25 });
  });

  it('restores filters from the URL and paginates', async () => {
    serve({
      [LIST]: (request) =>
        ok(courseList([listItem(1)], { page: Number(request.query?.page ?? 1), total: 60 }))(
          request,
        ),
    });
    const w = await mountPage(
      CoursesPage,
      '/en/admin/courses?q=stat&status=published&source_channel=csv',
    );
    expect(listQuery()).toEqual({
      q: 'stat',
      status: ['published'],
      source_channel: ['csv'],
      page: 1,
      page_size: 25,
    });
    expect((byId(w, 'courses-q').element as HTMLInputElement).value).toBe('stat');
    expect(w.find('.admin-pager').text()).toContain('Page 1 of 3');
    expect(button(w, 'Previous').attributes('disabled')).toBeDefined();
    expect(callsTo(LIST)).toHaveLength(1);
    await click(w, 'Next');
    await vi.waitFor(() => expect(callsTo(LIST)).toHaveLength(2));
    expect(listQuery()).toMatchObject({ q: 'stat', page: 2 });
    expect(useRouter().currentRoute.value.query.page).toBe('2');
  });

  it('explains overrides mode instead of offering New course', async () => {
    serve({
      [REFERENCE]: ok(reference({ form_mode: 'overrides', authoritative_channel: 'oeapi' })),
    });
    const w = await mountPage(CoursesPage, '/en/admin/courses');
    expect(w.find('a.button').exists()).toBe(false);
    expect(w.find('.notice').text()).toContain('harvested from its OEAPI endpoint');
  });

  it('shows the empty state and API problems', async () => {
    serve({ [LIST]: ok(courseList([])) });
    const w = await mountPage(CoursesPage, '/en/admin/courses');
    expect(w.text()).toContain('No courses match these filters.');
    serve({ [LIST]: fail(500, { title: 'Internal error', status: 500 }) });
    const w2 = await mountPage(CoursesPage, '/en/admin/courses');
    expect(w2.find('[role="alert"]').text()).toContain('Something went wrong.');
  });
});

/** Fills step 1 of a new course with valid values. */
async function fillBasics(w: Wrapper) {
  await setField(w, 'course-ext_id', 'NEW-200');
  await byId(w, 'course-kind').setValue('bip');
  await byId(w, 'course-levels-2').setValue(true); // master
  await byId(w, 'course-levels-1').setValue(true); // bachelor
  await setField(w, 'course-ects', '7.5');
  await setField(w, 'course-teaching_hours', '30');
  await setField(w, 'course-isced_codes-0-code', '0541');
  await click(w, 'Add an ISCED code');
  await setField(w, 'course-isced_codes-1-code', '0613');
  await byId(w, 'course-isced_codes-1-primary').setValue(true);
  await byId(w, 'course-teaching_unit_ext_id').setValue('ETSE');
  await setField(w, 'course-info_url', 'https://www.example.org/new-200');
  await setField(w, 'course-contact_email', 'new@example.org');
  await setField(w, 'course-instructors', 'Dr. Ada Lovelace\n\n Prof. Alan Turing ');
}

describe('new course wizard', () => {
  it('validates step by step, links the error summary to the fields and manages focus', async () => {
    const w = await mountPage(NewCoursePage, '/en/admin/courses/new');
    expect(w.find('h1').text()).toBe('New course');
    const steps = stepButtons(w);
    expect(steps.map((b) => b.text())).toEqual([
      '1 Basics',
      '2 Texts',
      '3 Attributes',
      '4 Review and status',
    ]);
    expect(steps[0]!.attributes('aria-current')).toBe('step');
    expect(steps.slice(1).every((b) => b.attributes('disabled') !== undefined)).toBe(true);
    expect(w.find('nav.admin-steps').attributes('aria-label')).toBe('Course wizard steps');
    expect(await axeViolations(w.html())).toEqual([]);

    await click(w, 'Next');
    const summary = w.find('.admin-error-summary');
    expect(summary.attributes('role')).toBe('alert');
    expect(summary.find('h2').text()).toBe('There are problems with 4 fields');
    expect(summary.element.contains(document.activeElement)).toBe(true);
    expect(summaryItems(w)).toEqual([
      ['Course code: Enter a value.', '#course-ext_id'],
      ['Levels: Choose at least one level.', '#course-levels'],
      ['ECTS credits: Enter a value.', '#course-ects'],
      ['ISCED code 1: Enter at least one ISCED code.', '#course-isced_codes-0-code'],
    ]);
    const code = byId(w, 'course-ext_id');
    expect(code.attributes('aria-invalid')).toBe('true');
    expect(code.attributes('aria-describedby')).toBe('course-ext_id-hint course-ext_id-error');
    expect(byId(w, 'course-ext_id-error').text()).toBe('Error: Enter a value.');
    expect(await axeViolations(w.html())).toEqual([]);

    await summary.findAll('a')[1]!.trigger('click');
    await flushPromises();
    expect(activeId()).toBe('course-levels-0');
    await summary.findAll('a')[2]!.trigger('click');
    await flushPromises();
    expect(activeId()).toBe('course-ects');

    await setField(w, 'course-ext_id', 'bad code!');
    await setField(w, 'course-ects', '0');
    await setField(w, 'course-isced_codes-0-code', '9912');
    await setField(w, 'course-info_url', 'http://insecure.example.org');
    await setField(w, 'course-contact_email', 'nobody');
    expect(byId(w, 'course-isced_codes-0-code-hint').text()).toBe(
      'Broad field 99 is not in the ISCED-F list.',
    );
    await click(w, 'Next');
    expect(summaryItems(w).map(([text]) => text)).toEqual([
      'Course code: Use 1 to 200 letters, digits or . _ / -, starting with a letter or digit.',
      'Levels: Choose at least one level.',
      'ECTS credits: Enter a number of credits greater than 0 and at most 120.',
      'Information page: Enter a web address starting with https://.',
      'Contact e-mail: Enter an e-mail address such as name@example.org.',
      'ISCED code 1: The first two digits are not an ISCED broad field.',
    ]);

    await fillBasics(w);
    expect(byId(w, 'course-isced_codes-0-code-hint').text()).toBe(
      'Broad field 05: Natural sciences, mathematics and statistics',
    );
    await click(w, 'Next');
    expect(w.find('.admin-error-summary').exists()).toBe(false);
    expect(w.find('#course-step-heading').text()).toBe('Step 2 of 4: Texts');
    expect(activeId()).toBe('course-step-heading');
    expect(stepButtons(w)[1]!.attributes('aria-current')).toBe('step');
    expect(stepButtons(w)[0]!.attributes('disabled')).toBeUndefined();
    expect(stepButtons(w)[2]!.attributes('disabled')).toBeDefined();

    await click(w, 'Next');
    expect(summaryItems(w)).toEqual([
      [
        'Title (English): Enter the English title: English texts are required.',
        '#course-texts-en-title',
      ],
    ]);
    expect(w.find('[role="tab"][aria-selected="true"]').text()).toContain('English');
    expect(await axeViolations(w.html())).toEqual([]);

    // Back keeps the values of step 1.
    await click(w, 'Back');
    expect((byId(w, 'course-ects').element as HTMLInputElement).value).toBe('7.5');
    expect(activeId()).toBe('course-step-heading');
  });

  it('creates a course with the POST payload of the contract', async () => {
    serve({ [CREATE]: ok(course({ ext_id: 'NEW-200' }), 201) });
    const push = vi.spyOn(useRouter(), 'push').mockResolvedValue(undefined);
    const w = await mountPage(NewCoursePage, '/en/admin/courses/new');
    await fillBasics(w);
    await click(w, 'Next');

    await setField(w, 'course-texts-en-title', ' Data science for all ');
    await setField(w, 'course-texts-en-description', 'A course about data.');
    await setField(w, 'course-texts-en-keywords', 'data, science\nstatistics,, data');
    // The optional IT Handbook texts sit in a collapsed "More texts" group.
    const more = w.find('#course-texts-panel details.admin-more-texts');
    expect(more.find('summary').text()).toBe('More texts (optional)');
    expect((more.element as HTMLDetailsElement).open).toBe(false);
    expect(more.findAll('label').map((l) => l.text().replace(/\s+/g, ' ').trim())).toEqual([
      'Methods (English)',
      'Mode of repetition (English)',
      'Literature (English)',
      'Remarks (English)',
      'Privacy notice (English)',
    ]);
    await setField(w, 'course-texts-en-methods', 'Lectures and labs.');
    await setField(w, 'course-texts-en-mode_of_repetition', 'Every spring semester.');
    await setField(w, 'course-texts-en-privacy_notice', 'Data is used for admission only.');
    // Catalan texts in a second tab.
    await byId(w, 'course-texts-add').setValue('ca');
    await click(w, 'Add');
    expect(w.find('[role="tab"][aria-selected="true"]').text()).toBe('Catalan');
    expect(activeId()).toBe('course-texts-tab-ca');
    await setField(w, 'course-texts-ca-title', 'Ciència de dades per a tothom');
    expect(byId(w, 'course-texts-ca-title').attributes('lang')).toBe('ca');
    // Arrow keys move between the tabs.
    await byId(w, 'course-texts-tab-ca').trigger('keydown', { key: 'ArrowLeft' });
    await flushPromises();
    expect(activeId()).toBe('course-texts-tab-en');
    await click(w, 'Next');
    expect(w.find('#course-step-heading').text()).toBe('Step 3 of 4: Attributes');

    expect(w.findAll('.admin-fieldset--plain label').map((l) => l.text())[0]).toBe(
      'Educational hub',
    );
    await byId(w, 'course-attributes-hub').setValue('health');
    await byId(w, 'course-attributes-sdgs-1').setValue(true);
    await byId(w, 'course-attributes-micro_credential').setValue(true);
    expect(byId(w, 'course-attributes-micro_credential').attributes('aria-describedby')).toBe(
      'course-attributes-micro_credential-hint',
    );
    expect(await axeViolations(w.html())).toEqual([]);
    await click(w, 'Next');

    expect(w.find('#course-step-heading').text()).toBe('Step 4 of 4: Review and status');
    const review = Object.fromEntries(
      w
        .findAll('.admin-review dt')
        .map((dt, i) => [dt.text(), w.findAll('.admin-review dd')[i]!.text()]),
    );
    expect(review).toMatchObject({
      'Course code': 'NEW-200',
      'Type of course': 'Blended intensive programme (BIP)',
      Levels: 'Bachelor, Master',
      'ECTS credits': '7.5',
      'ISCED-F fields of study': '0541, 0613 (primary)',
      'Teaching unit': 'School of Engineering',
      Instructors: 'Dr. Ada Lovelace; Prof. Alan Turing',
      'Title (English)': 'Data science for all',
      'Title (Catalan)': 'Ciència de dades per a tothom',
      Attributes:
        'Educational hub: Health; Sustainable Development Goals: Climate action; Micro-credential: Yes',
    });
    expect((byId(w, 'course-status-draft').element as HTMLInputElement).checked).toBe(true);
    await byId(w, 'course-status-published').setValue(true);
    expect(await axeViolations(w.html())).toEqual([]);
    await click(w, 'Create course');

    const [request] = callsTo(CREATE);
    expect(request!.headers).toEqual({ authorization: `Bearer ${auth.token}` });
    expect(request!.body).toEqual({
      ext_id: 'NEW-200',
      kind: 'bip',
      levels: ['bachelor', 'master'],
      ects: 7.5,
      teaching_hours: 30,
      info_url: 'https://www.example.org/new-200',
      contact_email: 'new@example.org',
      teaching_unit_ext_id: 'ETSE',
      instructors: ['Dr. Ada Lovelace', 'Prof. Alan Turing'],
      isced_codes: [
        { code: '0541', is_primary: false },
        { code: '0613', is_primary: true },
      ],
      attributes: { hub: 'health', sdgs: ['sdg13'], micro_credential: true },
      texts: {
        en: {
          title: 'Data science for all',
          abstract: null,
          description: 'A course about data.',
          learning_outcomes: null,
          prerequisites: null,
          assessment: null,
          keywords: ['data', 'science', 'statistics'],
          methods: 'Lectures and labs.',
          mode_of_repetition: 'Every spring semester.',
          literature: null,
          remarks: null,
          privacy_notice: 'Data is used for admission only.',
        },
        ca: {
          title: 'Ciència de dades per a tothom',
          abstract: null,
          description: null,
          learning_outcomes: null,
          prerequisites: null,
          assessment: null,
          keywords: [],
          ...NO_HANDBOOK_TEXTS,
        },
      },
      status: 'published',
    });
    expect(push).toHaveBeenCalledWith(`/en/admin/courses/${COURSE_ID}`);

    // The course page announces the creation once.
    const page = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    expect(page.find('[role="status"]').text()).toBe('Course NEW-200 created.');
    const again = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    expect(again.text()).not.toContain('created.');
  });

  it('maps server validation errors to their fields and steps by json_pointer', async () => {
    serve({
      [CREATE]: fail(
        400,
        validationProblem([
          { code: 'oecp.content.duplicate_ext_id', json_pointer: '/ext_id' },
          { code: 'oecp.content.english_missing', json_pointer: '/texts/en' },
          { code: 'oecp.content.unknown_isced_field', json_pointer: '/isced_codes/1/code' },
          { code: 'oecp.content.something_new', json_pointer: '/attributes/hub/0' },
        ]),
      ),
    });
    const w = await mountPage(NewCoursePage, '/en/admin/courses/new');
    await fillBasics(w);
    await click(w, 'Next');
    await setField(w, 'course-texts-en-title', 'A title');
    await click(w, 'Next');
    await click(w, 'Next');
    await click(w, 'Create course');

    expect(summaryItems(w)).toEqual([
      ['Course code: Another record of the organization already uses this code.', '#course-ext_id'],
      [
        'Title (English): Enter the English title: English texts are required.',
        '#course-texts-en-title',
      ],
      [
        'ISCED code 2: The first two digits are not an ISCED broad field.',
        '#course-isced_codes-1-code',
      ],
      ['Educational hub: Server: oecp.content.something_new', '#course-attributes-hub'],
    ]);
    expect(w.findAll('.admin-steps__flag').length).toBe(3);
    expect(stepButtons(w)[0]!.text()).toBe('1 Basics (has errors)');

    await w.findAll('.admin-error-summary a')[1]!.trigger('click');
    await flushPromises();
    expect(w.find('#course-step-heading').text()).toBe('Step 2 of 4: Texts');
    expect(activeId()).toBe('course-texts-en-title');
    expect(byId(w, 'course-texts-en-title-error').text()).toContain('Enter the English title');

    await w.findAll('.admin-error-summary a')[0]!.trigger('click');
    await flushPromises();
    expect(activeId()).toBe('course-ext_id');
  });

  it('shows problems that do not point at a field', async () => {
    serve({
      [CREATE]: fail(409, {
        title: 'Conflict',
        status: 409,
        errors: [{ code: 'oecp.sync.channel_disabled', severity: 'error', message: 'Disabled' }],
      }),
    });
    const w = await mountPage(NewCoursePage, '/en/admin/courses/new');
    await fillBasics(w);
    await click(w, 'Next');
    await setField(w, 'course-texts-en-title', 'A title');
    await click(w, 'Next');
    await click(w, 'Next');
    await click(w, 'Create course');
    const alert = w.find('[role="alert"]');
    expect(alert.text()).toContain('The course could not be saved');
    expect(alert.text()).toContain('the form can only override harvested values');
    expect(alert.text()).toContain('oecp.sync.channel_disabled');
  });

  it('refuses to create courses for harvested organizations', async () => {
    serve({ [REFERENCE]: ok(reference({ form_mode: 'overrides' })) });
    const w = await mountPage(NewCoursePage, '/en/admin/courses/new');
    expect(w.find('form').exists()).toBe(false);
    expect(w.find('.notice').text()).toContain('courses cannot be created here');
  });
});

/** The CourseInput a PUT of the unchanged fixture course sends. */
const fixtureInput = {
  ext_id: 'TEST-101',
  kind: 'course',
  levels: ['bachelor'],
  ects: 6,
  teaching_hours: 45,
  info_url: 'https://www.example.org/test-101',
  contact_email: 'courses@example.org',
  teaching_unit_ext_id: 'ETSE',
  instructors: [],
  isced_codes: [{ code: '0541', is_primary: true }],
  attributes: { hub: 'digital' },
  texts: {
    en: {
      title: 'Applied statistics',
      abstract: 'Statistics for practitioners.',
      description: 'An introduction to applied statistics.',
      learning_outcomes: null,
      prerequisites: null,
      assessment: null,
      keywords: ['statistics', 'data'],
      ...NO_HANDBOOK_TEXTS,
    },
  },
  status: 'draft',
};

describe('course page', () => {
  it('edits any step of an existing course and saves it with PUT', async () => {
    const saved = course({ updated_at: '2026-10-14T10:00:00.000Z' });
    serve({ [PUT]: ok(saved) });
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    expect(w.find('h1').text()).toBe('Applied statistics');
    expect(stepButtons(w).every((b) => b.attributes('disabled') === undefined)).toBe(true);
    expect(byId(w, 'course-ext_id').text()).toBe('TEST-101');
    expect((byId(w, 'course-teaching_unit_ext_id').element as HTMLSelectElement).value).toBe(
      'ETSE',
    );
    expect(await axeViolations(w.html())).toEqual([]);

    await stepButtons(w)[1]!.trigger('click');
    await flushPromises();
    expect(activeId()).toBe('course-step-heading');
    expect((byId(w, 'course-texts-en-keywords').element as HTMLTextAreaElement).value).toBe(
      'statistics, data',
    );
    await setField(w, 'course-texts-en-description', 'A corrected English description.');
    await click(w, 'Save');

    const [request] = callsTo(PUT);
    expect(request!.body).toEqual({
      ...fixtureInput,
      texts: {
        en: { ...fixtureInput.texts.en, description: 'A corrected English description.' },
      },
    });
    const result = w.find('.admin-save-result');
    expect(result.attributes('role')).toBe('status');
    expect(result.attributes('aria-live')).toBe('polite');
    expect(result.text()).toBe('Course saved.');
    expect(callsTo(HISTORY)).toHaveLength(2);
  });

  it('keeps the status of a withdrawn course unless another one is chosen', async () => {
    serve({
      [COURSE]: ok(course({ status: 'withdrawn' })),
      [PUT]: ok(course({ status: 'withdrawn' })),
    });
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    await stepButtons(w)[3]!.trigger('click');
    await flushPromises();
    expect(w.find('#course-status-hint').text()).toContain('currently Withdrawn');
    expect(w.findAll('input[name="course-status"]:checked')).toHaveLength(0);
    await click(w, 'Save');
    expect(callsTo(PUT)[0]!.body).not.toHaveProperty('status');
    await byId(w, 'course-status-draft').setValue(true);
    await click(w, 'Save');
    expect((callsTo(PUT)[1]!.body as { status: string }).status).toBe('draft');
  });

  it('changes the status after confirmation in a dialog', async () => {
    serve({ [STATUS]: ok(course({ status: 'published' })) });
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    const actions = w.find('.admin-status-actions');
    expect(actions.findAll('button').map((b) => b.text())).toEqual(['Publish', 'Cancel']);

    await actions.findAll('button')[0]!.trigger('click');
    await flushPromises();
    const dialog = w.find('dialog');
    expect(dialog.attributes('open')).toBeDefined();
    expect(byId(w, dialog.attributes('aria-labelledby')!).text()).toBe('Publish?');
    expect(byId(w, dialog.attributes('aria-describedby')!).text()).toContain(
      'Publish course TEST-101?',
    );
    expect(activeId()).toBe(dialog.find('[data-confirm="no"]').attributes('id') ?? '');
    expect(document.activeElement).toBe(dialog.find('[data-confirm="no"]').element);
    await dialog.find('[data-confirm="no"]').trigger('click');
    await flushPromises();
    expect(callsTo(STATUS)).toHaveLength(0);
    expect(w.find('dialog').attributes('open')).toBeUndefined();

    await actions.findAll('button')[0]!.trigger('click');
    await flushPromises();
    await w.find('dialog [data-confirm="yes"]').trigger('click');
    await flushPromises();
    expect(callsTo(STATUS)[0]!.body).toEqual({ status: 'published' });
    expect(w.find('.admin-status-actions .admin-badge').text()).toBe('Published');
    expect(
      w
        .find('.admin-status-actions')
        .findAll('button')
        .map((b) => b.text()),
    ).toEqual(['Withdraw', 'Cancel', 'Back to draft']);
    expect(w.text()).toContain('Status changed to Published.');
    // Published courses cannot be deleted.
    expect(w.text()).not.toContain('Delete course');
  });

  it('deletes after confirmation, and explains a refusal', async () => {
    serve({
      [DELETE]: fail(409, {
        title: 'Conflict',
        status: 409,
        errors: [{ code: 'oecp.content.has_published_offerings', severity: 'error', message: 'x' }],
      }),
    });
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    await click(w, 'Delete course');
    expect(w.find('dialog h2').text()).toBe('Delete this course?');
    await w.find('dialog [data-confirm="yes"]').trigger('click');
    await flushPromises();
    expect(callsTo(DELETE)).toHaveLength(1);
    expect(w.find('[role="alert"]').text()).toContain('Withdraw or cancel them before deleting');

    serve({ [DELETE]: ok(null, 204) });
    const push = vi.spyOn(useRouter(), 'push').mockResolvedValue(undefined);
    const w2 = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    await click(w2, 'Delete course');
    await w2.find('dialog [data-confirm="yes"]').trigger('click');
    await flushPromises();
    expect(push).toHaveBeenCalledWith('/en/admin/courses');
  });

  it('lists the offerings and the history', async () => {
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    const offerings = w.find('[aria-labelledby="offerings-heading"]');
    const history = w.find('[aria-labelledby="course-history-heading"]');
    expect(offerings.find('a.button').attributes('href')).toBe(
      `/en/admin/courses/${COURSE_ID}/offerings/new`,
    );
    expect(offerings.findAll('thead th').map((th) => th.text())).toEqual([
      'Offering code',
      'Session',
      'Dates',
      'Application deadline',
      'Delivery modes',
      'Teaching languages',
      'Seats',
      'Status',
    ]);
    expect(rowCells(w, '[aria-labelledby="offerings-heading"] table')).toEqual([
      [
        '2027S (edit)',
        'Spring semester 2027',
        '2027-02-15 – 2027-06-15',
        '2026-12-15',
        'Online',
        'en',
        'max 30, alliance 5',
        'Draft',
      ],
    ]);
    expect(offerings.find('tbody a').attributes('href')).toBe(
      `/en/admin/courses/${COURSE_ID}/offerings/${OFFERING_ID}`,
    );
    expect(offerings.find('caption').text()).toBe('1 offering of the course');
    expect(history.find('caption').text()).toBe('Latest change');
    expect(rowCells(w, '[aria-labelledby="course-history-heading"] table')[0]!.slice(1)).toEqual([
      'admin@example.org',
      'Admin change',
      'course.update',
      'ECTS 5 → 6',
    ]);
    expect(callsTo(HISTORY)[0]!.query).toEqual({ limit: 50 });
    expect(history.exists()).toBe(true);
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

/** A harvested course whose English title is overridden. */
function harvested() {
  return course({
    source_channel: 'oeapi',
    source_ref: 'oeapi-course-1',
    status: 'published',
    last_seen_at: '2026-10-14T03:00:00.000Z',
    texts: {
      en: { ...course().texts.en!, title: 'Applied statistics (local title)' },
    },
    overrides: { 'texts.en.title': 'Applied statistics (local title)' },
    override_meta: {
      'texts.en.title': { by: 'user-1', at: '2026-10-12T08:00:00.000Z' },
    },
    source_values: { 'texts.en.title': 'Applied Statistics I' },
  });
}

describe('overrides mode', () => {
  beforeEach(() => {
    serve({
      [REFERENCE]: ok(reference({ form_mode: 'overrides', authoritative_channel: 'oeapi' })),
      [COURSE]: ok(harvested()),
      [PATCH]: ok(harvested()),
    });
  });

  it('shows source values, enables a field with Override and PATCHes the toggled fields only', async () => {
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    expect(w.find('.admin-override-banner').text()).toContain(
      "harvested from the partner's OEAPI endpoint",
    );
    expect(w.text()).not.toContain('Delete course');
    expect(w.find('[aria-labelledby="offerings-heading"] a.button').exists()).toBe(false);

    const ects = byId(w, 'course-ects');
    expect(ects.attributes('disabled')).toBeDefined();
    expect(ects.attributes('aria-describedby')).toContain('course-ects-source');
    expect(byId(w, 'course-ects-source').text()).toBe("Source value (partner's OEAPI): 6");
    expect(w.find('label[for="course-ects-override"]').text()).toBe('Override ECTS credits');
    expect(byId(w, 'course-ects-override').attributes('type')).toBe('checkbox');
    expect(byId(w, 'course-kind').attributes('disabled')).toBeDefined();
    // Not overridable (not in the schema's override fields): read-only, no toggle.
    expect(byId(w, 'course-teaching_unit_ext_id').attributes('disabled')).toBeDefined();
    expect(byId(w, 'course-teaching_unit_ext_id-override').exists()).toBe(false);
    expect(await axeViolations(w.html())).toEqual([]);

    await byId(w, 'course-ects-override').setValue(true);
    expect(byId(w, 'course-ects').attributes('disabled')).toBeUndefined();
    await setField(w, 'course-ects', '7.5');
    // Toggled on, then off again: not sent.
    await byId(w, 'course-info_url-override').setValue(true);
    await setField(w, 'course-info_url', 'https://elsewhere.example.org');
    await byId(w, 'course-info_url-override').setValue(false);
    expect((byId(w, 'course-info_url').element as HTMLInputElement).value).toBe(
      'https://www.example.org/test-101',
    );

    await stepButtons(w)[1]!.trigger('click');
    await flushPromises();
    const title = byId(w, 'course-texts-en-title');
    expect(title.attributes('disabled')).toBeUndefined();
    expect((title.element as HTMLInputElement).value).toBe('Applied statistics (local title)');
    expect(byId(w, 'course-texts-en-title-source').text()).toContain('Applied Statistics I');
    expect(w.find('.admin-override--on .admin-badge').text()).toBe('Overridden');
    // No adding or removing languages on harvested records.
    expect(byId(w, 'course-texts-add').exists()).toBe(false);
    // Revert the title to the source value.
    await byId(w, 'course-texts-en-title-override').setValue(false);
    expect((byId(w, 'course-texts-en-title').element as HTMLInputElement).value).toBe(
      'Applied Statistics I',
    );
    expect(w.text()).toContain('Saving reverts this field to the source value.');

    await stepButtons(w)[3]!.trigger('click');
    await flushPromises();
    expect(w.findAll('.admin-pending li').map((li) => li.text())).toEqual([
      'Override ECTS credits: 7.5',
      'Revert Title (English) to the source value',
    ]);
    expect(w.find('input[name="course-status"]').exists()).toBe(false);
    await click(w, 'Save overrides');

    expect(callsTo(PUT)).toHaveLength(0);
    expect(callsTo(PATCH)[0]!.body).toEqual({ set: { ects: 7.5 }, clear: ['texts.en.title'] });
    expect(w.find('.admin-save-result').text()).toBe('Overrides saved.');
  });

  it('validates only the overridden fields and maps errors of `set` keys', async () => {
    serve({
      [REFERENCE]: ok(reference({ form_mode: 'overrides' })),
      [COURSE]: ok(harvested()),
      [PATCH]: fail(
        400,
        validationProblem([
          { code: 'oecp.content.override_not_allowed', json_pointer: '/set/texts.en.abstract' },
        ]),
      ),
    });
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    await click(w, 'Save overrides');
    expect(w.find('.admin-save-result').text()).toBe('There are no changes to save.');
    expect(callsTo(PATCH)).toHaveLength(0);

    await byId(w, 'course-ects-override').setValue(true);
    await setField(w, 'course-ects', 'many');
    await click(w, 'Save overrides');
    expect(summaryItems(w)).toEqual([
      ['ECTS credits: Enter a number of credits greater than 0 and at most 120.', '#course-ects'],
    ]);
    await setField(w, 'course-ects', '5');
    await stepButtons(w)[1]!.trigger('click');
    await flushPromises();
    await byId(w, 'course-texts-en-abstract-override').setValue(true);
    await setField(w, 'course-texts-en-abstract', 'New abstract');
    await click(w, 'Save overrides');
    expect(callsTo(PATCH)[0]!.body).toEqual({
      set: { ects: 5, 'texts.en.abstract': 'New abstract' },
      clear: [],
    });
    expect(summaryItems(w)).toEqual([
      ['Abstract (English): This field cannot be overridden.', '#course-texts-en-abstract'],
    ]);
  });
});

/** Fills the required fields of a new offering. */
async function fillOffering(w: Wrapper) {
  await setField(w, 'offering-ext_offering_id', '2027F');
  await byId(w, 'offering-academic_session_ext_id').setValue('2026-27-S2');
  await setField(w, 'offering-start_date', '2027-09-15');
  await setField(w, 'offering-end_date', '2028-01-31');
  await setField(w, 'offering-application_deadline', '2027-06-30');
  await byId(w, 'offering-teaching_languages-0').setValue(true);
  await byId(w, 'offering-delivery_modes-2').setValue(true);
}

describe('offerings', () => {
  it('creates an offering with the OfferingInput payload', async () => {
    serve({ [CREATE_OFFERING]: ok(offering({ id: OFFERING_ID, ext_offering_id: '2027F' }), 201) });
    const push = vi.spyOn(useRouter(), 'push').mockResolvedValue(undefined);
    const w = await mountPage(NewOfferingPage, `/en/admin/courses/${COURSE_ID}/offerings/new`);
    expect(w.find('h1').text()).toBe('New offering');
    expect(w.text()).toContain('Course: Applied statistics');
    const zones = byId(w, 'offering-timezone').findAll('option');
    expect(zones[0]!.text()).toBe('Europe/Madrid (organization default)');
    expect(zones.length).toBeGreaterThan(100);
    expect((byId(w, 'offering-timezone').element as HTMLSelectElement).value).toBe('Europe/Madrid');
    expect(await axeViolations(w.html())).toEqual([]);

    await click(w, 'Create offering');
    expect(summaryItems(w).map(([text]) => text)).toEqual([
      'Offering code: Enter a value.',
      'Start date: Enter a value.',
      'End date: Enter a value.',
      'Teaching languages: Choose at least one teaching language.',
      'Delivery modes: Choose at least one delivery mode.',
    ]);
    expect(w.find('.admin-error-summary').element.contains(document.activeElement)).toBe(true);
    await w.findAll('.admin-error-summary a')[3]!.trigger('click');
    await flushPromises();
    expect(activeId()).toBe('offering-teaching_languages-0');

    await fillOffering(w);
    await setField(w, 'offering-enrol_start_date', '2027-07-01');
    await setField(w, 'offering-max_students', '20');
    await setField(w, 'offering-alliance_seats', '25');
    await setField(w, 'offering-application_url', 'ftp://apply');
    await click(w, 'Create offering');
    expect(summaryItems(w).map(([text]) => text)).toEqual([
      'Application period start: The application period must start on or before the deadline.',
      'Seats reserved for the alliance: This cannot be more than the maximum number of students.',
      'Application page: Enter a web address starting with https://.',
    ]);

    await setField(w, 'offering-enrol_start_date', '2027-03-01');
    await setField(w, 'offering-alliance_seats', '4');
    await setField(w, 'offering-application_url', 'https://apply.example.org/2027F');
    await setField(w, 'offering-campus', 'Sescelades');
    await setField(w, 'offering-application_instructions-en', 'Nomination by the home university.');
    await byId(w, 'offering-instructions-add').setValue('es');
    await click(w, 'Add');
    await setField(w, 'offering-application_instructions-es', 'Nominación por la universidad.');
    await byId(w, 'offering-status-published').setValue(true);
    await click(w, 'Create offering');

    expect(callsTo(CREATE_OFFERING)[0]!.body).toEqual({
      ext_offering_id: '2027F',
      status: 'published',
      academic_session_ext_id: '2026-27-S2',
      start_date: '2027-09-15',
      end_date: '2028-01-31',
      enrol_start_date: '2027-03-01',
      application_deadline: '2027-06-30',
      timezone: 'Europe/Madrid',
      teaching_languages: ['en'],
      delivery_modes: ['hybrid'],
      campus: 'Sescelades',
      max_students: 20,
      alliance_seats: 4,
      seats_available: null,
      application_url: 'https://apply.example.org/2027F',
      application_instructions: {
        en: 'Nomination by the home university.',
        es: 'Nominación por la universidad.',
      },
    });
    expect(push).toHaveBeenCalledWith(`/en/admin/courses/${COURSE_ID}/offerings/${OFFERING_ID}`);
  });

  it('puts the organization default time zone first and accepts a typed session code', async () => {
    serve({
      [REFERENCE]: ok(reference({ default_timezone: 'Europe/Vienna' })),
      [CREATE_OFFERING]: ok(offering(), 201),
    });
    vi.spyOn(useRouter(), 'push').mockResolvedValue(undefined);
    const w = await mountPage(NewOfferingPage, `/en/admin/courses/${COURSE_ID}/offerings/new`);
    expect(byId(w, 'offering-timezone').find('option').text()).toBe(
      'Europe/Vienna (organization default)',
    );
    await fillOffering(w);
    await byId(w, 'offering-academic_session_ext_id').setValue('__other__');
    await click(w, 'Create offering');
    expect(summaryItems(w)).toEqual([
      ['Academic session: Enter a value.', '#offering-academic_session_ext_id'],
    ]);
    await setField(w, 'offering-academic_session_ext_id', 'SUMMER-27');
    await click(w, 'Create offering');
    expect(callsTo(CREATE_OFFERING)[0]!.body).toMatchObject({
      academic_session_ext_id: 'SUMMER-27',
      timezone: 'Europe/Vienna',
    });
  });

  it('edits an offering with PUT (e.g. more alliance seats) and changes its status', async () => {
    serve({
      [PUT_OFFERING]: ok(offering({ alliance_seats: 8 })),
      [OFFERING_STATUS]: ok(offering({ status: 'published' })),
    });
    const w = await mountPage(
      OfferingPage,
      `/en/admin/courses/${COURSE_ID}/offerings/${OFFERING_ID}`,
    );
    expect(w.find('h1').text()).toBe('Offering 2027S');
    expect(byId(w, 'offering-ext_offering_id').text()).toBe('2027S');
    expect((byId(w, 'offering-alliance_seats').element as HTMLInputElement).value).toBe('5');
    expect(await axeViolations(w.html())).toEqual([]);

    await setField(w, 'offering-alliance_seats', '8');
    await click(w, 'Save offering');
    expect(callsTo(PUT_OFFERING)[0]!.body).toEqual({
      ext_offering_id: '2027S',
      status: 'draft',
      academic_session_ext_id: '2026-27-S2',
      start_date: '2027-02-15',
      end_date: '2027-06-15',
      enrol_start_date: '2026-11-01',
      application_deadline: '2026-12-15',
      timezone: 'Europe/Madrid',
      teaching_languages: ['en'],
      delivery_modes: ['online'],
      campus: null,
      max_students: 30,
      alliance_seats: 8,
      seats_available: null,
      application_url: 'https://apply.example.org/2027S',
      application_instructions: { en: 'Ask your home coordinator for a nomination.' },
    });
    expect(w.find('.admin-save-result').text()).toBe('Offering saved.');

    await w.find('.admin-status-actions button').trigger('click');
    await flushPromises();
    expect(w.find('dialog p').text()).toContain('Publish offering 2027S?');
    await w.find('dialog [data-confirm="yes"]').trigger('click');
    await flushPromises();
    expect(callsTo(OFFERING_STATUS)[0]!.body).toEqual({ status: 'published' });
    expect(w.find('.admin-status-actions .admin-badge').text()).toBe('Published');
  });

  it('overrides a harvested offering with PATCH', async () => {
    const harvestedOffering = offering({
      source_channel: 'oeapi',
      alliance_seats: 10,
      overrides: { alliance_seats: 10 },
      override_meta: { alliance_seats: { by: 'user-1', at: '2026-10-12T08:00:00.000Z' } },
      source_values: { alliance_seats: null },
    });
    serve({
      [REFERENCE]: ok(reference({ form_mode: 'overrides' })),
      [COURSE]: ok(course({ source_channel: 'oeapi', offerings: [harvestedOffering] })),
      [PATCH_OFFERING]: ok(harvestedOffering),
    });
    const w = await mountPage(
      OfferingPage,
      `/en/admin/courses/${COURSE_ID}/offerings/${OFFERING_ID}`,
    );
    expect(w.find('.admin-override-banner').exists()).toBe(true);
    expect(w.text()).not.toContain('Delete offering');
    expect(byId(w, 'offering-alliance_seats-source').text()).toBe(
      "Source value (partner's OEAPI): (empty)",
    );
    expect(byId(w, 'offering-alliance_seats').attributes('disabled')).toBeUndefined();
    expect(byId(w, 'offering-max_students').attributes('disabled')).toBeDefined();
    expect(byId(w, 'offering-academic_session_ext_id').attributes('disabled')).toBeDefined();
    await byId(w, 'offering-max_students-override').setValue(true);
    await setField(w, 'offering-max_students', '40');
    await setField(w, 'offering-alliance_seats', '12');
    await byId(w, 'offering-application_deadline-override').setValue(true);
    await setField(w, 'offering-application_deadline', '2026-12-20');
    expect(await axeViolations(w.html())).toEqual([]);
    await click(w, 'Save overrides');
    expect(callsTo(PATCH_OFFERING)[0]!.body).toEqual({
      set: { application_deadline: '2026-12-20', max_students: 40, alliance_seats: 12 },
      clear: [],
    });
    expect(callsTo(PUT_OFFERING)).toHaveLength(0);
  });

  it('reports an offering that is not part of the course', async () => {
    serve({ [COURSE]: ok(course({ offerings: [] })) });
    const w = await mountPage(
      OfferingPage,
      `/en/admin/courses/${COURSE_ID}/offerings/${OFFERING_ID}`,
    );
    expect(w.find('[role="alert"]').text()).toContain('does not exist');
  });
});

describe('IT Handbook alignment [DL 21]', () => {
  it('shows a completeness column in the list once the API sends `complete`', async () => {
    serve({
      [LIST]: ok(
        courseList([
          listItem(1, { complete: true }),
          listItem(2, { complete: false }),
          listItem(3),
        ]),
      ),
    });
    const w = await mountPage(CoursesPage, '/en/admin/courses');
    expect(
      w
        .findAll('thead th')
        .map((th) => th.text())
        .at(-1),
    ).toBe('Completeness');
    const cells = w.findAll('tbody tr').map((r) => r.findAll('td').at(-1)!);
    expect(cells[0]!.find('[aria-hidden="true"]').text()).toBe('✓');
    expect(cells[0]!.find('.visually-hidden').text()).toBe('Complete');
    expect(cells[1]!.find('.admin-badge').text()).toBe('Incomplete');
    expect(cells[1]!.find('.admin-badge').classes()).toContain('admin-badge--warn');
    expect(cells[2]!.text()).toBe('Not available');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('edits instructors and the optional texts and sends them with PUT', async () => {
    const saved = handbookCourse();
    serve({ [COURSE]: ok(handbookCourse()), [PUT]: ok(saved) });
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    const instructors = byId(w, 'course-instructors');
    expect(instructors.element.tagName).toBe('TEXTAREA');
    expect((instructors.element as HTMLTextAreaElement).value).toBe(
      'Dr. Ada Lovelace\nProf. Alan Turing',
    );
    expect(w.find('label[for="course-instructors"]').text()).toContain('Instructors');
    expect(byId(w, 'course-instructors-hint').text()).toBe(
      'One name per line, at most 50 names of up to 200 characters each. The names are shown on the public course page.',
    );
    await setField(w, 'course-instructors', 'Dr. Ada Lovelace\nDr. Grace Hopper');

    await stepButtons(w)[1]!.trigger('click');
    await flushPromises();
    // Filled optional texts open the "More texts" group.
    const more = w.find('details.admin-more-texts');
    expect((more.element as HTMLDetailsElement).open).toBe(true);
    expect((byId(w, 'course-texts-en-methods').element as HTMLTextAreaElement).value).toBe(
      'Lectures and computer labs.',
    );
    expect(byId(w, 'course-texts-en-methods').attributes('lang')).toBe('en');
    await setField(w, 'course-texts-en-literature', 'Wasserman, All of Statistics.');
    await setField(w, 'course-texts-en-privacy_notice', '');
    expect(await axeViolations(w.html())).toEqual([]);
    await click(w, 'Save');

    const [request] = callsTo(PUT);
    expect(request!.body).toMatchObject({
      instructors: ['Dr. Ada Lovelace', 'Dr. Grace Hopper'],
      texts: {
        en: {
          title: 'Applied statistics',
          methods: 'Lectures and computer labs.',
          mode_of_repetition: 'Every autumn semester.',
          literature: 'Wasserman, All of Statistics.',
          remarks: null,
          privacy_notice: null,
        },
      },
    });
  });

  it('validates the instructors on the Basics step', async () => {
    serve({ [COURSE]: ok(handbookCourse()) });
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    await setField(
      w,
      'course-instructors',
      Array.from({ length: 51 }, (_, i) => `Instructor ${i + 1}`).join('\n'),
    );
    await click(w, 'Save');
    expect(callsTo(PUT)).toHaveLength(0);
    expect(summaryItems(w)).toEqual([
      ['Instructors: Enter at most 50 instructors.', '#course-instructors'],
    ]);
    expect(byId(w, 'course-instructors').attributes('aria-invalid')).toBe('true');
    await setField(w, 'course-instructors', 'x'.repeat(201));
    await click(w, 'Save');
    expect(summaryItems(w)).toEqual([
      ['Instructors: Each instructor name can have at most 200 characters.', '#course-instructors'],
    ]);
  });

  it('shows the completeness of the saved course on the Review step', async () => {
    serve({ [COURSE]: ok(handbookCourse()) });
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    await stepButtons(w)[3]!.trigger('click');
    await flushPromises();
    const card = w.find('.admin-completeness');
    expect(card.attributes('aria-labelledby')).toBe('course-completeness-heading');
    expect(card.find('h3').text()).toBe('Completeness');
    expect(card.find('.admin-badge').text()).toBe('4 fields missing');
    expect(card.findAll('li').map((li) => li.text())).toEqual([
      'Learning outcomes (English)',
      'Requirements: prerequisites (English)',
      'Assessment (English)',
      'A published offering',
    ]);
    expect(card.text()).toContain('incomplete courses are kept as drafts');
    expect(await axeViolations(w.html())).toEqual([]);

    serve({
      [COURSE]: ok(handbookCourse({ completeness: { complete: true, missing: [] } })),
    });
    const complete = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    await stepButtons(complete)[3]!.trigger('click');
    await flushPromises();
    expect(complete.find('.admin-completeness .admin-badge').text()).toBe('Complete');
    expect(complete.find('.admin-completeness ul').exists()).toBe(false);
  });

  it('shows no completeness card for a course from an older API', async () => {
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    await stepButtons(w)[3]!.trigger('click');
    await flushPromises();
    expect(w.find('#course-step-heading').text()).toBe('Step 4 of 4: Review and status');
    expect(w.find('.admin-completeness').exists()).toBe(false);
  });

  it('overrides instructors and an optional text of a harvested course with PATCH', async () => {
    const source = handbookCourse({ source_channel: 'oeapi', status: 'published' });
    serve({
      [REFERENCE]: ok(reference({ form_mode: 'overrides', authoritative_channel: 'oeapi' })),
      [COURSE]: ok(source),
      [PATCH]: ok(source),
    });
    const w = await mountPage(CoursePage, `/en/admin/courses/${COURSE_ID}`);
    expect(byId(w, 'course-instructors').attributes('disabled')).toBeDefined();
    expect(byId(w, 'course-instructors-source').text()).toBe(
      "Source value (partner's OEAPI): Dr. Ada Lovelace; Prof. Alan Turing",
    );
    await byId(w, 'course-instructors-override').setValue(true);
    await setField(w, 'course-instructors', 'Dr. Grace Hopper');

    await stepButtons(w)[1]!.trigger('click');
    await flushPromises();
    await byId(w, 'course-texts-en-remarks-override').setValue(true);
    await setField(w, 'course-texts-en-remarks', 'Taught jointly with TU Delft.');

    await stepButtons(w)[3]!.trigger('click');
    await flushPromises();
    expect(w.findAll('.admin-pending li').map((li) => li.text())).toEqual([
      'Override Instructors: Dr. Grace Hopper',
      'Override Remarks (English): Taught jointly with TU Delft.',
    ]);
    expect(w.find('.admin-completeness').exists()).toBe(true);
    await click(w, 'Save overrides');
    expect(callsTo(PATCH)[0]!.body).toEqual({
      set: {
        instructors: ['Dr. Grace Hopper'],
        'texts.en.remarks': 'Taught jointly with TU Delft.',
      },
      clear: [],
    });
  });
});
