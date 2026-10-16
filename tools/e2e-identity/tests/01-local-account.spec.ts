// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
/**
 * Local accounts (spec §2.1): the bootstrap of the first alliance admin on an
 * empty stack, and an administrator of an organization without an IdP invited
 * through the admin API. Both go through Keycloak's set-up e-mail (password and
 * TOTP), the invitation link, PKCE sign-in with acr=mfa, acceptance, and a
 * second sign-in with a fresh OTP code that yields the role.
 */
import { expect, test } from '@playwright/test';
import {
  adminApi,
  invite,
  listAdmins,
  organization,
  revokeAdminByEmail,
  revokePendingInvitations,
} from '../lib/api';
import { RUN_ID } from '../lib/config';
import { deleteUserByEmail, findUserByEmail, usersWithRole } from '../lib/keycloak';
import {
  acceptAsLocalAccount,
  allianceToken,
  bootstrapAllianceAdmin,
  completeSetupMail,
  knownAllianceCredentials,
  newLocalCredentials,
} from '../lib/local-account';

test.describe.configure({ mode: 'serial' });

test('bootstrap of the first alliance admin, set-up e-mail, accept, sign in again', async ({
  browser,
}) => {
  const holders = await usersWithRole('alliance_admin');
  if (process.env.OECP_E2E_REQUIRE_BOOTSTRAP === 'true') {
    expect(holders, 'OECP_E2E_REQUIRE_BOOTSTRAP: the stack must have no alliance admin').toBe(0);
  }
  test.skip(
    holders > 0,
    `${holders} alliance admin(s) exist: bootstrap-alliance-admin is not run (it would refuse)`,
  );
  expect(
    knownAllianceCredentials(),
    'stale alliance admin credentials in the state directory',
  ).toBeUndefined();

  const aurora = await organization('aurora');
  const result = await bootstrapAllianceAdmin(browser);

  expect(result.cli.code).toBe(0);
  expect(result.link).toMatch(/^https:\/\/\S+\/en\/admin\/accept#token=[^&\s]+$/);
  expect(result.cli.stderr).toContain('Keycloak local user created.');
  expect(result.cli.stderr).toContain('Keycloak e-mailed the set-password and TOTP link.');
  expect(result.setup.sort()).toEqual(['password', 'totp']);

  const { firstClaims, accept, finalClaims, me, secondLogin } = result.onboarding;
  expect(firstClaims.acr).toBe('mfa');
  expect(firstClaims.idp).toBeUndefined();
  expect(firstClaims.email).toBe(result.creds.email);
  expect(accept.status).toBe(200);
  expect(accept.body).toMatchObject({ role: 'alliance_admin', org_id: aurora.id });
  expect(secondLogin).toEqual(['otp']);
  expect(finalClaims.acr).toBe('mfa');
  expect(finalClaims.roles).toEqual(['alliance_admin']);
  expect(finalClaims.org_id).toBe(aurora.id);
  expect(me).toMatchObject({
    email: result.creds.email,
    roles: ['alliance_admin'],
    org_id: aurora.id,
    idp: 'local',
  });
  expect(await usersWithRole('alliance_admin')).toBe(1);
});

test('local account invited by the alliance admin: set-up e-mail, accept, sign in again', async ({
  browser,
}) => {
  const email = `local.${RUN_ID}@e2e.example`;
  const aurora = await organization('aurora');
  expect(aurora.idp_alias).toBeNull();
  const token = await allianceToken(browser);

  try {
    const since = Date.now();
    const inv = await invite(token, {
      email,
      role: 'alliance_admin',
      organizationId: aurora.id,
    });
    expect(inv.status).toBe(201);
    expect(inv.invitation).toMatchObject({ email, role: 'alliance_admin', status: 'pending' });
    expect(inv.link).toMatch(/\/en\/admin\/accept#token=[^&\s]+$/);

    // The api created the Keycloak user with both required actions and asked
    // Keycloak to e-mail the set-up link.
    const created = await findUserByEmail(email);
    expect(created?.requiredActions?.sort()).toEqual(['CONFIGURE_TOTP', 'UPDATE_PASSWORD']);
    const creds = newLocalCredentials(email);
    expect((await completeSetupMail(browser, creds, since)).sort()).toEqual(['password', 'totp']);
    expect((await findUserByEmail(email))?.requiredActions ?? []).toEqual([]);

    const r = await acceptAsLocalAccount(browser, inv.link, creds);
    expect(r.firstClaims.acr).toBe('mfa');
    expect(r.firstClaims.roles ?? []).toEqual([]);
    expect(r.accept.status).toBe(200);
    expect(r.accept.body).toMatchObject({ role: 'alliance_admin', org_id: aurora.id });
    expect(r.finalClaims).toMatchObject({
      acr: 'mfa',
      roles: ['alliance_admin'],
      org_id: aurora.id,
    });
    expect(r.me).toMatchObject({
      email,
      roles: ['alliance_admin'],
      org_id: aurora.id,
      idp: 'local',
    });

    const listed = (await listAdmins(await allianceToken(browser), aurora.id)).find(
      (a) => a.email === email,
    );
    expect(listed).toMatchObject({ idp: 'local', roles: ['alliance_admin'] });
    const invitations = await adminApi<{ items: { id: string; status: string }[] }>(
      await allianceToken(browser),
      'GET',
      '/invitations',
    );
    expect(invitations.body.items.find((i) => i.id === inv.invitation.id)?.status).toBe('accepted');
  } finally {
    const t = await allianceToken(browser);
    await revokePendingInvitations(t, email);
    await revokeAdminByEmail(t, aurora.id, email);
    await deleteUserByEmail(email);
  }
  expect(await findUserByEmail(email)).toBeUndefined();
});
