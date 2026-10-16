// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
/**
 * Brokered (eduGAIN-style) partner administrator through the test SAML IdP
 * playing URV (realm IdP `urv`): invitation with `&idp=urv` → "Sign in through
 * your university" (kc_idp_hint=urv) → IdP login → first-broker-login without
 * linking and post-broker TOTP enrolment → accept → sign in again through the
 * university chooser → role, `idp` claim, admins listing, Keycloak state.
 */
import { expect, test } from '@playwright/test';
import {
  invite,
  listAdmins,
  organization,
  revokeAdminByEmail,
  revokePendingInvitations,
  until,
  watchAdminApi,
} from '../lib/api';
import { AUTH, PORTAL } from '../lib/config';
import {
  deleteUserByEmail,
  findUserByEmail,
  idpLogin,
  idpUser,
  keycloakAdmin,
  keycloakSecondFactor,
} from '../lib/keycloak';
import { allianceToken, newContext } from '../lib/local-account';
import { bodyText, decodeJwt, stateFile } from '../lib/util';

// The address the test IdP asserts for this user is the one invited.
const USER = idpUser('partner.admin');
const ROLE = 'partner_admin';
const TOTP_FILE = stateFile(USER.mail, 'totp');

test('partner admin through the test SAML IdP: accept, sign in again, idp claim, listing', async ({
  browser,
}) => {
  const urv = await organization('urv');
  expect(urv.idp_alias, 'IdP urv enabled in the realm (OECP_DEV_IDP_ENABLED=true)').toBe('urv');
  let token = await allianceToken(browser);
  // A leftover from an earlier run would skip first-broker-login: start clean.
  await revokePendingInvitations(token, USER.mail);
  await revokeAdminByEmail(token, urv.id, USER.mail);
  await deleteUserByEmail(USER.mail);

  try {
    const inv = await invite(token, { email: USER.mail, role: ROLE, organizationId: urv.id });
    expect(inv.status).toBe(201);
    expect(inv.link).toMatch(/#token=[^&]+&idp=urv$/);

    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const api = watchAdminApi(page);
    const authRequests: URL[] = [];
    page.on('request', (r) => {
      // Main frame only: the silent-callback iframe sends prompt=none requests.
      if (
        r.isNavigationRequest() &&
        r.frame() === page.mainFrame() &&
        r.url().startsWith(`${AUTH}/realms/oecp/protocol/openid-connect/auth`)
      ) {
        authRequests.push(new URL(r.url()));
      }
    });

    // 1. Invitation link: brokered sign-in only.
    await page.goto(inv.link, { waitUntil: 'networkidle' });
    expect(page.url(), 'the token fragment is removed from the address bar').not.toContain('#');
    const federated = page.getByRole('button', { name: 'Sign in through your university' });
    await expect(federated).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Continue to your university' })).toHaveCount(0);

    // 2. Through the IdP; first-broker-login creates the user, post-broker MFA enrols TOTP.
    await federated.click();
    expect((await idpLogin(page, USER)).idpVisited).toBe(true);
    expect(authRequests[0]?.searchParams.get('kc_idp_hint')).toBe('urv');
    expect(authRequests[0]?.searchParams.get('acr_values')).toBe('mfa');
    expect(authRequests[0]?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(await keycloakSecondFactor(page, USER.mail, TOTP_FILE)).toEqual(['totp-enrolment']);

    // 3. Acceptance with the role-less token.
    await page.waitForURL(/\/en\/admin\/accept/, { timeout: 30000 });
    const accept = await until(() => api.accept);
    const first = decodeJwt(await until(() => api.token));
    expect(first).toMatchObject({ idp: 'urv', acr: 'mfa', email: USER.mail });
    expect(accept.status).toBe(200);
    expect(accept.body).toMatchObject({ role: ROLE, org_id: urv.id });

    // 4. Sign out, then in again through the university chooser.
    api.token = undefined;
    api.me = undefined;
    await page.getByRole('button', { name: 'Sign out and sign in again' }).click();
    await page.waitForURL(
      (u) => u.href.startsWith(`${PORTAL}/en/admin`) && !u.href.includes('/accept'),
    );
    const chooser = page.getByLabel('Your university', { exact: true });
    await chooser.selectOption('urv');
    await page.getByRole('button', { name: 'Continue to your university' }).click();
    await idpLogin(page, USER);
    expect(await keycloakSecondFactor(page, USER.mail, TOTP_FILE)).toEqual(['otp']);
    await page.waitForURL((u) => /\/en\/admin\/?$/.test(u.pathname), { timeout: 30000 });
    const me = await until(() => (api.me?.roles.length ? api.me : undefined));
    const claims = decodeJwt(await until(() => api.token));
    expect(claims).toMatchObject({ roles: [ROLE], org_id: urv.id, idp: 'urv', acr: 'mfa' });
    expect(me).toMatchObject({ email: USER.mail, roles: [ROLE], org_id: urv.id, idp: 'urv' });
    await expect(page.getByText('Partner administrator').first()).toBeVisible();
    expect(await bodyText(page)).toMatch(/Signed in through\s*urv/);
    await ctx.close();

    // 5. The admins listing and the Keycloak user.
    token = await allianceToken(browser);
    const listed = (await listAdmins(token, urv.id)).find((a) => a.email === USER.mail);
    expect(listed).toMatchObject({ idp: 'urv', roles: [ROLE] });
    const kcUser = await findUserByEmail(USER.mail);
    expect(kcUser?.attributes?.schacHomeOrganization).toEqual([USER.schac]);
    expect(kcUser?.attributes?.oecp_org_id).toEqual([urv.id]);
    const fed = await keycloakAdmin<{ identityProvider: string; userId: string }[]>(
      'GET',
      `/users/${kcUser?.id}/federated-identity`,
    );
    expect(fed.body).toEqual([
      expect.objectContaining({ identityProvider: 'urv', userId: USER.subjectId }),
    ]);
    const creds = await keycloakAdmin<{ type: string }[]>(
      'GET',
      `/users/${kcUser?.id}/credentials`,
    );
    expect(creds.body.map((c) => c.type).sort()).toEqual(['otp']);
  } finally {
    token = await allianceToken(browser);
    await revokePendingInvitations(token, USER.mail);
    await revokeAdminByEmail(token, urv.id, USER.mail);
    await deleteUserByEmail(USER.mail);
  }
  expect(await findUserByEmail(USER.mail)).toBeUndefined();
});
