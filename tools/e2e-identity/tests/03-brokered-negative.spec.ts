// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
/**
 * Negative acceptance checks of the brokered path (spec §2.1 steps 3 and 5),
 * each with its own invitation to `urv`, revoked afterwards, and the brokered
 * test users deleted from Keycloak before and after:
 *   e-mail  invitation for another address, the IdP asserts partner.admin@urv.cat
 *   idp     the alliance admin's address invited to `urv`, link opened without
 *           `&idp=urv`, local sign-in (no `idp` claim)
 *   schac   visiting.scholar asserts schacHomeOrganization=example.edu, not urv.cat
 *   linking the IdP asserts the e-mail of an existing local account: Keycloak
 *           refuses at first-broker-login, nothing is linked or created
 */
import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  invite,
  organization,
  problemCodes,
  type ReferenceOrganization,
  revokePendingInvitations,
  until,
  watchAdminApi,
} from '../lib/api';
import { AUTH, DEV_ALLIANCE_EMAIL, PORTAL, RUN_ID } from '../lib/config';
import {
  deleteUserByEmail,
  findUserByEmail,
  idpLogin,
  type IdpUser,
  idpUser,
  keycloakAdmin,
  keycloakSecondFactor,
  localLogin,
} from '../lib/keycloak';
import { allianceCredentials, allianceToken, newContext } from '../lib/local-account';
import { decodeJwt, stateFile } from '../lib/util';

const DETAIL = {
  email: 'The e-mail address of the signed-in account is not the invited address',
  idp: "The account did not sign in through the organization's identity provider",
  schac: 'The identity provider did not assert the home organization of the invitation',
};

let urv: ReferenceOrganization;

test.beforeAll(async () => {
  urv = await organization('urv');
  expect(urv.idp_alias, 'IdP urv enabled in the realm (OECP_DEV_IDP_ENABLED=true)').toBe('urv');
});

/**
 * Invites `invitee` to `urv`, opens the link (without `&idp=urv` when `stripIdp`),
 * signs in with `signIn`, and returns the POST /invitations/accept response and
 * the token's claims. The invitation is revoked in any case.
 */
async function acceptAttempt(
  browser: Browser,
  invitee: string,
  signIn: (page: Page) => Promise<void>,
  stripIdp = false,
) {
  const token = await allianceToken(browser);
  const inv = await invite(token, {
    email: invitee,
    role: 'partner_admin',
    organizationId: urv.id,
  });
  const ctx = await newContext(browser);
  try {
    const page = await ctx.newPage();
    const api = watchAdminApi(page);
    await page.goto(stripIdp ? inv.link.replace(/&idp=[^&]*/, '') : inv.link, {
      waitUntil: 'networkidle',
    });
    await signIn(page);
    await page.waitForURL(/\/en\/admin\/accept/, { timeout: 30000 });
    const accept = await until(() => api.accept);
    return { accept, claims: decodeJwt(await until(() => api.token)) };
  } finally {
    await ctx.close();
    await revokePendingInvitations(await allianceToken(browser), invitee);
  }
}

/** "Sign in through your university", IdP login, post-broker TOTP enrolment. */
const brokeredSignIn = (user: IdpUser) => async (page: Page) => {
  await page.getByRole('button', { name: 'Sign in through your university' }).click();
  await idpLogin(page, user);
  expect(await keycloakSecondFactor(page, user.mail, stateFile(user.mail, 'totp'))).toEqual([
    'totp-enrolment',
  ]);
};

test('e-mail mismatch: the IdP asserts another address than the invited one → 403', async ({
  browser,
}) => {
  const user = idpUser('partner.admin');
  const invitee = `someone.else.${RUN_ID}@e2e.example`;
  await deleteUserByEmail(user.mail);
  try {
    const { accept, claims } = await acceptAttempt(browser, invitee, brokeredSignIn(user));
    expect(claims).toMatchObject({ idp: 'urv', email: user.mail, acr: 'mfa' });
    expect(accept.status).toBe(403);
    expect(problemCodes(accept.body)).toEqual(['oecp.invitation.mismatch']);
    expect(accept.body.detail).toBe(DETAIL.email);
  } finally {
    await deleteUserByEmail(user.mail);
  }
});

test('idp mismatch: local sign-in on an invitation to a brokered organization → 403', async ({
  browser,
}) => {
  const creds = await allianceCredentials(browser);
  const { accept, claims } = await acceptAttempt(
    browser,
    creds.email,
    async (page) => {
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL((u) => u.href.startsWith(AUTH));
      expect(page.url()).not.toContain('kc_idp_hint');
      await localLogin(page, creds);
    },
    true,
  );
  expect(claims.idp).toBeUndefined();
  expect(claims.email).toBe(creds.email);
  expect(accept.status).toBe(403);
  expect(problemCodes(accept.body)).toEqual(['oecp.invitation.mismatch']);
  expect(accept.body.detail).toBe(DETAIL.idp);
});

test('schacHomeOrganization mismatch: the IdP asserts example.edu, not urv.cat → 403', async ({
  browser,
}) => {
  const user = idpUser('visiting.scholar');
  expect(user.schac).not.toBe('urv.cat');
  await deleteUserByEmail(user.mail);
  try {
    const { accept, claims } = await acceptAttempt(browser, user.mail, brokeredSignIn(user));
    expect(claims).toMatchObject({ idp: 'urv', email: user.mail, acr: 'mfa' });
    expect(accept.status).toBe(403);
    expect(problemCodes(accept.body)).toEqual(['oecp.invitation.mismatch']);
    expect(accept.body.detail).toBe(DETAIL.schac);
  } finally {
    await deleteUserByEmail(user.mail);
  }
});

test('no account linking: an IdP login with the e-mail of a local account is refused', async ({
  browser,
}) => {
  const user = idpUser('email.collision');
  // The test IdP asserts the dev alliance admin's address. On a stack without
  // that account (CI), a plain local account with that address stands in.
  expect(user.mail).toBe(DEV_ALLIANCE_EMAIL);
  let local = await findUserByEmail(user.mail);
  let createdHere = false;
  if (!local) {
    const res = await keycloakAdmin('POST', '/users', {
      username: user.mail,
      email: user.mail,
      emailVerified: true,
      enabled: true,
    });
    expect(res.status).toBe(201);
    createdHere = true;
    local = await findUserByEmail(user.mail);
  }
  try {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto(`${PORTAL}/en/admin`, { waitUntil: 'networkidle' });
    await page.getByLabel('Your university', { exact: true }).selectOption('urv');
    await page.getByRole('button', { name: 'Continue to your university' }).click();
    expect((await idpLogin(page, user)).idpVisited).toBe(true);
    await page.waitForLoadState('networkidle');
    expect(page.url().startsWith(AUTH), 'stopped at Keycloak, not back at the portal').toBe(true);
    await expect(page.locator('body')).toContainText(/already exists/i);
    await ctx.close();

    const fed = await keycloakAdmin<{ identityProvider: string }[]>(
      'GET',
      `/users/${local?.id}/federated-identity`,
    );
    expect(fed.body).toEqual([]);
    const brokered = await keycloakAdmin<unknown[]>(
      'GET',
      `/users?username=${encodeURIComponent(user.subjectId)}&exact=true`,
    );
    expect(brokered.body).toEqual([]);
  } finally {
    if (createdHere) await deleteUserByEmail(user.mail);
  }
});
