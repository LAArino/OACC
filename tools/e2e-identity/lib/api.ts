// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
/** The OECP admin and public APIs as the tests use them. */
import { type Page, request } from '@playwright/test';
import { PORTAL } from './config';
import { invitationLinkFromMail } from './mailpit';
import { sleep } from './util';

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

/** RFC 9457 problem body of the api (spec §6.6). */
export interface Problem {
  title?: string;
  detail?: string;
  errors?: { code: string }[];
}
export const problemCodes = (body: unknown) =>
  ((body as Problem | null)?.errors ?? []).map((e) => e.code);

/** Admin API call with a bearer token (TLS errors ignored for the dev certificate). */
export async function adminApi<T = unknown>(
  token: string,
  method: string,
  apiPath: string,
  data?: unknown,
): Promise<ApiResult<T>> {
  const rq = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const res = await rq.fetch(`${PORTAL}/api/admin/v1${apiPath}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      ...(data === undefined ? {} : { data }),
    });
    const raw = await res.text();
    let body: unknown = raw;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      // not JSON: keep the text
    }
    return { status: res.status(), body: body as T };
  } finally {
    await rq.dispose();
  }
}

export interface ReferenceOrganization {
  id: string;
  slug: string;
  /** Published only when the realm has this IdP enabled. */
  idp_alias: string | null;
}

/** An organization from the public reference (`/api/public/v1/reference`). */
export async function organization(slug: string): Promise<ReferenceOrganization> {
  const rq = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const res = await rq.get(`${PORTAL}/api/public/v1/reference`);
    if (!res.ok()) throw new Error(`GET /api/public/v1/reference: HTTP ${res.status()}`);
    const ref = (await res.json()) as { organizations: ReferenceOrganization[] };
    const org = ref.organizations.find((o) => o.slug === slug);
    if (!org) throw new Error(`organization ${slug} not in /api/public/v1/reference (seeded?)`);
    return org;
  } finally {
    await rq.dispose();
  }
}

export interface Invitation {
  id: string;
  email: string;
  role: string;
  organization_id: string;
  status: string;
}

/** POST /invitations, then the link from Mailpit. */
export async function invite(
  token: string,
  input: { email: string; role: string; organizationId: string },
): Promise<{ status: number; invitation: Invitation; link: string }> {
  const since = Date.now();
  const res = await adminApi<Invitation>(token, 'POST', '/invitations', {
    email: input.email,
    role: input.role,
    organization_id: input.organizationId,
    ttl_hours: 24,
  });
  if (res.status !== 201) {
    throw new Error(`POST /invitations: HTTP ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    status: res.status,
    invitation: res.body,
    link: await invitationLinkFromMail(input.email, since),
  };
}

/** Revokes every pending invitation for this address (clean-up); returns how many. */
export async function revokePendingInvitations(token: string, email: string): Promise<number> {
  const list = await adminApi<{ items: Invitation[] }>(token, 'GET', '/invitations');
  if (list.status !== 200) throw new Error(`GET /invitations: HTTP ${list.status}`);
  let n = 0;
  for (const inv of list.body.items) {
    if (inv.email.toLowerCase() === email.toLowerCase() && inv.status === 'pending') {
      const del = await adminApi(token, 'DELETE', `/invitations/${inv.id}`);
      if (del.status !== 204) throw new Error(`DELETE /invitations/${inv.id}: HTTP ${del.status}`);
      n++;
    }
  }
  return n;
}

export interface OrganizationAdmin {
  sub: string;
  email: string | null;
  roles: string[];
  idp: string;
}

export async function listAdmins(token: string, orgId: string): Promise<OrganizationAdmin[]> {
  const res = await adminApi<{ items: OrganizationAdmin[] }>(
    token,
    'GET',
    `/organizations/${orgId}/admins`,
  );
  if (res.status !== 200) throw new Error(`GET /organizations/${orgId}/admins: HTTP ${res.status}`);
  return res.body.items;
}

/** Revokes the administrator with this e-mail in the organization, if listed (clean-up). */
export async function revokeAdminByEmail(
  token: string,
  orgId: string,
  email: string,
): Promise<boolean> {
  const admin = (await listAdmins(token, orgId)).find(
    (a) => a.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!admin) return false;
  const res = await adminApi(token, 'DELETE', `/organizations/${orgId}/admins/${admin.sub}`);
  if (res.status !== 204) {
    throw new Error(`DELETE /organizations/${orgId}/admins/${admin.sub}: HTTP ${res.status}`);
  }
  return true;
}

export interface AdminApiWatch {
  /** Bearer token of the latest admin API request of the page. */
  token?: string;
  accept?: ApiResult<{ role?: string; org_id?: string; detail?: string } & Problem>;
  me?: { sub: string; roles: string[]; org_id: string | null; idp: string; email: string };
}

/** Records the page's bearer token, its POST /invitations/accept and GET /me responses. */
export function watchAdminApi(page: Page): AdminApiWatch {
  const state: AdminApiWatch = {};
  page.on('request', (r) => {
    const h = r.headers().authorization;
    if (r.url().startsWith(`${PORTAL}/api/admin/v1/`) && h?.startsWith('Bearer ')) {
      state.token = h.slice(7);
    }
  });
  page.on('response', async (r) => {
    if (r.url() === `${PORTAL}/api/admin/v1/invitations/accept`) {
      state.accept = { status: r.status(), body: await r.json().catch(() => null) };
    } else if (r.url() === `${PORTAL}/api/admin/v1/me` && r.ok()) {
      state.me = await r.json().catch(() => undefined);
    }
  });
  return state;
}

/** Waits until `probe` returns a value (polling every 250 ms). */
export async function until<T>(probe: () => T | undefined, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = probe();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error('timed out waiting for the admin API call');
    await sleep(250);
  }
}
