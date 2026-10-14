// SPDX-License-Identifier: EUPL-1.2
// Test doubles for the admin pages: a `$fetch` replacement whose `create()`d
// clients (used by useAdminApi and useApi) answer from route handlers, admin
// API fixtures, and small template 1.0 CSV files.
import type { AdminMe, SyncRun, SyncRunDetail } from '@oecp/schemas';
import reference from '../fixtures/catalogue/reference.json';

export const ORG_ID = '0b9f6c1e-1d7a-4f39-9a51-6c1e0f0a0001';
export const OTHER_ORG_ID = '0b9f6c1e-1d7a-4f39-9a51-6c1e0f0a0002';
export const RUN_ID = '2f6c0c1e-6a3d-4c55-9a43-0f3d3c2b9a10';

export interface FakeRequest {
  url: string;
  method: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  responseType?: string;
}

export interface FakeResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type Route = (request: FakeRequest) => FakeResponse | Promise<FakeResponse>;

/** Error shaped like ofetch's FetchError for a non-2xx response. */
function fetchError(response: FakeResponse) {
  return Object.assign(new Error(`HTTP ${response.status}`), {
    status: response.status,
    statusCode: response.status,
    data: response.body,
    response: { status: response.status, headers: new Headers(response.headers ?? {}) },
  });
}

export function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'about:blank',
    title: `Problem ${code}`,
    status,
    errors: [{ code, severity: 'error', message: `Message of ${code}` }],
    ...extra,
  };
}

/**
 * A `$fetch` stand-in. `routes` is keyed by `METHOD path` (e.g. `GET /api/admin/v1/me`);
 * unknown routes answer 404. Every request is recorded in `calls`.
 */
export function createFakeFetch(routes: Record<string, Route>) {
  const calls: FakeRequest[] = [];
  async function handle(url: string, options: Record<string, unknown> = {}) {
    const request: FakeRequest = {
      url,
      method: String(options.method ?? 'GET'),
      query: options.query as Record<string, unknown> | undefined,
      body: options.body,
      headers: options.headers as Record<string, string> | undefined,
      responseType: options.responseType as string | undefined,
    };
    calls.push(request);
    const route = routes[`${request.method} ${url}`];
    const response = route
      ? await route(request)
      : { status: 404, body: problem(404, 'oecp.request.not_found') };
    if (response.status >= 400) throw fetchError(response);
    return { status: response.status, _data: response.body };
  }
  const client = Object.assign(
    async (url: string, options?: Record<string, unknown>) => (await handle(url, options))._data,
    { raw: (url: string, options?: Record<string, unknown>) => handle(url, options) },
  );
  const fake = Object.assign(client, { create: () => client });
  return { fetch: fake, calls };
}

export const fixtures = {
  reference,
  me(roles: AdminMe['roles'], orgId: string | null = ORG_ID): AdminMe {
    return {
      sub: 'user-1',
      email: 'admin@example.org',
      name: 'Test Admin',
      roles,
      org_id: orgId,
      idp: 'urv',
    };
  },
  run(overrides: Partial<SyncRun> = {}): SyncRun {
    return {
      id: RUN_ID,
      organization_id: ORG_ID,
      channel: 'csv',
      trigger_kind: 'upload',
      triggered_by: 'user-1',
      schema_version: 'csv-1.0',
      status: 'succeeded',
      is_complete: true,
      started_at: '2026-10-14T09:00:00.000Z',
      finished_at: '2026-10-14T09:00:02.500Z',
      duration_ms: 2500,
      n_created: 2,
      n_updated: 1,
      n_unchanged: 3,
      n_rejected: 0,
      n_withdrawn: 0,
      error_summary: null,
      created_at: '2026-10-14T08:59:59.000Z',
      ...overrides,
    };
  },
  runDetail(
    overrides: Partial<SyncRun> = {},
    errors: Partial<SyncRunDetail['errors']> = {},
  ): SyncRunDetail {
    return {
      ...fixtures.run(overrides),
      errors: { items: [], page: 1, page_size: 50, total: 0, ...errors },
    };
  },
  syncError(i: number, severity: 'error' | 'warning' = 'error') {
    return {
      id: String(i),
      severity,
      code: severity === 'error' ? 'oecp.csv.invalid_date' : 'oecp.csv.no_data_rows',
      message: severity === 'error' ? 'Expected YYYY-MM-DD' : 'File has a header but no rows',
      entity_type: 'offering',
      ext_id: null,
      file: 'offerings' as const,
      row_number: i + 1,
      column_name: 'start_date',
      json_pointer: null,
      created_at: '2026-10-14T09:00:01.000Z',
    };
  },
};

export const csv = {
  courses:
    'template_version,course_code,status,ects,isced_codes,title_en\r\n' +
    '1.0,TEST-101,draft,5,0521,Test course\r\n',
  offerings:
    'template_version,course_code,offering_code,status,start_date,end_date,teaching_languages,delivery_modes\n' +
    '1.0,TEST-101,2027S,draft,2027-02-15,2027-06-15,en,online\n',
  /** Row 2: invalid number; row 3: ISCED field not in the reference data. */
  invalidCourses:
    'template_version,course_code,status,ects,isced_codes,title_en\n' +
    '1.0,TEST-101,draft,five,0521,Test course\n' +
    '1.0,TEST-102,draft,5,9999,Another course\n',
  /** Header only: one warning (`oecp.csv.no_data_rows`). */
  emptyOfferings:
    'template_version,course_code,offering_code,status,start_date,end_date,teaching_languages,delivery_modes\n',
};

export function csvFile(text: string, name: string): File {
  return new File([text], name, { type: 'text/csv' });
}
