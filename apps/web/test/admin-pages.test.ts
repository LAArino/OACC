// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
// Admin pages with a signed-in administrator (useAuth mocked) and the API
// answered by a fake `$fetch` (see helpers/admin.ts). Browser validation runs
// the real shared validator on the main thread (no Worker in these tests).
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { CSV_MAX_FILE_BYTES } from '@oecp/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CsvPage from '../app/pages/(admin)/admin/csv.vue';
import DashboardPage from '../app/pages/(admin)/admin/index.vue';
import RunPage from '../app/pages/(admin)/admin/sync-runs/[id].vue';
import RunsPage from '../app/pages/(admin)/admin/sync-runs/index.vue';
import {
  createFakeFetch,
  csv,
  csvFile,
  type FakeRequest,
  fixtures,
  ORG_ID,
  OTHER_ORG_ID,
  problem,
  type Route,
  RUN_ID,
} from './helpers/admin';
import { axeViolations } from './helpers/catalogue';

// `$fetch` is an auto-import bound at load time: delegate to the current fake.
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
  restoring: { value: false },
  login: async () => undefined,
  logout: async () => undefined,
  handleCallback: async () => '/en/admin',
  restoreSession: async () => auth.signedIn,
  handleSilentCallback: async () => undefined,
}));

const ME = 'GET /api/admin/v1/me';
const REFERENCE = 'GET /api/public/v1/reference';
const UPLOAD = `POST /api/admin/v1/organizations/${ORG_ID}/uploads`;
const RUNS = `GET /api/admin/v1/organizations/${ORG_ID}/sync-runs`;
const RUN = `GET /api/admin/v1/sync-runs/${RUN_ID}`;

const ok =
  (body: unknown, status = 200): Route =>
  () => ({ status, body: structuredClone(body) });

let calls: FakeRequest[] = [];
function serve(routes: Record<string, Route>) {
  const fake = createFakeFetch({
    [ME]: ok(fixtures.me(['partner_admin'])),
    [REFERENCE]: ok(fixtures.reference),
    ...routes,
  });
  calls = fake.calls;
  net.fetch = fake.fetch;
}
const callsTo = (key: string) => calls.filter((c) => `${c.method} ${c.url}` === key);

