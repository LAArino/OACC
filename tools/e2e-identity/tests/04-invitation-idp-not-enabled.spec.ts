// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
/**
 * An invitation to an organization whose IdP alias names no identity provider
 * of the realm is refused (409 `oecp.invitation.idp_not_enabled`): its link
 * would hint an IdP Keycloak cannot route to. Nothing is created or sent.
 */
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { adminApi, organization, problemCodes, revokePendingInvitations } from '../lib/api';
import { ORGANIZATIONS_SEED, RUN_ID, UNROUTED_ORG } from '../lib/config';
import { findUserByEmail, keycloakAdmin } from '../lib/keycloak';
import { mailsTo } from '../lib/mailpit';
import { allianceToken } from '../lib/local-account';

test(`invitation to ${UNROUTED_ORG} (alias without a realm IdP) → 409 idp_not_enabled`, async ({
  browser,
}) => {
  // Preconditions: the seed gives the organization an alias (so no local account
  // would be created), and the realm has no enabled IdP with that alias.
  const seed = JSON.parse(fs.readFileSync(ORGANIZATIONS_SEED, 'utf8')) as {
    organizations: { slug: string; keycloak_idp_alias: string | null }[];
  };
  const alias = seed.organizations.find((o) => o.slug === UNROUTED_ORG)?.keycloak_idp_alias;
  expect(alias, `${UNROUTED_ORG} has an IdP alias in the seed`).toBeTruthy();
  const realmIdp = await keycloakAdmin<{ enabled?: boolean }>(
    'GET',
    `/identity-provider/instances/${alias}`,
  );
  expect(realmIdp.status === 404 || realmIdp.body?.enabled === false).toBe(true);
  const org = await organization(UNROUTED_ORG);
  expect(org.idp_alias, 'the public reference publishes no alias').toBeNull();

  const email = `unrouted.${RUN_ID}@e2e.example`;
  const token = await allianceToken(browser);
  const since = Date.now();
  try {
    const res = await adminApi<{ detail?: string; extensions?: { idp_alias?: string } }>(
      token,
      'POST',
      '/invitations',
      { email, role: 'partner_admin', organization_id: org.id, ttl_hours: 24 },
    );
    expect(res.status).toBe(409);
    expect(problemCodes(res.body)).toEqual(['oecp.invitation.idp_not_enabled']);
    expect(res.body.detail).toContain(`"${alias}"`);

    const scoped = await adminApi(token, 'POST', `/organizations/${org.id}/invitations`, {
      email,
      role: 'partner_admin',
      ttl_hours: 24,
    });
    expect(scoped.status).toBe(409);
    expect(problemCodes(scoped.body)).toEqual(['oecp.invitation.idp_not_enabled']);

    const list = await adminApi<{ items: { email: string }[] }>(
      token,
      'GET',
      `/organizations/${org.id}/invitations`,
    );
    expect(list.body.items.filter((i) => i.email === email)).toEqual([]);
    expect(await findUserByEmail(email)).toBeUndefined();
    expect(await mailsTo(email, since)).toBe(0);
  } finally {
    // Only if the API wrongly created one.
    await revokePendingInvitations(token, email);
  }
});
