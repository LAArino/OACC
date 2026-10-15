// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
// Administration pages of v0.2 (federated sign-in, session restore, invitations,
// integration settings, organizations, administrators, network status) with
// useAuth mocked and the admin API answered by a fake `$fetch` (helpers/admin.ts).
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, onMounted } from 'vue';
import AdminLayout from '../app/layouts/admin.vue';
import AcceptPage from '../app/pages/(admin)/admin/accept.vue';
import DashboardPage from '../app/pages/(admin)/admin/index.vue';
import IntegrationPage from '../app/pages/(admin)/admin/integration.vue';
import InvitationsPage from '../app/pages/(admin)/admin/invitations.vue';
import NetworkPage from '../app/pages/(admin)/admin/network.vue';
import OrganizationPage from '../app/pages/(admin)/admin/organizations/[id].vue';
import OrganizationsPage from '../app/pages/(admin)/admin/organizations/index.vue';
import NewOrganizationPage from '../app/pages/(admin)/admin/organizations/new.vue';
import SilentCallbackPage from '../app/pages/(admin)/admin/silent-callback.vue';
import {
  ALLIANCE_ID,
  createFakeFetch,
  type FakeRequest,
  fixtures,
  INVITATION_ID,
  ORG_ID,
  OTHER_ORG_ID,
  problem,
  type Route,
  RUN_ID,
} from './helpers/admin';
import { resetAdminReference } from '../app/composables/useAdminReference';
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

const auth = vi.hoisted(() => ({
  signedIn: true,
  token: 'token-0',
  count: 0,
  restoring: false,
  login: vi.fn(async (..._args: unknown[]) => undefined),
  logout: vi.fn(async (..._args: unknown[]) => undefined),
  restoreSession: vi.fn(async () => false),
  handleSilentCallback: vi.fn(async () => undefined),
}));
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
  restoring: {
    get value() {
      return auth.restoring;
    },
  },
  login: auth.login,
  logout: auth.logout,
  handleCallback: async () => '/en/admin',
  restoreSession: auth.restoreSession,
  handleSilentCallback: auth.handleSilentCallback,
}));

const API = '/api/admin/v1';
const ME = `GET ${API}/me`;
const REFERENCE = 'GET /api/public/v1/reference';
const INVITATIONS = `GET ${API}/organizations/${ORG_ID}/invitations`;
const CREATE_INVITATION = `POST ${API}/organizations/${ORG_ID}/invitations`;
const INTEGRATION = `GET ${API}/organizations/${ORG_ID}/integration`;
const PUT_INTEGRATION = `PUT ${API}/organizations/${ORG_ID}/integration`;
const APPROVE = `POST ${API}/organizations/${ORG_ID}/integration/approve-host`;
const TEST = `POST ${API}/organizations/${ORG_ID}/integration/test-connection`;
const SYNC = `POST ${API}/organizations/${ORG_ID}/integration/sync-now`;
const ORGS = `GET ${API}/organizations`;
const ORG = `GET ${API}/organizations/${ORG_ID}`;
const ADMINS = `GET ${API}/organizations/${ORG_ID}/admins`;
const NETWORK = `GET ${API}/network-status`;
const TOKEN = 'A'.repeat(20) + '_-' + 'b9'.repeat(10) + 'z';

const ok =
  (body: unknown, status = 200): Route =>
  () => ({ status, body: structuredClone(body) });
const fail =
  (status: number, code: string, headers: Record<string, string> = {}): Route =>
  () => ({ status, body: problem(status, code), headers });

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
const asAlliance = (routes: Record<string, Route> = {}) =>
  serve({
    [ME]: ok({ ...fixtures.me(['alliance_admin'], ALLIANCE_ID), sub: 'self-sub' }),
    ...routes,
  });

