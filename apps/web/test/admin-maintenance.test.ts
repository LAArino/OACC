// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
// Maintenance page (spec §8.2, §10): jobs with "Run now" and the runs table with
// expandable details and the dormancy / account clean-up review lists, with
// useAuth mocked and the admin API answered by a fake `$fetch` (helpers/admin.ts).
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from '../app/pages/(admin)/admin/index.vue';
import MaintenancePage from '../app/pages/(admin)/admin/maintenance.vue';
import { resetAdminReference } from '../app/composables/useAdminReference';
import type { AdminMaintenanceRun } from '../app/types/admin';
import {
  ALLIANCE_ID,
  createFakeFetch,
  type FakeRequest,
  fixtures,
  ORG_ID,
  problem,
  type Route,
} from './helpers/admin';
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
  restoring: { value: false },
  login: async () => undefined,
  logout: async () => undefined,
  handleCallback: async () => '/en/admin',
  restoreSession: async () => false,
  handleSilentCallback: async () => undefined,
}));

const API = '/api/admin/v1';
const ME = `GET ${API}/me`;
const REFERENCE = 'GET /api/public/v1/reference';
const RUNS = `GET ${API}/maintenance/runs`;
const runJob = (name: string) => `POST ${API}/maintenance/jobs/${name}/run`;

const URV_ID = fixtures.reference.organizations.find((o) => o.slug === 'urv')?.id ?? ORG_ID;

function run(overrides: Partial<AdminMaintenanceRun> = {}): AdminMaintenanceRun {
  return {
    id: '9a1b2c3d-0000-4000-8000-000000000001',
    job: 'history-partitions',
    trigger_kind: 'schedule',
    triggered_by: null,
    status: 'succeeded',
    started_at: '2026-10-15T00:10:00.000Z',
    finished_at: '2026-10-15T00:10:01.200Z',
    duration_ms: 1200,
    counters: { partitions_created: 1, partitions_dropped: 0 },
    details: null,
    error: null,
    ...overrides,
  };
}

const dormancyRun = run({
  id: '9a1b2c3d-0000-4000-8000-000000000002',
  job: 'dormancy',
  started_at: '2026-10-15T05:00:00.000Z',
  finished_at: '2026-10-15T05:00:03.000Z',
  duration_ms: 3000,
  counters: { administrators: 4, dormant: 2, would_revoke: 1, kept_last_alliance_admin: 1 },
  details: {
    dry_run: true,
    threshold_days: 180,
    tracking_since: '2026-10-14T00:00:00.000Z',
    candidates: [
      {
        sub: 'kc-user-7',
        roles: ['partner_admin'],
        organization_id: URV_ID,
        last_activity_at: '2026-03-01T08:00:00.000Z',
        basis: 'keycloak_login',
        inactive_days: 228,
        action: 'would_revoke',
      },
      {
        sub: 'kc-user-1',
        roles: ['alliance_admin', 'partner_admin'],
        organization_id: '00000000-0000-4000-8000-00000000dead',
        last_activity_at: '2026-04-01T08:00:00.000Z',
        basis: 'api_activity',
        inactive_days: 197,
        action: 'kept_last_alliance_admin',
      },
    ],
  },
});

const failedRun = run({
  id: '9a1b2c3d-0000-4000-8000-000000000003',
  job: 'retention',
  trigger_kind: 'manual',
  triggered_by: 'self-sub',
  status: 'failed',
  started_at: '2026-10-14T04:45:00.000Z',
  finished_at: '2026-10-14T04:45:09.000Z',
  duration_ms: 9000,
  counters: { sync_errors_deleted: 5000 },
  error: `canceling statement due to statement timeout ${'x'.repeat(200)}`,
});

const runningRun = run({
  id: '9a1b2c3d-0000-4000-8000-000000000004',
  job: 'account-cleanup',
  trigger_kind: 'manual',
  triggered_by: 'self-sub',
  status: 'running',
  started_at: '2026-10-15T09:00:00.000Z',
  finished_at: null,
  duration_ms: null,
  counters: {},
  details: null,
});