beforeEach(() => {
  // A new token per test: `/me` is cached per access token.
  auth.signedIn = true;
  auth.token = `token-${++auth.count}`;
  vi.stubGlobal('Worker', undefined);
  serve({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mountPage(component: unknown, route: string) {
  const w = await mountSuspended(component as never, { route, attachTo: document.body });
  await flushPromises();
  return w;
}

type Wrapper = Awaited<ReturnType<typeof mountPage>>;

async function drop(w: Wrapper, files: File[]) {
  await w.find('.admin-dropzone__target').trigger('drop', { dataTransfer: { files } });
  await vi.waitFor(() => {
    expect(w.find('.admin-csv__status').text()).not.toBe('Checking the files…');
    expect(w.find('.admin-csv__status').text()).not.toBe('');
  });
}

const uploadButton = (w: Wrapper) => w.findAll('button').find((b) => b.text() === 'Upload')!;
const facts = (w: Wrapper, selector: string) => {
  const dl = w.find(selector);
  const dds = dl.findAll('dd');
  return Object.fromEntries(dl.findAll('dt').map((dt, i) => [dt.text(), dds[i]!.text()]));
};

describe('dashboard', () => {
  it('lists the partner modules for the token organization', async () => {
    const w = await mountPage(DashboardPage, '/en/admin');
    expect(w.find('#account-heading').exists()).toBe(true);
    const links = w.findAll('nav[aria-labelledby="modules-heading"] .admin-modules a');
    expect(links.map((a) => [a.text(), a.attributes('href')])).toEqual([
      ['Courses', '/en/admin/courses'],
      ['CSV upload', '/en/admin/csv'],
      ['Sync history', '/en/admin/sync-runs'],
      ['Integration settings', '/en/admin/integration'],
      ['Invitations', '/en/admin/invitations'],
    ]);
    // Alliance modules are for alliance administrators only.
    expect(w.find('a[href="/en/admin/network"]').exists()).toBe(false);
    expect(w.find('nav select').exists()).toBe(false);
    expect(w.text()).toContain('Universitat Rovira i Virgili');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('gives alliance administrators an organization selector driving ?org=', async () => {
    serve({ [ME]: ok(fixtures.me(['alliance_admin'], null)) });
    const w = await mountPage(DashboardPage, '/en/admin');
    const select = w.find('nav select');
    expect(w.find(`label[for="${select.attributes('id')}"]`).text()).toBe('Organization');
    const options = select.findAll('option').map((o) => o.text());
    expect(options[0]).toBe('Choose an organization');
    expect(options).toContain('Aurora Foundation');
    expect(options).toContain('Vrije Universiteit Amsterdam');
    expect(w.text()).toContain('Choose an organization to open its modules.');
    expect(w.find('a[href="/en/admin/organizations"]').text()).toBe('Organizations');
    expect(w.find('a[href="/en/admin/network"]').text()).toBe('Network status');

    const w2 = await mountPage(DashboardPage, `/en/admin?org=${OTHER_ORG_ID}`);
    expect((w2.find('nav select').element as HTMLSelectElement).value).toBe(OTHER_ORG_ID);
    expect(w2.find('.admin-modules a').attributes('href')).toBe(
      `/en/admin/courses?org=${OTHER_ORG_ID}`,
    );
    expect(await axeViolations(w2.html())).toEqual([]);
  });

  it('shows no modules without an administration role', async () => {
    serve({ [ME]: ok(fixtures.me([], null)) });
    const w = await mountPage(DashboardPage, '/en/admin');
    expect(w.text()).toContain('Your account has no administration role yet.');
    expect(w.find('.admin-modules').exists()).toBe(false);
  });

  it('asks to sign in when nobody is signed in', async () => {
    auth.signedIn = false;
    const w = await mountPage(DashboardPage, '/en/admin');
    expect(w.findAll('button').map((b) => b.text())).toContain('Sign in');
    expect(callsTo(ME)).toHaveLength(0);
  });
});

describe('CSV console', () => {
  it('detects the kinds, validates in the browser and enables the upload', async () => {
    const w = await mountPage(CsvPage, '/en/admin/csv');
    expect(w.find('h1').text()).toBe('CSV upload');
    expect(uploadButton(w).attributes('disabled')).toBeDefined();

    await drop(w, [csvFile(csv.offerings, 'export.csv'), csvFile(csv.courses, 'courses.csv')]);
    const rows = w.findAll('table[class="admin-table"]')[0]!.findAll('tbody tr');
    expect(rows.map((r) => r.find('th').text())).toEqual(['export.csv', 'courses.csv']);
    expect(rows.map((r) => (r.find('select').element as HTMLSelectElement).value)).toEqual([
      'offerings',
      'courses',
    ]);
    expect(rows[0]!.text()).toContain('Detected from the header columns.');
    expect(w.find(`label[for="${rows[0]!.find('select').attributes('id')}"]`).text()).toBe(
      'Type of export.csv',
    );

    expect(facts(w, '[aria-labelledby="report-heading"] dl')).toEqual({
      Rows: '2',
      Errors: '0',
      Warnings: '0',
    });
    expect(document.activeElement?.id).toBe('report-heading');
    expect(w.find('.admin-csv__status').attributes('role')).toBe('status');
    expect(w.find('.admin-csv__status').text()).toBe(
      'Check finished: no errors, 0 warnings. You can upload the files.',
    );
    expect(uploadButton(w).attributes('disabled')).toBeUndefined();
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('reports errors with row and column, filters them and blocks the upload', async () => {
    const w = await mountPage(CsvPage, '/en/admin/csv');
    await drop(w, [csvFile(csv.invalidCourses, 'my courses.csv')]);
    expect(facts(w, '[aria-labelledby="report-heading"] dl')).toMatchObject({ Errors: '2' });
    const table = w.find('[aria-labelledby="report-heading"] table');
    expect(table.find('caption').text()).toBe('Issues found in your files');
    const cells = table.findAll('tbody tr').map((r) => r.findAll('td').map((td) => td.text()));
    expect(cells).toEqual([
      ['Error', 'courses.csv', '2', 'ects', 'oecp.csv.invalid_number', 'Invalid number'],
      [
        'Error',
        'courses.csv',
        '3',
        'isced_codes',
        'oecp.content.unknown_isced_field',
        'Unknown ISCED broad field: 9999',
      ],
    ]);
    await w.find('[aria-labelledby="report-heading"] select').setValue('warning');
    expect(w.find('[aria-labelledby="report-heading"]').text()).toContain('No issues to show.');
    expect(uploadButton(w).attributes('disabled')).toBeDefined();
    expect(w.find('#upload-hint').text()).toContain('once the check finds no errors');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('allows warnings', async () => {
    const w = await mountPage(CsvPage, '/en/admin/csv');
    await drop(w, [csvFile(csv.courses, 'a.csv'), csvFile(csv.emptyOfferings, 'b.csv')]);
    expect(facts(w, '[aria-labelledby="report-heading"] dl')).toEqual({
      Rows: '1',
      Errors: '0',
      Warnings: '1',
    });
    expect(uploadButton(w).attributes('disabled')).toBeUndefined();
  });

  it('asks for the kind when it cannot be detected, and refuses two files of one kind', async () => {
    const w = await mountPage(CsvPage, '/en/admin/csv');
    await w
      .find('.admin-dropzone__target')
      .trigger('drop', { dataTransfer: { files: [csvFile('a,b\n1,2\n', 'data.csv')] } });
    await vi.waitFor(() => expect(w.find('tbody select').exists()).toBe(true));
    expect((w.find('tbody select').element as HTMLSelectElement).value).toBe('');
    expect(w.text()).toContain('Not detected: choose the type.');
    expect(w.find('#upload-hint').text()).toBe('Choose the type of every file to check it.');
    expect(w.find('#report-heading').exists()).toBe(false);

    await w.find('tbody select').setValue('courses');
    await vi.waitFor(() => expect(w.find('#report-heading').exists()).toBe(true));
    expect(w.text()).toContain('Chosen by you.');
    expect(w.find('[aria-labelledby="report-heading"] tbody').text()).toContain(
      'oecp.csv.unknown_column',
    );

    await w
      .find('.admin-dropzone__target')
      .trigger('drop', { dataTransfer: { files: [csvFile(csv.courses, 'courses.csv')] } });
    await vi.waitFor(() => expect(w.text()).toContain('Both files have the same type'));
    expect(w.find('#report-heading').exists()).toBe(false);
    expect(uploadButton(w).attributes('disabled')).toBeDefined();
    // The drop zone is full: two files at most.
    expect(w.find('.admin-dropzone__target').attributes('aria-disabled')).toBe('true');

    await w
      .findAll('button')
      .find((b) => b.text() === 'Remove data.csv')!
      .trigger('click');
    await vi.waitFor(() => expect(w.find('#report-heading').exists()).toBe(true));
    expect(uploadButton(w).attributes('disabled')).toBeUndefined();
  });

  it('ignores files beyond two and rejects files above the size limit', async () => {
    const w = await mountPage(CsvPage, '/en/admin/csv');
    const big = csvFile(csv.courses, 'courses.csv');
    Object.defineProperty(big, 'size', { value: CSV_MAX_FILE_BYTES + 1 });
    await drop(w, [big, csvFile(csv.offerings, 'offerings.csv'), csvFile(csv.courses, 'c.csv')]);
    expect(w.text()).toContain('At most two files can be uploaded together');
    expect(w.findAll('tbody tr').length).toBeGreaterThanOrEqual(2);
    expect(w.text()).toContain('Larger than 5 MB');
    const report = w.find('[aria-labelledby="report-heading"]');
    expect(report.find('tbody').text()).toContain('oecp.csv.file_too_large');
    expect(facts(w, '[aria-labelledby="report-heading"] dl')).toMatchObject({ Errors: '1' });
    expect(uploadButton(w).attributes('disabled')).toBeDefined();
  });

  it('uploads with the bearer token and renders an inline (201) result', async () => {
    serve({
      [UPLOAD]: ok(
        {
          sync_run_id: RUN_ID,
          status: 'succeeded',
          processed_inline: true,
          run: fixtures.run(),
          warnings: [
            {
              code: 'oecp.csv.no_data_rows',
              severity: 'warning',
              message: 'No rows',
              file: 'offerings',
              row: 1,
            },
          ],
        },
        201,
      ),
    });
    const w = await mountPage(CsvPage, '/en/admin/csv');
    await drop(w, [csvFile(csv.courses, 'mine.csv'), csvFile(csv.offerings, 'offerings.csv')]);
    await uploadButton(w).trigger('click');
    await flushPromises();

    const [request] = callsTo(UPLOAD);
    expect(request!.headers).toEqual({ authorization: `Bearer ${auth.token}` });
    const form = request!.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get('courses') as File).name).toBe('mine.csv');
    expect((form.get('offerings') as File).name).toBe('offerings.csv');

    const result = w.find('[aria-labelledby="result-heading"]');
    expect(document.activeElement?.id).toBe('result-heading');
    expect(result.text()).toContain('Upload processed. Status: Succeeded.');
    expect(facts(w, '[aria-labelledby="result-heading"] dl')).toMatchObject({
      Created: '2',
      Updated: '1',
      Unchanged: '3',
    });
    expect(result.find('a').attributes('href')).toBe(`/en/admin/sync-runs/${RUN_ID}`);
    expect(result.find('caption').text()).toBe('Warnings reported by the server');
    expect(uploadButton(w).attributes('disabled')).toBeDefined();
    expect(await axeViolations(w.html())).toEqual([]);

    await w
      .findAll('button')
      .find((b) => b.text() === 'Start over')!
      .trigger('click');
    await flushPromises();
    expect(w.find('[aria-labelledby="result-heading"]').exists()).toBe(false);
    expect(w.find('#report-heading').exists()).toBe(false);
    expect(w.find('tbody').exists()).toBe(false);
    expect(document.activeElement?.id).toBe('files-heading');
  });

  it('polls a queued (202) upload every 3 s until the run ends', async () => {
    const statuses = ['running', 'succeeded'] as const;
    let polls = 0;
    serve({
      [UPLOAD]: ok({ sync_run_id: RUN_ID, status: 'queued', processed_inline: false }, 202),
      [RUN]: () => ({
        status: 200,
        body: fixtures.runDetail({ status: statuses[Math.min(polls++, 1)] }),
      }),
    });
    const w = await mountPage(CsvPage, '/en/admin/csv');
    await drop(w, [csvFile(csv.courses, 'courses.csv')]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await uploadButton(w).trigger('click');
    await flushPromises();
    const result = () => w.find('[aria-labelledby="result-heading"]');
    expect(result().text()).toContain('The upload is queued for processing.');
    expect(result().find('a').attributes('href')).toBe(`/en/admin/sync-runs/${RUN_ID}`);
    expect(callsTo(RUN)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();
    expect(callsTo(RUN)).toHaveLength(1);
    expect(result().text()).toContain('Running');

    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();
    expect(callsTo(RUN)).toHaveLength(2);
    expect(result().text()).toContain('Processing finished. Status: Succeeded.');

    await vi.advanceTimersByTimeAsync(9000);
    expect(callsTo(RUN)).toHaveLength(2);
    expect(callsTo(RUN)[0]!.query).toEqual({ page_size: 100 });
  });

  it('renders the server error table of a rejected (422) upload', async () => {
    serve({
      [UPLOAD]: () => ({
        status: 422,
        body: {
          type: '/problems/validation-failed',
          title: 'Upload validation failed',
          status: 422,
          instance: `/api/admin/v1/sync-runs/${RUN_ID}`,
          errors: [
            {
              code: 'oecp.csv.invalid_date',
              severity: 'error',
              file: 'offerings',
              row: 14,
              column: 'start_date',
              message: 'Expected YYYY-MM-DD',
            },
            {
              code: 'oecp.content.unknown_course',
              severity: 'error',
              file: 'offerings',
              row: 15,
              column: 'course_code',
              message: 'Unknown course',
            },
          ],
          sync_run_id: RUN_ID,
          run_status: 'failed',
          processed_inline: true,
          error_count: 2,
          warning_count: 0,
        },
      }),
    });
    const w = await mountPage(CsvPage, '/en/admin/csv');
    await drop(w, [csvFile(csv.offerings, 'offerings.csv')]);
    await uploadButton(w).trigger('click');
    await flushPromises();
    const result = w.find('[aria-labelledby="result-heading"]');
    expect(result.find('[role="alert"]').text()).toContain(
      'The server rejected the upload: 2 errors and 0 warnings. Nothing was saved.',
    );
    expect(result.find('a').attributes('href')).toBe(`/en/admin/sync-runs/${RUN_ID}`);
    expect(result.find('caption').text()).toBe('Issues reported by the server');
    const cells = result.findAll('tbody tr').map((r) => r.findAll('td').map((td) => td.text()));
    expect(cells[0]).toEqual([
      'Error',
      'offerings.csv',
      '14',
      'start_date',
      'oecp.csv.invalid_date',
      'Expected YYYY-MM-DD',
    ]);
    expect(result.findAll('button').map((b) => b.text())).toContain('Download report as CSV');
    // A rejected upload can be fixed and selected again, not resent as is.
    expect(uploadButton(w).attributes('disabled')).toBeDefined();
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it.each([
    [409, 'oecp.sync.channel_disabled', 'CSV uploads are disabled'],
    [413, 'oecp.csv.file_too_large', 'A file is larger than 5 MB'],
    [429, 'oecp.csv.rate_limited', 'The upload limit of 10 uploads per hour'],
  ])('explains a %s problem', async (status, code, text) => {
    serve({
      [UPLOAD]: () => ({ status, body: problem(status, code), headers: { 'retry-after': '90' } }),
    });
    const w = await mountPage(CsvPage, '/en/admin/csv');
    await drop(w, [csvFile(csv.courses, 'courses.csv')]);
    await uploadButton(w).trigger('click');
    await flushPromises();
    const alert = w.find('[aria-labelledby="result-heading"] [role="alert"]');
    expect(alert.text()).toContain('The upload failed');
    expect(alert.text()).toContain(text);
    expect(alert.text()).toContain(`Error code: ${code}`);
    expect(alert.text()).toContain('Try again in about 2 minutes.');
    // Failures that are not about the files allow another attempt.
    expect(uploadButton(w).attributes('disabled')).toBeUndefined();
  });

  it('downloads the bearer-protected templates as blobs', async () => {
    serve({
      'GET /api/admin/v1/csv-template/courses.csv': ok(
        new Blob(['template'], { type: 'text/csv' }),
      ),
    });
    const saved: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tpl');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    const w = await mountPage(CsvPage, '/en/admin/csv');
    const link = w.findAll('[aria-labelledby="templates-heading"] a')[0]!;
    expect(link.attributes('href')).toMatch(/\/api\/admin\/v1\/csv-template\/courses\.csv$/);
    await link.trigger('click');
    await flushPromises();
    const [request] = callsTo('GET /api/admin/v1/csv-template/courses.csv');
    expect(request).toMatchObject({ responseType: 'blob' });
    expect(saved).toEqual(['courses.csv']);

    await w.findAll('[aria-labelledby="templates-heading"] a')[1]!.trigger('click');
    await flushPromises();
    expect(w.find('[aria-labelledby="templates-heading"] [role="alert"]').text()).toContain(
      'does not exist',
    );
  });

  it('offers template 1.2 and explains its new course columns [DL 21]', async () => {
    serve({
      'GET /api/admin/v1/csv-template/schema.json': ok(
        new Blob(['{}'], { type: 'application/schema+json' }),
      ),
    });
    const saved: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tpl');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    const w = await mountPage(CsvPage, '/en/admin/csv');
    expect(w.text()).toContain('(template 1.2, at most 5 MB');
    expect(w.text()).toContain(
      'Template 1.2 adds optional course columns: instructors (names separated by |) and, per language, methods_xx',
    );
    const links = w.findAll('[aria-labelledby="templates-heading"] a');
    expect(links[2]!.text()).toBe('Download the JSON Schema of template 1.2');
    await links[2]!.trigger('click');
    await flushPromises();
    expect(saved).toEqual(['oecp-csv-1.2.schema.json']);
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('uses the ?org= organization of an alliance administrator', async () => {
    serve({
      [ME]: ok(fixtures.me(['alliance_admin'], null)),
      [`POST /api/admin/v1/organizations/${OTHER_ORG_ID}/uploads`]: ok(
        {
          sync_run_id: RUN_ID,
          status: 'succeeded',
          processed_inline: true,
          run: fixtures.run(),
          warnings: [],
        },
        201,
      ),
    });
    const w = await mountPage(CsvPage, `/en/admin/csv?org=${OTHER_ORG_ID}`);
    expect((w.find('.admin-org-picker select').element as HTMLSelectElement).value).toBe(
      OTHER_ORG_ID,
    );
    await drop(w, [csvFile(csv.courses, 'courses.csv')]);
    await uploadButton(w).trigger('click');
    await flushPromises();
    expect(callsTo(`POST /api/admin/v1/organizations/${OTHER_ORG_ID}/uploads`)).toHaveLength(1);
    expect(w.find('[aria-labelledby="result-heading"] a').attributes('href')).toBe(
      `/en/admin/sync-runs/${RUN_ID}?org=${OTHER_ORG_ID}`,
    );
  });
});

describe('sync history', () => {
  const runs = [
    fixtures.run(),
    fixtures.run({
      id: '2f6c0c1e-6a3d-4c55-9a43-0f3d3c2b9a11',
      channel: 'oeapi',
      trigger_kind: 'schedule',
      status: 'failed',
      duration_ms: 125_000,
      n_rejected: 4,
    }),
  ];

  it('lists the runs of the organization', async () => {
    serve({ [RUNS]: ok({ items: runs }) });
    const w = await mountPage(RunsPage, '/en/admin/sync-runs');
    expect(callsTo(RUNS)[0]!.query).toEqual({ limit: 50 });
    const table = w.find('table');
    expect(table.find('caption').text()).toBe('Latest 2 runs, newest first');
    expect(table.findAll('thead th').every((th) => th.attributes('scope') === 'col')).toBe(true);
    const rows = table.findAll('tbody tr');
    expect(rows[0]!.find('th[scope="row"] a').attributes('href')).toBe(
      `/en/admin/sync-runs/${RUN_ID}`,
    );
    expect(rows[1]!.findAll('td').map((td) => td.text())).toEqual([
      'OEAPI harvest',
      'Scheduled',
      'Failed',
      '2',
      '1',
      '3',
      '4',
      '0',
      expect.stringMatching(/^2 min 5 sec$/),
    ]);
    expect(await axeViolations(w.html())).toEqual([]);

    const push = vi.spyOn(useRouter(), 'push').mockResolvedValue(undefined);
    await rows[1]!.findAll('td')[0]!.trigger('click');
    expect(push).toHaveBeenCalledWith(`/en/admin/sync-runs/${runs[1]!.id}`);
  });

  it('shows an empty state and API problems', async () => {
    serve({ [RUNS]: ok({ items: [] }) });
    const w = await mountPage(RunsPage, '/en/admin/sync-runs');
    expect(w.text()).toContain('No runs yet for this organization.');

    serve({
      [RUNS]: () => ({ status: 403, body: problem(403, 'oecp.auth.forbidden_organization') }),
    });
    const w2 = await mountPage(RunsPage, '/en/admin/sync-runs');
    expect(w2.find('[role="alert"]').text()).toContain('Your account is not allowed to do this.');
  });
});

describe('run page', () => {
  const errors = Array.from({ length: 50 }, (_, i) => fixtures.syncError(i + 1));

  it('shows the summary and pages through the errors', async () => {
    serve({
      [RUN]: (request) => ({
        status: 200,
        body: fixtures.runDetail(
          { status: 'failed', n_rejected: 120, error_summary: '120 errors' },
          { items: errors, total: 120, page: Number(request.query?.page ?? 1) },
        ),
      }),
    });
    const w = await mountPage(RunPage, `/en/admin/sync-runs/${RUN_ID}`);
    expect(callsTo(RUN)[0]!.query).toEqual({ page: 1, page_size: 50 });
    expect(facts(w, '[aria-labelledby="summary-heading"] dl')).toMatchObject({
      Status: 'Failed',
      Channel: 'CSV upload',
      Rejected: '120',
      Message: '120 errors',
    });
    expect(w.find('#errors-heading').text()).toBe('Errors and warnings (120)');
    expect(w.findAll('tbody tr')).toHaveLength(50);
    expect(w.find('.admin-pager').text()).toContain('Page 1 of 3');
    expect(w.find('.admin-back').attributes('href')).toBe(`/en/admin/sync-runs?org=${ORG_ID}`);
    expect(await axeViolations(w.html())).toEqual([]);

    await w.findAll('.admin-pager button')[1]!.trigger('click');
    await flushPromises();
    expect(callsTo(RUN)[1]!.query).toEqual({ page: 2, page_size: 50 });
    expect(w.find('.admin-pager').text()).toContain('Page 2 of 3');
    expect(document.activeElement?.id).toBe('errors-heading');

    await w.find('[aria-labelledby="errors-heading"] select').setValue('error');
    await flushPromises();
    expect(callsTo(RUN)[2]!.query).toEqual({ page: 1, page_size: 50, severity: 'error' });
  });

  it('explains a missing run', async () => {
    const w = await mountPage(RunPage, `/en/admin/sync-runs/${RUN_ID}`);
    expect(w.find('[role="alert"]').text()).toContain('does not exist');
  });
});