beforeEach(() => {
  auth.signedIn = true;
  auth.token = `token-${++auth.count}`;
  auth.restoring = false;
  auth.login.mockClear();
  auth.logout.mockClear();
  auth.restoreSession.mockReset();
  auth.restoreSession.mockResolvedValue(false);
  auth.handleSilentCallback.mockClear();
  window.sessionStorage.clear();
  window.localStorage.clear();
  resetAdminReference();
  serve({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mountPage(component: unknown, route: string, options: Record<string, unknown> = {}) {
  const w = await mountSuspended(component as never, {
    route,
    attachTo: document.body,
    ...options,
  });
  await flushPromises();
  return w;
}
type Wrapper = Awaited<ReturnType<typeof mountPage>>;

const button = (w: Wrapper, text: string) => {
  const found = w.findAll('button').find((b) => b.text() === text);
  if (!found) throw new Error(`No button "${text}" in ${w.findAll('button').map((b) => b.text())}`);
  return found;
};
async function confirmDialog(w: Wrapper, answer: 'yes' | 'no' = 'yes') {
  await flushPromises();
  await w.find(`dialog [data-confirm="${answer}"]`).trigger('click');
  await flushPromises();
}
const facts = (w: Wrapper, selector: string) => {
  const dl = w.find(selector);
  const dds = dl.findAll('dd');
  return Object.fromEntries(dl.findAll('dt').map((dt, i) => [dt.text(), dds[i]!.text()]));
};
const rowsOf = (w: Wrapper, selector = 'table') =>
  w
    .find(selector)
    .findAll('tbody tr')
    .map((r) => [
      r.find('th').text(),
      ...r.findAll('td').map((td) => td.text().replace(/\s+/g, ' ')),
    ]);

// ---------------------------------------------------------------------------

describe('federated sign-in', () => {
  it('offers the partner universities with an IdP alias and signs in with kc_idp_hint', async () => {
    auth.signedIn = false;
    serve({ [REFERENCE]: ok(fixtures.brokeredReference) });
    const w = await mountPage(DashboardPage, '/en/admin');
    expect(button(w, 'Sign in').exists()).toBe(true);
    const section = w.find('.admin-federated');
    expect(section.find('h2').text()).toBe('Sign in through your university');
    const select = section.find('select');
    expect(w.find(`label[for="${select.attributes('id')}"]`).text()).toBe('Your university');
    expect(select.findAll('option').map((o) => [o.attributes('value'), o.text()])).toEqual([
      ['', 'Choose your university'],
      ['univie', 'University of Vienna'],
      ['vu-amsterdam', 'Vrije Universiteit Amsterdam'],
    ]);
    const submit = section.find('button[type="submit"]');
    expect(submit.attributes('disabled')).toBeDefined();
    expect(await axeViolations(w.html())).toEqual([]);

    await select.setValue('vu-amsterdam');
    await section.find('form').trigger('submit');
    await flushPromises();
    expect(auth.login).toHaveBeenCalledWith('/en/admin', { idpHint: 'vu-amsterdam' });
    expect(window.localStorage.getItem('oecp.admin.lastIdp')).toBe('vu-amsterdam');
  });

  it('preselects the university chosen last time on this browser', async () => {
    auth.signedIn = false;
    window.localStorage.setItem('oecp.admin.lastIdp', 'univie');
    serve({ [REFERENCE]: ok(fixtures.brokeredReference) });
    const w = await mountPage(DashboardPage, '/en/admin');
    expect((w.find('.admin-federated select').element as HTMLSelectElement).value).toBe('univie');
  });

  it('is hidden when no organization has an identity provider', async () => {
    auth.signedIn = false;
    const w = await mountPage(DashboardPage, '/en/admin');
    expect(w.find('.admin-federated').exists()).toBe(false);
    await button(w, 'Sign in').trigger('click');
    expect(auth.login).toHaveBeenCalledWith('/en/admin');
  });
});

describe('invitation acceptance with an IdP alias', () => {
  /** Mounts the page as opened from an invitation link (`fragment` = `#token=…&idp=…`). */
  async function openLink(fragment: string) {
    const w = await mountPage(AcceptPage, `/en/admin/accept${fragment}`);
    return w;
  }

  it('reads the idp from the fragment, parks it with the token and signs in through it', async () => {
    auth.signedIn = false;
    const w = await openLink(`#token=${TOKEN}&idp=vu-amsterdam`);
    expect(window.location.hash).toBe('');
    expect(auth.restoreSession).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('You will sign in with your university account');
    expect(w.find('.admin-federated').exists()).toBe(false);
    await button(w, 'Sign in through your university').trigger('click');
    await flushPromises();
    expect(window.sessionStorage.getItem('oecp.admin.pendingInvitation')).toBe(TOKEN);
    expect(window.sessionStorage.getItem('oecp.admin.pendingInvitationIdp')).toBe('vu-amsterdam');
    expect(auth.login).toHaveBeenCalledWith('/en/admin/accept', { idpHint: 'vu-amsterdam' });
    expect(w.html()).not.toContain(TOKEN);
    expect(await axeViolations(w.html(), 'div')).toEqual([]);
  });

  it('accepts after the round-trip and clears the parked invitation', async () => {
    window.sessionStorage.setItem('oecp.admin.pendingInvitation', TOKEN);
    window.sessionStorage.setItem('oecp.admin.pendingInvitationIdp', 'vu-amsterdam');
    serve({
      [`POST ${API}/invitations/accept`]: ok({
        role: 'partner_admin',
        org_id: OTHER_ORG_ID,
        relogin_required: true,
      }),
    });
    const w = await openLink('');
    expect(callsTo(`POST ${API}/invitations/accept`)[0]!.body).toEqual({ token: TOKEN });
    expect(w.text()).toContain('Invitation accepted');
    expect(window.sessionStorage.length).toBe(0);
    expect(auth.restoreSession).not.toHaveBeenCalled();
  });

  it('accepts at once when the Keycloak session can be restored', async () => {
    auth.signedIn = false;
    auth.restoreSession.mockImplementation(async () => {
      auth.signedIn = true;
      return true;
    });
    serve({
      [`POST ${API}/invitations/accept`]: ok({
        role: 'partner_admin',
        org_id: ORG_ID,
        relogin_required: true,
      }),
    });
    const w = await openLink(`#token=${TOKEN}`);
    expect(callsTo(`POST ${API}/invitations/accept`)).toHaveLength(1);
    expect(w.text()).toContain('Invitation accepted');
  });

  it('offers the university chooser when the link has no idp, and parks the choice', async () => {
    auth.signedIn = false;
    serve({ [REFERENCE]: ok(fixtures.brokeredReference) });
    const w = await openLink(`#token=${TOKEN}&idp=..%2Fevil`);
    expect(button(w, 'Sign in').exists()).toBe(true);
    const section = w.find('.admin-federated');
    await section.find('select').setValue('univie');
    await section.find('form').trigger('submit');
    await flushPromises();
    expect(window.sessionStorage.getItem('oecp.admin.pendingInvitation')).toBe(TOKEN);
    expect(window.sessionStorage.getItem('oecp.admin.pendingInvitationIdp')).toBe('univie');
    expect(auth.login).toHaveBeenCalledWith('/en/admin/accept', { idpHint: 'univie' });
  });
});

describe('invitation mismatch causes', () => {
  const ACCEPT = `POST ${API}/invitations/accept`;
  const mismatch = (extra: Record<string, unknown>) => () => ({
    status: 403,
    body: problem(403, 'oecp.invitation.mismatch', extra),
  });
  /** Signed in and back from Keycloak with a parked invitation of a brokered organization. */
  async function acceptWith(route: Route, idp: string | null = 'vu-amsterdam') {
    window.sessionStorage.setItem('oecp.admin.pendingInvitation', TOKEN);
    if (idp) window.sessionStorage.setItem('oecp.admin.pendingInvitationIdp', idp);
    serve({ [ACCEPT]: route });
    const w = await mountPage(AcceptPage, '/en/admin/accept');
    expect(callsTo(ACCEPT)).toHaveLength(1);
    return w;
  }
  const buttons = (w: Wrapper) => w.findAll('button').map((b) => b.text());

  it('explains an e-mail mismatch', async () => {
    const w = await acceptWith(mismatch({ reason: 'email' }));
    const alert = w.find('[role="alert"]');
    expect(alert.text()).toContain('The invitation could not be accepted');
    expect(alert.text()).toContain('does not have the e-mail address this invitation was sent to');
    expect(alert.text()).not.toContain('issued for another account');
    expect(buttons(w)).toEqual(['Sign out']);
    expect(await axeViolations(w.html(), 'div')).toEqual([]);
  });

  it('explains an IdP mismatch and signs out to sign in through the university', async () => {
    const w = await acceptWith(mismatch({ reason: 'idp' }));
    expect(w.find('[role="alert"]').text()).toContain(
      'You did not sign in through your university',
    );
    expect(buttons(w)).toEqual(['Sign in through your university', 'Sign out']);
    expect(await axeViolations(w.html(), 'div')).toEqual([]);
    await button(w, 'Sign in through your university').trigger('click');
    await flushPromises();
    expect(window.sessionStorage.getItem('oecp.admin.pendingInvitation')).toBe(TOKEN);
    expect(window.sessionStorage.getItem('oecp.admin.pendingInvitationIdp')).toBe('vu-amsterdam');
    expect(auth.logout).toHaveBeenCalledWith({ returnTo: '/en/admin/accept' });
    expect(auth.login).not.toHaveBeenCalled();
    expect(w.html()).not.toContain(TOKEN);
  });

  it('offers the university switch without a known IdP alias too, and reports a failed sign-out', async () => {
    auth.logout.mockRejectedValueOnce(new Error('offline'));
    const w = await acceptWith(mismatch({ reason: 'idp' }), null);
    await button(w, 'Sign in through your university').trigger('click');
    await flushPromises();
    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('oecp.admin.pendingInvitation')).toBeNull();
    expect(w.text()).toContain('Sign-in could not be started');
  });

  it('explains a home organization mismatch', async () => {
    const w = await acceptWith(mismatch({ reason: 'home_organization' }));
    expect(w.find('[role="alert"]').text()).toContain(
      'did not confirm that you belong to the invited organization',
    );
    expect(buttons(w)).toEqual(['Sign out']);
  });

  it('explains an account that administers another organization (409)', async () => {
    const w = await acceptWith(() => ({
      status: 409,
      body: problem(409, 'oecp.invitation.mismatch', { reason: 'organization' }),
    }));
    expect(w.find('[role="alert"]').text()).toContain('already administers another organization');
  });

  it('reads the reason from the errors[] item as well', async () => {
    const w = await acceptWith(() => ({
      status: 403,
      body: {
        ...problem(403, 'oecp.invitation.mismatch'),
        errors: [
          { code: 'oecp.invitation.mismatch', severity: 'error', message: 'x', reason: 'email' },
        ],
      },
    }));
    expect(w.find('[role="alert"]').text()).toContain('does not have the e-mail address');
  });

  it('keeps the generic text without a reason (or with an unknown one)', async () => {
    const w = await acceptWith(mismatch({}));
    expect(w.find('[role="alert"]').text()).toContain(
      'This invitation was issued for another account',
    );
    const w2 = await acceptWith(mismatch({ reason: 'something_new' }));
    expect(w2.find('[role="alert"]').text()).toContain(
      'This invitation was issued for another account',
    );
    expect(w2.findAll('button').map((b) => b.text())).toEqual(['Sign out']);
  });
});

describe('session restore', () => {
  const slots = { default: () => h('p', { id: 'page' }, 'Page content') };

  it('waits for the silent restore before showing the page', async () => {
    auth.signedIn = false;
    let finish: (value: boolean) => void = () => undefined;
    auth.restoreSession.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = (value) => {
            auth.signedIn = value;
            resolve(value);
          };
        }),
    );
    const w = await mountPage(AdminLayout, '/en/admin', { slots });
    expect(w.text()).toContain('Restoring your session…');
    expect(w.find('#page').exists()).toBe(false);
    // The layout has its own header and main landmarks: check it detached.
    const html = w.html();
    w.element.parentElement?.removeChild(w.element);
    expect(await axeViolations(html, 'div')).toEqual([]);
    document.body.appendChild(w.element);
    finish(true);
    await flushPromises();
    expect(w.find('#page').exists()).toBe(true);
    expect(auth.restoreSession).toHaveBeenCalledTimes(1);
  });

  it('shows the page (and its sign-in prompt) when the restore fails or the user stops waiting', async () => {
    auth.signedIn = false;
    auth.restoreSession.mockReturnValue(new Promise(() => undefined));
    const w = await mountPage(AdminLayout, '/en/admin', { slots });
    await button(w, 'Stop waiting and show the sign-in options').trigger('click');
    expect(w.find('#page').exists()).toBe(true);

    auth.restoreSession.mockResolvedValue(false);
    const w2 = await mountPage(AdminLayout, '/en/admin', { slots });
    expect(w2.find('#page').exists()).toBe(true);
  });

  it('stops holding the page back after 3 seconds and re-mounts it on a late success', async () => {
    auth.signedIn = false;
    let finish: (value: boolean) => void = () => undefined;
    auth.restoreSession.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          auth.restoring = true;
          finish = (value) => {
            auth.signedIn = value;
            auth.restoring = false;
            resolve(value);
          };
        }),
    );
    let mounts = 0;
    const Page = defineComponent({
      setup() {
        onMounted(() => mounts++);
        return () => h('p', { id: 'page' }, 'Page content');
      },
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const w = await mountPage(AdminLayout, '/en/admin', { slots: { default: () => h(Page) } });
    expect(w.find('#page').exists()).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    await flushPromises();
    expect(w.find('#page').exists()).toBe(true);
    expect(mounts).toBe(1);
    expect(w.text()).toContain('Still checking whether your session can be restored.');
    finish(true);
    await flushPromises();
    expect(mounts).toBe(2);
    expect(w.text()).not.toContain('Still checking');
  });

  it('does not restore when somebody is signed in', async () => {
    const w = await mountPage(AdminLayout, '/en/admin', { slots });
    expect(w.find('#page').exists()).toBe(true);
    expect(auth.restoreSession).not.toHaveBeenCalled();
  });

  it('the silent-callback page hands the response to the parent window', async () => {
    const w = await mountPage(SilentCallbackPage, '/en/admin/silent-callback?code=x&state=y');
    expect(auth.handleSilentCallback).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('Checking your session');
  });
});