const ok =
  (body: unknown, status = 200): Route =>
  () => ({ status, body: structuredClone(body) });
const fail =
  (status: number, code: string): Route =>
  () => ({ status, body: problem(status, code) });

let calls: FakeRequest[] = [];
function serve(routes: Record<string, Route>) {
  const fake = createFakeFetch({
    [ME]: ok({ ...fixtures.me(['alliance_admin'], ALLIANCE_ID), sub: 'self-sub' }),
    [REFERENCE]: ok(fixtures.reference),
    [RUNS]: ok({ items: [runningRun, dormancyRun, run(), failedRun] }),
    ...routes,
  });
  calls = fake.calls;
  net.fetch = fake.fetch;
}
const callsTo = (key: string) => calls.filter((c) => `${c.method} ${c.url}` === key);

beforeEach(() => {
  auth.signedIn = true;
  auth.token = `token-${++auth.count}`;
  resetAdminReference();
  serve({});
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mountPage(component: unknown = MaintenancePage, route = '/en/admin/maintenance') {
  const w = await mountSuspended(component as never, { route, attachTo: document.body });
  await flushPromises();
  return w;
}
type Wrapper = Awaited<ReturnType<typeof mountPage>>;

const button = (w: Wrapper, text: string) => {
  const found = w.findAll('button').find((b) => b.text().replace(/\s+/g, ' ') === text);
  if (!found) throw new Error(`No button "${text}" in ${w.findAll('button').map((b) => b.text())}`);
  return found;
};
const runRows = (w: Wrapper) =>
  w
    .findAll('.admin-runs-table > tbody > tr.admin-runs-table__run')
    .map((r) => [
      r.find('th').text(),
      ...r.findAll(':scope > td').map((td) => td.text().replace(/\s+/g, ' ')),
    ]);

describe('maintenance page', () => {
  it('is for alliance administrators only', async () => {
    serve({ [ME]: ok(fixtures.me(['partner_admin'])) });
    const w = await mountPage();
    expect(w.find('[role="alert"]').text()).toContain('alliance administrators');
    expect(callsTo(RUNS)).toHaveLength(0);
  });

  it('shows one card per job with its description, schedule and Run now', async () => {
    const w = await mountPage();
    expect(w.find('h1').text()).toBe('Maintenance');
    const cards = w.findAll('.admin-jobs > li');
    expect(cards.map((c) => c.find('h3').text())).toEqual([
      'History partitions',
      'Retention',
      'Dormancy',
      'Account clean-up',
      'CSV upload retention',
      'IdP metadata refresh',
    ]);
    expect(cards[0]!.text()).toContain('Daily at 00:10 UTC and when the worker starts.');
    expect(cards[2]!.text()).toContain('inactive for more than 180 days');
    expect(cards[2]!.text()).toContain('Latest run listed:');
    expect(cards[0]!.find('button').text().replace(/\s+/g, ' ')).toBe('Run now History partitions');
    expect(cards[0]!.find('button .visually-hidden').text()).toBe('History partitions');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('explains dry-run mode with the switches, read from the latest runs', async () => {
    const w = await mountPage();
    const notice = w.find('.admin-dry-run-notice');
    expect(notice.find('h3').text()).toBe('Dry run');
    const items = notice.findAll('li').map((li) => li.text().replace(/\s+/g, ' '));
    expect(items[0]).toMatch(/^Dormancy: dry run \(latest run .+\)\. /);
    expect(items[0]).toContain('OECP_DORMANCY_DRY_RUN=false');
    // The running account clean-up has no details yet.
    expect(items[1]).toContain('Account clean-up: no run listed yet');
    expect(items[1]).toContain('OECP_ACCOUNT_CLEANUP_DRY_RUN=false');

    serve({
      [RUNS]: ok({
        items: [
          { ...dormancyRun, details: { ...dormancyRun.details, dry_run: false } },
          run({
            id: '9a1b2c3d-0000-4000-8000-000000000009',
            job: 'account-cleanup',
            details: { dry_run: true, candidates: [] },
          }),
        ],
      }),
    });
    const w2 = await mountPage();
    const items2 = w2.findAll('.admin-dry-run-notice li').map((li) => li.text());
    expect(items2[0]).toContain('Dormancy: enabled');
    expect(items2[1]).toContain('Account clean-up: dry run');
  });

  it('runs a job now and announces queued or already queued in a live region', async () => {
    serve({
      [runJob('dormancy')]: ok({ job: 'dormancy', status: 'queued' }, 202),
      [runJob('retention')]: ok({ job: 'retention', status: 'already_queued' }, 202),
      [runJob('csv-retention')]: fail(404, 'oecp.request.not_found'),
    });
    const w = await mountPage();
    const toast = w.find('.admin-toast');
    expect(toast.attributes('role')).toBe('status');
    expect(toast.attributes('aria-live')).toBe('polite');
    expect(toast.text()).toBe('');

    await button(w, 'Run now Dormancy').trigger('click');
    await flushPromises();
    expect(callsTo(runJob('dormancy'))).toHaveLength(1);
    expect(callsTo(runJob('dormancy'))[0]!.headers).toEqual({
      authorization: `Bearer ${auth.token}`,
    });
    expect(toast.text()).toBe(
      'Dormancy: run queued. It appears in the runs below once the worker starts it.',
    );
    // The runs are read again.
    expect(callsTo(RUNS)).toHaveLength(2);

    await button(w, 'Run now Retention').trigger('click');
    await flushPromises();
    expect(toast.text()).toContain('Retention: a run requested earlier is still waiting');

    await button(w, 'Run now CSV upload retention').trigger('click');
    await flushPromises();
    const card = w.findAll('.admin-jobs > li')[4]!;
    expect(card.find('[role="alert"]').text()).toContain(
      'CSV upload retention could not be queued',
    );
    expect(card.find('[role="alert"]').text()).toContain('oecp.request.not_found');
    expect(toast.text()).toBe('');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('lists the runs newest first with trigger, status, duration, counters and error', async () => {
    const w = await mountPage();
    expect(callsTo(RUNS)[0]!.query).toEqual({ limit: 50 });
    const table = w.find('.admin-runs-table');
    expect(table.find('caption').text()).toBe('4 runs, newest first');
    expect(table.findAll('thead th').map((th) => th.text())).toEqual([
      'Started',
      'Job',
      'Trigger',
      'Status',
      'Duration',
      'Counters',
      'Error',
      'Details',
    ]);
    const rows = runRows(w);
    expect(rows.map((r) => r.slice(1, 4))).toEqual([
      ['Account clean-up', 'Run now', 'Running'],
      ['Dormancy', 'Scheduled', 'Succeeded Dry run'],
      ['History partitions', 'Scheduled', 'Succeeded'],
      ['Retention', 'Run now', 'Failed'],
    ]);
    expect(rows[0]![4]).toBe('None');
    expect(rows[2]![4]).toMatch(/1[.,]2/);
    expect(rows[0]![5]).toBe('None');
    expect(
      table
        .findAll('tbody tr')[4]!
        .findAll('.admin-chips li')
        .map((li) => li.text()),
    ).toEqual(['partitions created: 1', 'partitions dropped: 0']);
    expect(rows[3]![6]!.startsWith('canceling statement due to statement timeout')).toBe(true);
    expect(rows[3]![6]!.endsWith('…')).toBe(true);
    expect(rows[3]![6]!.length).toBeLessThanOrEqual(120);
    expect(
      w.findAll('.admin-runs-table__run .admin-badge').map((b) => b.classes().join(' ')),
    ).toEqual([
      'admin-badge admin-badge--neutral',
      'admin-badge admin-badge--ok',
      'admin-badge admin-badge--neutral',
      'admin-badge admin-badge--ok',
      'admin-badge admin-badge--bad',
    ]);
    expect(w.find('[role="status"].visually-hidden').text()).toBe('4 runs listed');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('filters by job and limit and refreshes', async () => {
    const w = await mountPage();
    const job = w.find('#maintenance-job');
    expect(w.find('label[for="maintenance-job"]').text()).toBe('Job');
    expect(job.findAll('option').map((o) => o.text())).toEqual([
      'All jobs',
      'History partitions',
      'Retention',
      'Dormancy',
      'Account clean-up',
      'CSV upload retention',
      'IdP metadata refresh',
    ]);
    await job.setValue('dormancy');
    await flushPromises();
    expect(callsTo(RUNS).at(-1)!.query).toEqual({ limit: 50, job: 'dormancy' });

    const limit = w.find('#maintenance-limit');
    expect(limit.findAll('option').map((o) => o.text())).toEqual([
      'Latest 50 runs',
      'Latest 200 runs',
    ]);
    await limit.setValue('200');
    await flushPromises();
    expect(callsTo(RUNS).at(-1)!.query).toEqual({ limit: 200, job: 'dormancy' });

    await button(w, 'Refresh').trigger('click');
    await w.find('form.admin-runs-filters').trigger('submit');
    await flushPromises();
    expect(callsTo(RUNS).length).toBeGreaterThanOrEqual(4);
  });

  it('expands a run into its details and the dormancy review list', async () => {
    const w = await mountPage();
    const toggles = w.findAll('.admin-runs-table__toggle');
    const dormancy = toggles[1]!;
    expect(dormancy.attributes('aria-expanded')).toBe('false');
    const detailsId = dormancy.attributes('aria-controls')!;
    expect(detailsId).toBe(`run-${dormancyRun.id}-details`);
    expect(w.find(`[id="${detailsId}"]`).attributes('hidden')).toBeDefined();
    expect(dormancy.text().replace(/\s+/g, ' ')).toMatch(
      /^Show details of the Dormancy run started /,
    );

    await dormancy.trigger('click');
    await flushPromises();
    expect(dormancy.attributes('aria-expanded')).toBe('true');
    expect(dormancy.text()).toContain('Hide details');
    const details = w.find(`[id="${detailsId}"]`);
    expect(details.attributes('hidden')).toBeUndefined();
    const facts = Object.fromEntries(
      details
        .find('dl')
        .findAll('dt')
        .map((dt, i) => [dt.text(), details.find('dl').findAll('dd')[i]!.text()]),
    );
    expect(facts).toMatchObject({
      'Run id': dormancyRun.id,
      'Requested by': 'The worker (scheduled)',
      dry_run: 'Yes',
      threshold_days: '180',
    });
    expect(facts).not.toHaveProperty('candidates');
    expect(details.find('.admin-run-details__notice').text()).toContain(
      'Dry run: nothing was changed',
    );
    expect(details.find('.admin-run-details__notice').text()).toContain(
      'OECP_DORMANCY_DRY_RUN=false',
    );
    const review = details.find('table');
    expect(review.find('caption').text()).toBe('2 administrators who would be affected');
    expect(review.findAll('thead th').map((th) => th.text())).toEqual([
      'Account (sub)',
      'Roles',
      'Organization',
      'Last activity',
      'Days inactive',
      'Action',
    ]);
    const cells = review
      .findAll('tbody tr')
      .map((r) => [r.find('th').text(), ...r.findAll('td').map((td) => td.text())]);
    expect(cells[0]).toEqual([
      'kc-user-7',
      'Partner administrator',
      'Universitat Rovira i Virgili',
      expect.stringContaining('2026'),
      '228',
      'Would be revoked',
    ]);
    expect(cells[1]!.slice(1, 3)).toEqual([
      'Alliance administrator, Partner administrator',
      '00000000-0000-4000-8000-00000000dead',
    ]);
    expect(cells[1]![5]).toBe('Kept: last alliance administrator');
    expect(await axeViolations(w.html())).toEqual([]);

    // The failed manual run shows its requester and the full error.
    await toggles[3]!.trigger('click');
    await flushPromises();
    const failed = w.find(`[id="run-${failedRun.id}-details"]`);
    expect(failed.find('.admin-run-details__error').text()).toBe(failedRun.error);
    expect(failed.text()).toContain('self-sub');
    expect(failed.find('table').exists()).toBe(false);

    await dormancy.trigger('click');
    await flushPromises();
    expect(dormancy.attributes('aria-expanded')).toBe('false');
    expect(w.find(`[id="${detailsId}"]`).attributes('hidden')).toBeDefined();
  });

  it('lists the accounts of an account clean-up dry run', async () => {
    const cleanup = run({
      id: '9a1b2c3d-0000-4000-8000-000000000010',
      job: 'account-cleanup',
      started_at: '2026-10-15T05:15:00.000Z',
      counters: { removed_accounts: 3, would_delete: 1, kept: 1, dry_run: 1 },
      details: {
        dry_run: true,
        months: 12,
        cutoff: '2025-10-15T05:15:00.000Z',
        candidates: [
          {
            sub: 'kc-user-9',
            organization_id: URV_ID,
            last_role_removal_at: '2025-06-01T08:00:00.000Z',
            removal_action: 'admin.dormant_revoke',
            created_at: '2024-01-01T08:00:00.000Z',
            last_activity_at: '2025-01-10T05:15:00.000Z',
            action: 'would_delete',
          },
          'not an object',
        ],
        kept: [{ sub: 'kc-user-3', reason: 'has_role' }],
        kept_by_reason: { has_role: 1 },
      },
    });
    serve({ [RUNS]: ok({ items: [cleanup] }) });
    const w = await mountPage();
    await w.find('.admin-runs-table__toggle').trigger('click');
    await flushPromises();
    const details = w.find('.admin-run-details');
    const rows = details
      .find('table')
      .findAll('tbody tr')
      .map((r) => [r.find('th').text(), ...r.findAll('td').map((td) => td.text())]);
    expect(rows).toHaveLength(1);
    expect(rows[0]![0]).toBe('kc-user-9');
    expect(rows[0]![1]).toMatch(/^None: removed .*2025.* \(dormancy\)$/);
    expect(rows[0]!.slice(2)).toEqual([
      'Universitat Rovira i Virgili',
      expect.stringContaining('2025'),
      '643',
      'Would be deleted',
    ]);
    expect(details.find('caption').text()).toBe('1 administrator who would be affected');
    expect(details.find('.admin-run-details__notice').text()).toContain(
      'OECP_ACCOUNT_CLEANUP_DRY_RUN=false',
    );
    // Other structured details are shown as JSON.
    expect(details.findAll('pre').map((p) => p.text())).toEqual([
      JSON.stringify(cleanup.details!['kept'], null, 2),
      JSON.stringify(cleanup.details!['kept_by_reason'], null, 2),
    ]);
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('shows an empty list and explains API problems', async () => {
    serve({ [RUNS]: ok({ items: [] }) });
    const w = await mountPage();
    expect(w.text()).toContain('No runs recorded yet.');
    expect(w.find('.admin-runs-table').exists()).toBe(false);

    serve({ [RUNS]: fail(403, 'oecp.auth.forbidden_role') });
    const w2 = await mountPage();
    expect(w2.find('[role="alert"]').text()).toContain('Your account is not allowed to do this.');
  });
});

describe('dashboard module', () => {
  it('adds Maintenance to the alliance modules', async () => {
    const w = await mountPage(DashboardPage, `/en/admin?org=${ORG_ID}`);
    const links = w.findAll('.admin-modules a').map((a) => [a.text(), a.attributes('href')]);
    expect(links.at(-1)).toEqual(['Maintenance', '/en/admin/maintenance']);
    expect(w.text()).toContain('review the dormancy and account clean-up dry runs');
  });
});
