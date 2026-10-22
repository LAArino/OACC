// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { FakeKeycloak } from '../support/fake-keycloak.js';

const ORG = '0a000000-0000-4000-8000-000000000002';

function seed(fake: FakeKeycloak) {
  fake.addUser({ id: 'u1', email: 'a@x.example', roles: new Set(['partner_admin']) });
  fake.addUser({ id: 'u2', email: 'b@x.example', roles: new Set(['alliance_admin']) });
  fake.addUser({
    id: 'u3',
    email: 'c@x.example',
    roles: new Set(['partner_admin', 'default-roles-oecp']),
    attributes: { oecp_org_id: [ORG] },
  });
  fake.addUser({ id: 'u4', email: 'd@x.example' });
}

describe('KeycloakAdminService role members and revocation', () => {
  it('lists role members with GET /roles/{name}/users when view-realm is granted', async () => {
    const fake = new FakeKeycloak();
    fake.roleMembersReadable = true;
    seed(fake);
    const users = await fake.service().usersWithRealmRole('partner_admin');
    expect(users.map((u) => u.id).sort()).toEqual(['u1', 'u3']);
    expect(users.find((u) => u.id === 'u3')?.attributes).toEqual({ oecp_org_id: [ORG] });
    expect(fake.callsTo('GET', /^\/users\/[^/]+\/role-mappings/)).toHaveLength(0);
  });

  it('falls back to scanning role mappings without view-realm (403)', async () => {
    const fake = new FakeKeycloak();
    seed(fake);
    const users = await fake.service().usersWithRealmRole('alliance_admin');
    expect(users.map((u) => u.id)).toEqual(['u2']);
    expect(typeof users[0]?.createdTimestamp).toBe('number');
  });

  it('revokes OACC access: roles, oecp_org_id and every session', async () => {
    const fake = new FakeKeycloak();
    seed(fake);
    await fake.service().revokeOecpAccess('u3', ['partner_admin']);
    const user = fake.users.get('u3');
    expect([...(user?.roles ?? [])]).toEqual(['default-roles-oecp']);
    expect(user?.attributes['oecp_org_id']).toBeUndefined();
    expect(fake.loggedOut).toEqual(['u3']);
  });
});