// ---------------------------------------------------------------------------

describe('invitations', () => {
  const list = [
    fixtures.invitation(),
    fixtures.invitation({
      id: '7d1f3a2b-0c4e-4f5a-8b6c-1d2e3f4a5b02',
      email: 'done@urv.cat',
      status: 'accepted',
      accepted_at: '2026-10-10T08:00:00.000Z',
      created_at: '2026-10-09T08:00:00.000Z',
    }),
    fixtures.invitation({
      id: '7d1f3a2b-0c4e-4f5a-8b6c-1d2e3f4a5b03',
      email: 'late@urv.cat',
      status: 'expired',
      expires_at: '2026-10-08T08:00:00.000Z',
      created_at: '2026-10-01T08:00:00.000Z',
    }),
  ];

  it('shows a partner administrator the list without the invitation form', async () => {
    serve({
      [INVITATIONS]: () => ({ status: 200, body: { items: [list[1]!] } }),
    });
    const w = await mountPage(InvitationsPage, '/en/admin/invitations');
    expect(w.find('h1').text()).toBe('Invitations');
    expect(w.find('form').exists()).toBe(false);
    expect(w.text()).toContain('Only alliance administrators can send invitations');
    expect(w.findAll('table thead th').map((th) => th.text())).not.toContain('Actions');
    expect(w.text()).toContain('Only alliance administrators can revoke or resend');
    expect(callsTo(CREATE_INVITATION)).toHaveLength(0);
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('lets an alliance administrator invite with inline validation', async () => {
    let listed = [list[1]!];
    asAlliance({
      [INVITATIONS]: () => ({ status: 200, body: { items: listed } }),
      [CREATE_INVITATION]: (request) => {
        listed = [fixtures.invitation(), ...listed];
        return {
          status: 201,
          body: fixtures.invitation({ email: String((request.body as { email: string }).email) }),
        };
      },
    });
    const w = await mountPage(InvitationsPage, `/en/admin/invitations?org=${ORG_ID}`);
    expect(w.text()).toContain('valid for 7 days');

    // Inline validation.
    await w.find('input[type="email"]').setValue('not-an-address');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('.admin-field-error').text()).toContain('Enter an e-mail address');
    expect(w.find('input[type="email"]').attributes('aria-invalid')).toBe('true');
    expect(callsTo(CREATE_INVITATION)).toHaveLength(0);

    await w.find('input[type="email"]').setValue('  New.Admin@urv.cat ');
    await w.find('select[id$="-role"]').setValue('partner_admin');
    await w.find('select[id$="-ttl"]').setValue('72');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(callsTo(CREATE_INVITATION)[0]!.body).toEqual({
      email: 'New.Admin@urv.cat',
      role: 'partner_admin',
      ttl_hours: 72,
    });
    expect(w.find('[role="status"]').text()).toContain('Invitation sent to New.Admin@urv.cat');
    expect(callsTo(INVITATIONS)).toHaveLength(2);
  });

  it('lists the invitations of the chosen organization with status badges, revoke and resend', async () => {
    const other = `${API}/organizations/${OTHER_ORG_ID}/invitations`;
    asAlliance({
      [`GET ${other}`]: ok({ items: list.map((i) => ({ ...i, organization_id: OTHER_ORG_ID })) }),
      [`DELETE ${API}/invitations/${INVITATION_ID}`]: ok(undefined, 204),
      [`POST ${API}/invitations/${list[2]!.id}/resend`]: ok(
        fixtures.invitation({ email: 'late@urv.cat', expires_at: '2026-10-21T08:00:00.000Z' }),
        201,
      ),
    });
    const w = await mountPage(InvitationsPage, `/en/admin/invitations?org=${OTHER_ORG_ID}`);
    expect((w.find('.admin-org-picker select').element as HTMLSelectElement).value).toBe(
      OTHER_ORG_ID,
    );
    expect(
      w
        .find('select[id$="-role"]')
        .findAll('option')
        .map((o) => o.text()),
    ).toEqual(['Partner administrator', 'Alliance administrator']);
    expect(w.find('caption').text()).toBe('3 invitations, newest first');
    const rows = rowsOf(w);
    expect(rows.map((r) => r.slice(0, 3))).toEqual([
      ['new.admin@urv.cat', 'Partner administrator', 'Pending'],
      ['done@urv.cat', 'Partner administrator', 'Accepted'],
      ['late@urv.cat', 'Partner administrator', 'Expired'],
    ]);
    expect(w.findAll('tbody tr').map((r) => r.findAll('button').map((b) => b.text()))).toEqual([
      ['Resend', 'Revoke'],
      [],
      ['Resend'],
    ]);
    const pendingRevoke = w.findAll('tbody tr')[0]!.findAll('button')[1]!;
    expect(pendingRevoke.attributes('aria-label')).toBe(
      'Revoke the invitation to new.admin@urv.cat',
    );
    expect(await axeViolations(w.html())).toEqual([]);

    // Revoke: cancelling sends nothing; confirming sends DELETE.
    await pendingRevoke.trigger('click');
    await confirmDialog(w, 'no');
    expect(callsTo(`DELETE ${API}/invitations/${INVITATION_ID}`)).toHaveLength(0);
    await pendingRevoke.trigger('click');
    await flushPromises();
    expect(w.find('dialog').text()).toContain('stops working at once');
    await confirmDialog(w);
    expect(callsTo(`DELETE ${API}/invitations/${INVITATION_ID}`)).toHaveLength(1);
    expect(w.text()).toContain('The invitation to new.admin@urv.cat was revoked.');

    await w.findAll('tbody tr')[2]!.find('button').trigger('click');
    await confirmDialog(w);
    expect(callsTo(`POST ${API}/invitations/${list[2]!.id}/resend`)).toHaveLength(1);
    expect(w.text()).toContain('A new invitation was sent to late@urv.cat');
  });

  it('explains API failures', async () => {
    asAlliance({
      [INVITATIONS]: ok({ items: [] }),
      [CREATE_INVITATION]: fail(502, 'oecp.mail.unavailable'),
    });
    const w = await mountPage(InvitationsPage, `/en/admin/invitations?org=${ORG_ID}`);
    expect(w.text()).toContain('No invitations for this organization yet.');
    await w.find('input[type="email"]').setValue('x@urv.cat');
    await w.find('form').trigger('submit');
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toContain('The e-mail could not be sent');
  });

  describe('organization identity provider not enabled', () => {
    const DETAIL =
      'Identity provider "urv" of organization urv is not enabled in the realm; ' +
      "enable it or clear the organization's identity provider alias before inviting";
    const withIdp = (alias: string | null) =>
      ok(fixtures.organization({ keycloak_idp_alias: alias }));
    const warning = (w: Wrapper) =>
      w.findAll('.notice[role="status"]').find((n) => n.text().includes('identity provider'));

    it('warns when the alias is set but the reference does not publish it, and shows the 409', async () => {
      asAlliance({
        [ORG]: withIdp('urv'),
        [INVITATIONS]: ok({ items: [] }),
        [CREATE_INVITATION]: () => ({
          status: 409,
          body: problem(409, 'oecp.invitation.idp_not_enabled', {
            detail: DETAIL,
            idp_alias: 'urv',
          }),
        }),
      });
      const w = await mountPage(InvitationsPage, `/en/admin/invitations?org=${ORG_ID}`);
      const notice = warning(w);
      expect(notice?.text()).toContain('identity provider "urv" is not enabled');
      expect(notice?.text()).toContain('Invitations will be refused');
      expect(notice?.find('a').attributes('href')).toBe(`/en/admin/organizations/${ORG_ID}`);
      expect(button(w, 'Send invitation').attributes('disabled')).toBeUndefined();
      expect(await axeViolations(w.html())).toEqual([]);

      await w.find('input[type="email"]').setValue('x@urv.cat');
      await w.find('form').trigger('submit');
      await flushPromises();
      expect(callsTo(CREATE_INVITATION)).toHaveLength(1);
      const alert = w.find('[role="alert"]').text();
      expect(alert).toContain("the organization's identity provider is not enabled");
      expect(alert).toContain(DETAIL);
      expect(alert).toContain('oecp.invitation.idp_not_enabled');
    });

    it('does not warn when the reference publishes the alias or the organization has none', async () => {
      const published = {
        ...fixtures.reference,
        organizations: fixtures.reference.organizations.map((o) =>
          o.id === ORG_ID ? { ...o, idp_alias: 'urv' } : o,
        ),
      };
      asAlliance({
        [ORG]: withIdp('urv'),
        [REFERENCE]: ok(published),
        [INVITATIONS]: ok({ items: [] }),
      });
      let w = await mountPage(InvitationsPage, `/en/admin/invitations?org=${ORG_ID}`);
      expect(w.find('form').exists()).toBe(true);
      expect(warning(w)).toBeUndefined();

      w.unmount();
      resetAdminReference();
      asAlliance({ [ORG]: withIdp(null), [INVITATIONS]: ok({ items: [] }) });
      w = await mountPage(InvitationsPage, `/en/admin/invitations?org=${ORG_ID}`);
      expect(w.find('form').exists()).toBe(true);
      expect(warning(w)).toBeUndefined();
    });

    it('does not check the organization for partner administrators', async () => {
      serve({ [ORG]: withIdp('urv'), [INVITATIONS]: ok({ items: [] }) });
      const w = await mountPage(InvitationsPage, '/en/admin/invitations');
      expect(warning(w)).toBeUndefined();
      expect(callsTo(ORG)).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------

describe('integration settings', () => {
  const saved = (overrides = {}) => fixtures.integration(overrides);

  it('creates the first integration from the defaults (basic credential)', async () => {
    let stored: ReturnType<typeof saved> | null = null;
    serve({
      [INTEGRATION]: () =>
        stored
          ? { status: 200, body: stored }
          : { status: 404, body: problem(404, 'oecp.integration.not_configured') },
      [PUT_INTEGRATION]: (request) => {
        stored = saved({ ...(request.body as object), secret_configured: true });
        return { status: 200, body: stored };
      },
    });
    const w = await mountPage(IntegrationPage, '/en/admin/integration');
    expect(w.text()).toContain('No integration is configured for this organization yet');
    expect(w.find('#integration-heading').exists()).toBe(false);
    expect(
      (w.find('#integration-authoritative_channel-form').element as HTMLInputElement).checked,
    ).toBe(true);
    expect(await axeViolations(w.html())).toEqual([]);

    await w.find('#integration-authoritative_channel-oeapi').setValue(true);
    await w.find('#integration-access_mode').setValue('direct');
    await w.find('#integration-base_url').setValue('https://oeapi.urv.example/v5');
    await w.find('#integration-auth_scheme').setValue('basic');
    expect(w.text()).toContain('No credential stored');
    expect(w.find('#integration-secret_action').exists()).toBe(false);
    await w.find('#integration-basic_username').setValue('oecp');
    await w.find('#integration-basic_password').setValue('p:w');
    expect(w.find('#integration-basic_password').attributes('type')).toBe('password');
    expect(w.find('#integration-basic_password').attributes('autocomplete')).toBe('new-password');
    await w.find('#integration-schedule_preset').setValue('0 */6 * * *');
    await w.find('form.admin-form').trigger('submit');
    await flushPromises();

    expect(callsTo(PUT_INTEGRATION)[0]!.body).toEqual({
      authoritative_channel: 'oeapi',
      access_mode: 'direct',
      oeapi_version: '5',
      consumer_profile: 'eduxchange',
      base_url: 'https://oeapi.urv.example/v5',
      auth_scheme: 'basic',
      api_key_header_name: null,
      secret: 'oecp:p:w',
      surfeduhub_endpoint_id: null,
      schedule_cron: '0 */6 * * *',
      schedule_timezone: 'Europe/Brussels',
      page_size: 100,
      max_requests_per_second: 2,
      withdraw_after_absences: 3,
      enabled: false,
    });
    expect(w.text()).toContain('Settings saved.');
    expect(w.text()).toContain('A credential is stored');
    // The credential is never shown again: the inputs are gone or empty.
    expect(w.find('#integration-secret_action').element).toBeDefined();
    expect((w.find('#integration-secret_action').element as HTMLInputElement).checked).toBe(true);
    expect(w.find('#integration-basic_password').exists()).toBe(false);
    expect(w.html()).not.toContain('p:w');
  });

  it('validates inline with an error summary and sends nothing', async () => {
    serve({ [INTEGRATION]: fail(404, 'oecp.integration.not_configured') });
    const w = await mountPage(IntegrationPage, '/en/admin/integration');
    await w.find('#integration-authoritative_channel-oeapi').setValue(true);
    await w.find('#integration-page_size').setValue('500');
    await w.find('#integration-enabled').setValue(true);
    await w.find('form.admin-form').trigger('submit');
    await flushPromises();
    expect(callsTo(PUT_INTEGRATION)).toHaveLength(0);
    const summary = w.find('.admin-error-summary');
    expect(summary.find('h2').text()).toBe('There are problems with 2 fields');
    expect(summary.findAll('a').map((a) => [a.attributes('href'), a.text()])).toEqual([
      ['#integration-access_mode', 'Choose an access mode for OEAPI harvesting.'],
      ['#integration-page_size', 'Enter a whole number from 10 to 250.'],
    ]);
    expect(w.find('#integration-page_size').attributes('aria-invalid')).toBe('true');
    expect(document.activeElement?.closest('.admin-error-summary')).not.toBeNull();
    await summary.findAll('a')[1]!.trigger('click');
    expect(document.activeElement?.id).toBe('integration-page_size');
    // Fixing a field updates the errors live.
    await w.find('#integration-page_size').setValue('50');
    expect(w.findAll('.admin-error-summary a')).toHaveLength(1);
  });

  it('keeps, replaces or deletes the stored credential', async () => {
    serve({ [INTEGRATION]: ok(saved()), [PUT_INTEGRATION]: ok(saved()) });
    const w = await mountPage(IntegrationPage, '/en/admin/integration');
    expect(w.text()).toContain('A credential is stored');
    const submit = async () => {
      await w.find('form.admin-form').trigger('submit');
      await flushPromises();
      return callsTo(PUT_INTEGRATION).at(-1)!.body as Record<string, unknown>;
    };
    expect(await submit()).not.toHaveProperty('secret');

    await w.find('#integration-secret_action-replace').setValue(true);
    await w.find('#integration-auth_scheme').setValue('bearer');
    await w.find('#integration-secret').setValue('new-token');
    expect(await submit()).toMatchObject({ auth_scheme: 'bearer', secret: 'new-token' });

    await w.find('#integration-secret_action-delete').setValue(true);
    expect(callsTo(PUT_INTEGRATION)).toHaveLength(2);
    await w.find('form.admin-form').trigger('submit');
    await flushPromises();
    expect(callsTo(PUT_INTEGRATION)).toHaveLength(2);
    expect(w.find('.admin-error-summary').text()).toContain('needs a credential');

    await w.find('#integration-auth_scheme').setValue('none');
    expect(w.text()).toContain('Saving with authentication None deletes the stored credential.');
    expect(await submit()).toMatchObject({ auth_scheme: 'none', secret: null });
  });

  it('shows server validation errors on their fields', async () => {
    serve({
      [INTEGRATION]: ok(saved()),
      [PUT_INTEGRATION]: () => ({
        status: 422,
        body: {
          type: 'about:blank',
          title: 'Insecure URL',
          status: 422,
          errors: [
            {
              code: 'oecp.integration.insecure_url',
              severity: 'error',
              message: 'x',
              pointer: '/base_url',
            },
          ],
        },
      }),
    });
    const w = await mountPage(IntegrationPage, '/en/admin/integration');
    await w.find('form.admin-form').trigger('submit');
    await flushPromises();
    expect(w.find('#integration-base_url-error').text()).toContain('must use https on port 443');
  });

  it('lets alliance administrators approve the host; partners are told to ask', async () => {
    serve({ [INTEGRATION]: ok(saved()) });
    const partner = await mountPage(IntegrationPage, '/en/admin/integration');
    const card = partner.find('[aria-labelledby="approval-heading"]');
    expect(facts(partner, '[aria-labelledby="approval-heading"] dl')).toMatchObject({
      'Host of the base URL': 'oeapi.urv.example',
      Approval: 'Waiting for approval',
    });
    expect(card.find('button').exists()).toBe(false);
    expect(card.text()).toContain('Ask an alliance administrator to approve this host');

    auth.token = `token-${++auth.count}`;
    asAlliance({
      [INTEGRATION]: ok(saved()),
      [APPROVE]: ok(
        saved({
          approved_host: 'oeapi.urv.example',
          approved_by: 'self-sub',
          approved_at: '2026-10-14T09:00:00.000Z',
          host_approved: true,
        }),
      ),
    });
    const w = await mountPage(IntegrationPage, `/en/admin/integration?org=${ORG_ID}`);
    await w.find('#integration-consumer_profile').setValue('edited-but-unsaved');
    await button(w, 'Approve host oeapi.urv.example').trigger('click');
    await confirmDialog(w);
    expect(callsTo(APPROVE)).toHaveLength(1);
    expect(facts(w, '[aria-labelledby="approval-heading"] dl')).toMatchObject({
      Approval: 'Approved',
    });
    expect(w.text()).toContain('Host oeapi.urv.example approved.');
    // Unsaved edits survive the approval.
    expect((w.find('#integration-consumer_profile').element as HTMLInputElement).value).toBe(
      'edited-but-unsaved',
    );
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('tests the connection and shows the result card', async () => {
    serve({
      [INTEGRATION]: ok(saved({ host_approved: true, approved_host: 'oeapi.urv.example' })),
      [TEST]: ok({
        ok: true,
        target: 'https://oeapi.urv.example/v5',
        duration_ms: 420,
        service: { contact_email: 'it@urv.cat', specification: 'v5', documentation: null },
        first_course_primary_code: 'URV-101',
        courses_available: true,
        error: null,
      }),
    });
    const w = await mountPage(IntegrationPage, '/en/admin/integration');
    await button(w, 'Test connection').trigger('click');
    await flushPromises();
    expect(w.find('#test-heading').text()).toBe('The connection works');
    expect(facts(w, '[aria-labelledby="test-heading"] dl')).toMatchObject({
      Target: 'https://oeapi.urv.example/v5',
      'Service contact': 'it@urv.cat',
      'Courses available': 'Yes',
      'First course code': 'URV-101',
    });
    expect(await axeViolations(w.html())).toEqual([]);

    serve({
      [INTEGRATION]: ok(saved({ host_approved: true })),
      [TEST]: ok({
        ok: false,
        target: 'https://oeapi.urv.example/v5',
        duration_ms: 30_000,
        service: null,
        first_course_primary_code: null,
        courses_available: null,
        error: { code: 'oecp.oeapi.unauthorized', message: 'HTTP 401 from /', status: 401 },
      }),
    });
    const w2 = await mountPage(IntegrationPage, '/en/admin/integration');
    await button(w2, 'Test connection').trigger('click');
    await flushPromises();
    const card = w2.find('[aria-labelledby="test-heading"]');
    expect(card.find('[role="alert"]').text()).toBe('The connection failed');
    expect(card.text()).toContain('Error code: oecp.oeapi.unauthorized');
    expect(card.text()).toContain('HTTP 401');
    expect(card.text()).toContain('check the authentication method');

    serve({ [INTEGRATION]: ok(saved()), [TEST]: fail(409, 'oecp.oeapi.host_not_approved') });
    const w3 = await mountPage(IntegrationPage, '/en/admin/integration');
    await button(w3, 'Test connection').trigger('click');
    await flushPromises();
    const alert = w3.findAll('[role="alert"]').at(-1)!;
    expect(alert.text()).toContain('The connection cannot be tested yet');
    expect(alert.text()).toContain('The host of the base URL is not approved yet');
  });

  it('queues Sync now (202) and links to the run', async () => {
    serve({
      [INTEGRATION]: ok(saved({ host_approved: true })),
      [SYNC]: ok({ sync_run_id: RUN_ID, status: 'queued' }, 202),
    });
    const w = await mountPage(IntegrationPage, '/en/admin/integration');
    await button(w, 'Sync now').trigger('click');
    await flushPromises();
    expect(w.text()).toContain('The harvest is queued.');
    const link = w.findAll('a').find((a) => a.text() === 'Follow the run')!;
    expect(link.attributes('href')).toBe(`/en/admin/sync-runs/${RUN_ID}`);
  });

  it.each([
    [409, 'oecp.sync.already_running', 'already in progress', {}],
    [409, 'oecp.sync.channel_disabled', 'Sync now needs OEAPI harvesting', {}],
    [429, 'oecp.sync.rate_limited', 'Try again in about 12 minutes.', { 'retry-after': '700' }],
  ])('explains a %s %s from Sync now', async (status, code, text, headers) => {
    serve({
      [INTEGRATION]: ok(saved({ host_approved: true })),
      [SYNC]: fail(status, code, headers),
    });
    const w = await mountPage(IntegrationPage, '/en/admin/integration');
    await button(w, 'Sync now').trigger('click');
    await flushPromises();
    const alert = w.findAll('[role="alert"]').at(-1)!;
    expect(alert.text()).toContain('The harvest could not be started');
    expect(alert.text()).toContain(text);
    expect(alert.text()).toContain(`Error code: ${code}`);
  });

  it('summarises the last run with links to it and to the history', async () => {
    serve({
      [INTEGRATION]: ok(
        saved({
          last_run: fixtures.run({ channel: 'oeapi', trigger_kind: 'schedule', n_rejected: 2 }),
        }),
      ),
    });
    const w = await mountPage(IntegrationPage, '/en/admin/integration');
    const summary = w.find('[aria-labelledby="integration-heading"]');
    expect(facts(w, '[aria-labelledby="integration-heading"] dl')).toMatchObject({
      'Authoritative channel': 'OEAPI harvest',
      'Access mode': 'Direct',
      'Harvesting enabled': 'No',
    });
    expect(summary.text()).toContain('2 created, 1 updated, 2 rejected, 0 withdrawn');
    expect(summary.findAll('a').map((a) => a.attributes('href'))).toEqual([
      `/en/admin/sync-runs/${RUN_ID}`,
      '/en/admin/sync-runs',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('organizations', () => {
  const sub = fixtures.organization({
    id: '0b9f6c1e-1d7a-4f39-9a51-6c1e0f0a0011',
    slug: 'urv-etse',
    org_type: 'faculty',
    is_partner: false,
    parent_id: ORG_ID,
    name: { en: 'School of Engineering' },
    keycloak_idp_alias: null,
    schac_home_organization: null,
    erasmus_code: null,
    pic: null,
    counts: { courses_total: 4, courses_published: 4, sub_units: 0 },
  });
  const vienna = fixtures.organization({
    id: '0b9f6c1e-1d7a-4f39-9a51-6c1e0f0a0003',
    slug: 'univie',
    name: { en: 'University of Vienna' },
    keycloak_idp_alias: 'univie',
    schac_home_organization: 'univie.ac.at',
    deleted_at: '2026-10-10T08:00:00.000Z',
  });
  const all = [fixtures.organization(), sub, vienna];

  it('is for alliance administrators only', async () => {
    const w = await mountPage(OrganizationsPage, '/en/admin/organizations');
    expect(w.find('[role="alert"]').text()).toContain('for alliance administrators');
    expect(callsTo(ORGS)).toHaveLength(0);
    const n = await mountPage(NetworkPage, '/en/admin/network');
    expect(n.find('[role="alert"]').text()).toContain('for alliance administrators');
  });

  it('lists every organization with counts, IdP alias and state, filtered in the browser', async () => {
    asAlliance({ [ORGS]: ok({ items: all }) });
    const w = await mountPage(OrganizationsPage, '/en/admin/organizations');
    expect(callsTo(ORGS)[0]!.query).toEqual({ include_deleted: 'true' });
    expect(w.find('a.button').attributes('href')).toBe('/en/admin/organizations/new');
    expect(w.find('caption').text()).toBe('2 of 3 organizations, by name');
    expect(rowsOf(w)).toEqual([
      [
        'urv-etse',
        'School of Engineering',
        'Faculty',
        'No',
        'Universitat Rovira i Virgili',
        '4 published of 4',
        '0',
        'OECP accounts',
        'Active',
      ],
      [
        'urv',
        'Universitat Rovira i Virgili',
        'Institution',
        'Yes',
        'None',
        '9 published of 12',
        '2',
        'OECP accounts',
        'Active',
      ],
    ]);
    expect(w.find('tbody th a').attributes('href')).toBe(`/en/admin/organizations/${sub.id}`);
    expect(await axeViolations(w.html())).toEqual([]);

    await w.find('#orgs-state').setValue('deleted');
    expect(rowsOf(w)).toEqual([
      [
        'univie',
        'University of Vienna',
        'Institution',
        'Yes',
        'None',
        '9 published of 12',
        '2',
        'univie',
        'Deleted',
      ],
    ]);
    await w.find('#orgs-state').setValue('all');
    await w.find('#orgs-q').setValue('engineering');
    expect(rowsOf(w).map((r) => r[0])).toEqual(['urv-etse']);
    await w.find('#orgs-q').setValue('');
    await w.find('#orgs-type').setValue('institution');
    await w.find('#orgs-partner').setValue('yes');
    expect(rowsOf(w).map((r) => r[0])).toEqual(['urv', 'univie']);
    await w.find('#orgs-q').setValue('nothing matches');
    expect(w.text()).toContain('No organizations match the filters.');
    await button(w, 'Clear filters').trigger('click');
    expect(rowsOf(w)).toHaveLength(2);
  });

  it('creates an organization after inline validation', async () => {
    const created = fixtures.organization({
      id: OTHER_ORG_ID,
      slug: 'uibk',
      name: { en: 'University of Innsbruck' },
    });
    asAlliance({
      [ORGS]: ok({ items: all }),
      [`POST ${API}/organizations`]: ok(created, 201),
    });
    const w = await mountPage(NewOrganizationPage, '/en/admin/organizations/new');
    expect(w.find('h1').text()).toBe('New organization');
    const parent = w.find('#org-parent_id');
    // Deleted organizations are not offered; sub-units follow their parent.
    expect(parent.findAll('option').map((o) => o.text())).toEqual([
      'None (top level)',
      'Universitat Rovira i Virgili',
      '— School of Engineering',
    ]);
    expect(await axeViolations(w.html())).toEqual([]);

    await w.find('#org-slug').setValue('UIBK');
    await button(w, 'Create organization').trigger('submit');
    await w.find('form.admin-form').trigger('submit');
    await flushPromises();
    expect(callsTo(`POST ${API}/organizations`)).toHaveLength(0);
    expect(w.findAll('.admin-error-summary a').map((a) => a.attributes('href'))).toEqual([
      '#org-slug',
      '#org-names-0-text',
    ]);

    await w.find('#org-slug').setValue('uibk');
    await w.find('#org-names-0-text').setValue('University of Innsbruck');
    await button(w, 'Add a name in another language').trigger('click');
    await w.find('#org-names-1-lang').setValue('de');
    await w.find('#org-names-1-text').setValue('Universität Innsbruck');
    await w.find('#org-country_code').setValue('AT');
    await w.find('#org-keycloak_idp_alias').setValue('uibk');
    await w.find('#org-ui_languages').setValue('en, de');
    const push = vi.spyOn(useRouter(), 'push').mockResolvedValue(undefined);
    await w.find('form.admin-form').trigger('submit');
    await flushPromises();
    expect(callsTo(`POST ${API}/organizations`)[0]!.body).toEqual({
      slug: 'uibk',
      org_type: 'institution',
      is_partner: true,
      parent_id: null,
      name: { en: 'University of Innsbruck', de: 'Universität Innsbruck' },
      country_code: 'AT',
      schac_home_organization: null,
      keycloak_idp_alias: 'uibk',
      contact_email: null,
      default_timezone: 'Europe/Brussels',
      ui_languages: ['en', 'de'],
      website_url: null,
      logo_url: null,
      erasmus_code: null,
      pic: null,
      ext_id: null,
    });
    expect(push).toHaveBeenCalledWith(`/en/admin/organizations/${OTHER_ORG_ID}`);
  });

  it('shows a duplicate slug on the slug field', async () => {
    asAlliance({
      [ORGS]: ok({ items: all }),
      [`POST ${API}/organizations`]: fail(409, 'oecp.content.duplicate_slug'),
    });
    const w = await mountPage(NewOrganizationPage, '/en/admin/organizations/new');
    await w.find('#org-slug').setValue('urv');
    await w.find('#org-names-0-text').setValue('Copy');
    await w.find('form.admin-form').trigger('submit');
    await flushPromises();
    expect(w.find('#org-slug-error').text()).toContain(
      'Another organization already uses this slug.',
    );
  });

  describe('organization page', () => {
    const PUT = `PUT ${API}/organizations/${ORG_ID}`;
    const DELETE = `DELETE ${API}/organizations/${ORG_ID}`;
    const RESTORE = `POST ${API}/organizations/${ORG_ID}/restore`;
    const admins = [
      fixtures.account({
        sub: 'self-sub',
        name: 'Me Myself',
        roles: ['alliance_admin'],
        email: 'me@aurora.eu',
      }),
      fixtures.account({ required_actions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'] }),
      fixtures.account({
        sub: 'user-3',
        name: 'Joan Brokered',
        email: 'joan@urv.cat',
        idp: 'urv',
        last_login_at: null,
        required_actions: ['CONFIGURE_TOTP'],
      }),
    ];
    const routes = (extra: Record<string, Route> = {}) => ({
      [ORG]: ok(fixtures.organization()),
      [ORGS]: ok({ items: all }),
      [ADMINS]: ok({ items: admins }),
      [INVITATIONS]: ok({ items: [fixtures.invitation()] }),
      ...extra,
    });

    it('shows the sections, the details form and the related links', async () => {
      asAlliance(
        routes({ [PUT]: (r) => ({ status: 200, body: fixtures.organization(r.body as object) }) }),
      );
      const w = await mountPage(OrganizationPage, `/en/admin/organizations/${ORG_ID}`);
      expect(w.find('h1').text()).toBe('Universitat Rovira i Virgili');
      expect(w.findAll('.admin-toc a').map((a) => a.text())).toEqual([
        'Details',
        'Administrators',
        'Invitations',
        'Integration',
        'Courses',
        'Delete or restore',
      ]);
      expect(w.find('#org-slug').attributes('disabled')).toBeDefined();
      // The organization and its sub-units are not offered as parent.
      expect(
        w
          .find('#org-parent_id')
          .findAll('option')
          .map((o) => o.text()),
      ).toEqual(['None (top level)']);
      const hrefs = w.findAll('a').map((a) => a.attributes('href'));
      expect(hrefs).toContain(`/en/admin/integration?org=${ORG_ID}`);
      expect(hrefs).toContain(`/en/admin/sync-runs?org=${ORG_ID}`);
      expect(hrefs).toContain(`/en/admin/courses?org=${ORG_ID}`);
      expect(hrefs).toContain(`/en/admin/invitations?org=${ORG_ID}`);
      expect(callsTo(INVITATIONS)).toHaveLength(1);
      expect(await axeViolations(w.html())).toEqual([]);

      await w.find('#org-contact_email').setValue('international@urv.cat');
      await w.find('form.admin-form').trigger('submit');
      await flushPromises();
      expect(callsTo(PUT)[0]!.body).toMatchObject({
        slug: 'urv',
        contact_email: 'international@urv.cat',
        name: { en: 'Universitat Rovira i Virgili', ca: 'Universitat Rovira i Virgili' },
        ui_languages: ['en', 'ca', 'es'],
      });
      expect(w.text()).toContain('Changes saved.');
    });

    it('explains why an organization in use cannot be deleted', async () => {
      asAlliance(routes({ [DELETE]: fail(409, 'oecp.content.organization_in_use') }));
      const w = await mountPage(OrganizationPage, `/en/admin/organizations/${ORG_ID}`);
      expect(w.find('[aria-labelledby="section-state"]').text()).toContain('enabled harvest');
      await button(w, 'Delete organization').trigger('click');
      await confirmDialog(w, 'no');
      expect(callsTo(DELETE)).toHaveLength(0);
      await button(w, 'Delete organization').trigger('click');
      await confirmDialog(w);
      expect(callsTo(DELETE)).toHaveLength(1);
      expect(w.find('[role="alert"]').text()).toContain('still in use, so it cannot be deleted');
    });

    it('deletes and restores', async () => {
      let deleted = false;
      asAlliance(
        routes({
          [ORG]: () => ({
            status: 200,
            body: fixtures.organization(deleted ? { deleted_at: '2026-10-14T09:00:00.000Z' } : {}),
          }),
          [DELETE]: () => {
            deleted = true;
            return { status: 204, body: undefined };
          },
          [RESTORE]: () => {
            deleted = false;
            return { status: 200, body: fixtures.organization() };
          },
        }),
      );
      const w = await mountPage(OrganizationPage, `/en/admin/organizations/${ORG_ID}`);
      await button(w, 'Delete organization').trigger('click');
      await confirmDialog(w);
      expect(w.text()).toContain('Universitat Rovira i Virgili was deleted.');
      expect(w.find('#section-admins').exists()).toBe(false);
      expect(w.findAll('.admin-toc a').map((a) => a.text())).toEqual([
        'Details',
        'Delete or restore',
      ]);
      await button(w, 'Restore organization').trigger('click');
      await confirmDialog(w);
      expect(callsTo(RESTORE)).toHaveLength(1);
      expect(w.text()).toContain('Universitat Rovira i Virgili was restored.');
      expect(w.find('#section-admins').exists()).toBe(true);
    });

    it('lists the administrators with removal rules and set-up e-mails for local accounts', async () => {
      const REMOVE = `DELETE ${API}/organizations/${ORG_ID}/admins/user-2`;
      const RESEND = `POST ${API}/organizations/${ORG_ID}/admins/user-2/resend-setup`;
      asAlliance(
        routes({ [REMOVE]: ok(undefined, 204), [RESEND]: ok({ sub: 'user-2', actions: [] }) }),
      );
      const w = await mountPage(OrganizationPage, `/en/admin/organizations/${ORG_ID}`);
      const table = w.find('[aria-labelledby="section-admins"] table');
      const rows = table.findAll('tbody tr');
      expect(rows.map((r) => r.find('th').text())).toEqual([
        'Me Myself (you)',
        'Maria Puig',
        'Joan Brokered',
      ]);
      // Self and the last alliance administrator cannot be removed: explained, no button.
      expect(rows[0]!.text()).toContain('You cannot remove yourself');
      // Set-up e-mails only for local accounts whose set-up is pending.
      expect(rows[0]!.findAll('button').map((b) => b.text())).toEqual([]);
      expect(rows[0]!.findAll('td')[3]!.text()).toBe('Active');
      expect(rows[1]!.findAll('td')[3]!.text()).toBe(
        'Set-up pending: set a password, set up a one-time code app',
      );
      expect(rows[1]!.findAll('button').map((b) => b.text())).toEqual([
        'Resend set-up e-mail',
        'Remove',
      ]);
      // Brokered accounts sign in at their university: no set-up e-mail.
      expect(rows[2]!.findAll('td').map((td) => td.text())).toEqual([
        'joan@urv.cat',
        'Partner administrator',
        'University login (urv)',
        'Set-up pending: set up a one-time code app',
        'Never',
        'Remove',
      ]);

      await rows[1]!.findAll('button')[1]!.trigger('click');
      await flushPromises();
      expect(w.find('dialog').text()).toContain('Maria Puig loses the administration role');
      await confirmDialog(w);
      expect(callsTo(REMOVE)).toHaveLength(1);
      expect(w.text()).toContain('Maria Puig is no longer an administrator');

      await w
        .find('[aria-labelledby="section-admins"] tbody tr:nth-child(2) button')
        .trigger('click');
      await confirmDialog(w);
      expect(callsTo(RESEND)).toHaveLength(1);
      expect(w.text()).toContain('A new set-up e-mail was sent to maria@urv.cat.');
    });

    it('explains a refused removal from the server', async () => {
      const REMOVE = `DELETE ${API}/organizations/${ORG_ID}/admins/user-2`;
      asAlliance(
        routes({
          [ADMINS]: ok({
            items: [
              fixtures.account({ roles: ['alliance_admin'] }),
              fixtures.account({ sub: 'user-9', roles: ['alliance_admin'], name: 'Other' }),
            ],
          }),
          [REMOVE]: fail(409, 'oecp.admin.last_alliance_admin'),
        }),
      );
      const w = await mountPage(OrganizationPage, `/en/admin/organizations/${ORG_ID}`);
      await w
        .find(
          '[aria-labelledby="section-admins"] button[aria-label="Remove Maria Puig as administrator"]',
        )
        .trigger('click');
      await confirmDialog(w);
      expect(w.find('[aria-labelledby="section-admins"] [role="alert"]').text()).toContain(
        'The last alliance administrator cannot be removed',
      );
    });

    it('explains the last alliance administrator up front', async () => {
      asAlliance(
        routes({ [ADMINS]: ok({ items: [fixtures.account({ roles: ['alliance_admin'] })] }) }),
      );
      const w = await mountPage(OrganizationPage, `/en/admin/organizations/${ORG_ID}`);
      const row = w.find('[aria-labelledby="section-admins"] tbody tr');
      expect(row.text()).toContain('The last alliance administrator cannot be removed');
      expect(row.findAll('button')).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------

describe('network status', () => {
  const items = [
    fixtures.networkItem(),
    fixtures.networkItem({
      organization: {
        id: OTHER_ORG_ID,
        slug: 'vu-amsterdam',
        name: { en: 'Vrije Universiteit Amsterdam' },
        is_partner: true,
        org_type: 'institution',
      },
      host_approved: false,
      health: 'error',
      last_run: { ...fixtures.networkItem().last_run!, status: 'failed', n_rejected: 7 },
      admins_count: null,
    }),
    fixtures.networkItem({
      organization: {
        id: ALLIANCE_ID,
        slug: 'aurora',
        name: { en: 'Aurora Foundation' },
        is_partner: false,
        org_type: 'alliance',
      },
      authoritative_channel: 'form',
      access_mode: null,
      enabled: false,
      host_approved: false,
      last_run: null,
      last_success_at: null,
      health: 'unconfigured',
    }),
  ];

  it('shows one row per organization, problems first, with health badges and links', async () => {
    asAlliance({ [NETWORK]: ok({ generated_at: '2026-10-14T10:00:00.000Z', items }) });
    const w = await mountPage(NetworkPage, '/en/admin/network');
    expect(w.find('h1').text()).toBe('Network status');
    expect(w.find('caption').text()).toBe('3 organizations');
    expect(
      w.findAll('.admin-health-totals li').map((li) => li.text().replace(/\s+/g, ' ')),
    ).toEqual(['Error 1', 'Warning 0', 'Not configured 1', 'OK 1']);
    const rows = rowsOf(w);
    expect(rows.map((r) => r.slice(0, 5))).toEqual([
      ['Vrije Universiteit Amsterdam', 'Error', 'OEAPI harvest', 'Yes', 'No'],
      ['Aurora Foundation', 'Not configured', 'Web form', 'No', 'Not applicable'],
      ['Universitat Rovira i Virgili', 'OK', 'OEAPI harvest', 'Yes', 'Yes'],
    ]);
    expect(rows[0]![5]).toContain('Failed');
    expect(rows[0]![5]).toContain('7 rejected');
    expect(rows[0]!.slice(7)).toEqual(['30 published of 33', '41', 'Unknown', '1', 'Sync history']);
    expect(rows[1]![5]).toBe('No runs yet');
    const first = w.find('tbody tr');
    expect(first.find('th a').attributes('href')).toBe(`/en/admin/organizations/${OTHER_ORG_ID}`);
    expect(first.findAll('td a').map((a) => a.attributes('href'))).toEqual([
      `/en/admin/sync-runs/${RUN_ID}?org=${OTHER_ORG_ID}`,
      `/en/admin/sync-runs?org=${OTHER_ORG_ID}`,
    ]);
    expect(first.findAll('td a')[1]!.attributes('aria-label')).toBe(
      'Sync history of Vrije Universiteit Amsterdam',
    );
    expect(await axeViolations(w.html())).toEqual([]);

    await button(w, 'Refresh').trigger('click');
    await flushPromises();
    expect(callsTo(NETWORK)).toHaveLength(2);
    expect(w.find('[role="status"].visually-hidden').text()).toContain('Network status updated');
  });

  it('explains API problems', async () => {
    asAlliance({ [NETWORK]: fail(502, 'oecp.identity.unavailable') });
    const w = await mountPage(NetworkPage, '/en/admin/network');
    expect(w.find('[role="alert"]').text()).toContain('The login service did not answer');
  });
});

describe('dashboard modules', () => {
  it('adds Invitations for partners and Network status, Organizations and Maintenance for the alliance', async () => {
    asAlliance();
    const w = await mountPage(DashboardPage, `/en/admin?org=${ORG_ID}`);
    const links = w.findAll('.admin-modules a').map((a) => [a.text(), a.attributes('href')]);
    expect(links).toContainEqual(['Invitations', `/en/admin/invitations?org=${ORG_ID}`]);
    expect(links.slice(-3)).toEqual([
      ['Network status', '/en/admin/network'],
      ['Organizations', '/en/admin/organizations'],
      ['Maintenance', '/en/admin/maintenance'],
    ]);
    expect(await axeViolations(w.html())).toEqual([]);
  });
});
