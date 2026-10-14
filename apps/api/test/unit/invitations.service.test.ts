// SPDX-License-Identifier: EUPL-1.2
import { Logger } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashInvitationToken } from '../../src/admin/invitations/invitation-token.js';
import { InvitationsService } from '../../src/admin/invitations/invitations.service.js';
import type { MailerPort } from '../../src/admin/invitations/mailer.js';
import { KeycloakAdminError } from '../../src/identity/keycloak-admin.error.js';
import type { KeycloakAdminService } from '../../src/identity/keycloak-admin.service.js';
import { createFakeDb, type FakeDb, insertedValues } from '../support/fake-kysely.js';

const NOW = new Date('2026-10-14T12:00:00Z');
const AURORA = '1c9f6c1e-6a3d-4c55-9a43-0f3d3c2b9a11';
const URV = '0b8f6c1e-6a3d-4c55-9a43-0f3d3c2b9a10';
const KC_USER = '9d0c2a47-1b7e-4d1e-9b0a-6f6e2b1d9c3b';

const orgs: Record<string, object> = {
  [AURORA]: {
    id: AURORA,
    slug: 'aurora',
    name: { en: 'Aurora' },
    keycloak_idp_alias: null,
    schac_home_organization: 'aurora-universities.eu',
    deleted_at: null,
  },
  [URV]: {
    id: URV,
    slug: 'urv',
    name: { en: 'URV' },
    keycloak_idp_alias: 'urv',
    schac_home_organization: 'urv.cat',
    deleted_at: null,
  },
};

describe('InvitationsService', () => {
  let fake: FakeDb;
  let keycloak: Record<string, ReturnType<typeof vi.fn>>;
  let mailer: { send: ReturnType<typeof vi.fn> };
  let service: InvitationsService;
  let pendingRows: unknown[];

  beforeAll(() => Logger.overrideLogger(false));

  beforeEach(() => {
    pendingRows = [];
    fake = createFakeDb((q) => {
      if (q.sql.startsWith('select') && q.sql.includes('from "organizations"')) {
        const org = orgs[q.parameters[0] as string];
        return org ? [org] : [];
      }
      if (q.sql.startsWith('select') && q.sql.includes('from "admin_invitations"')) {
        return pendingRows;
      }
      if (q.sql.startsWith('insert into "admin_invitations"')) {
        return [{ id: 'inv-1', created_at: NOW, ...insertedValues(q) }];
      }
      return undefined;
    });
    keycloak = {
      findUserByEmail: vi.fn().mockResolvedValue(undefined),
      createLocalUser: vi.fn().mockResolvedValue(KC_USER),
      sendExecuteActionsEmail: vi.fn().mockResolvedValue(undefined),
    };
    mailer = { send: vi.fn().mockResolvedValue(undefined) };
    service = new InvitationsService(
      fake.db,
      keycloak as unknown as KeycloakAdminService,
      mailer as unknown as MailerPort,
      { publicBaseUrl: 'https://campus.example.org/', now: () => NOW },
    );
  });

  const base = {
    email: 'Chair@Aurora.example',
    role: 'alliance_admin' as const,
    organizationId: AURORA,
    invitedBy: 'system:bootstrap',
    ttlHours: 24,
  };

  it('creates a local Keycloak user with required actions for an organization without IdP', async () => {
    const result = await service.create(base);
    expect(keycloak['createLocalUser']).toHaveBeenCalledWith({
      email: 'chair@aurora.example',
      requiredActions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
    });
    expect(keycloak['sendExecuteActionsEmail']).toHaveBeenCalledWith(
      KC_USER,
      ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'],
      { redirectUri: 'https://campus.example.org/en/admin/', lifespanSeconds: 86_400 },
    );
    expect(result.localUser).toEqual({ id: KC_USER, created: true, actionsEmailSent: true });
    expect(result.link).toBe(`https://campus.example.org/en/admin/accept#token=${result.token}`);

    const stored = insertedValues(
      fake.queries.find((q) => q.sql.startsWith('insert into "admin_invitations"'))!,
    );
    expect(stored).toMatchObject({
      email: 'chair@aurora.example',
      role: 'alliance_admin',
      organization_id: AURORA,
      invited_by: 'system:bootstrap',
      expires_at: new Date('2026-10-15T12:00:00Z'),
    });
    expect((stored['token_sha256'] as Buffer).equals(hashInvitationToken(result.token))).toBe(true);
    expect(fake.queries.some((q) => q.parameters.includes(result.token))).toBe(false);
    expect(fake.events).toEqual(['query', 'begin', 'query', 'query', 'commit']);
  });

  it('does not touch Keycloak for an organization with an IdP alias', async () => {
    const result = await service.create({ ...base, role: 'partner_admin', organizationId: URV });
    expect(result.localUser).toBeUndefined();
    expect(keycloak['findUserByEmail']).not.toHaveBeenCalled();
    expect(keycloak['createLocalUser']).not.toHaveBeenCalled();
    expect(mailer.send).toHaveBeenCalledOnce();
  });

  it('reuses an existing local user and re-sends only pending actions', async () => {
    keycloak['findUserByEmail']!.mockResolvedValue({
      id: KC_USER,
      requiredActions: ['CONFIGURE_TOTP'],
    });
    const result = await service.create(base);
    expect(keycloak['createLocalUser']).not.toHaveBeenCalled();
    expect(keycloak['sendExecuteActionsEmail']).toHaveBeenCalledWith(
      KC_USER,
      ['CONFIGURE_TOTP'],
      expect.anything(),
    );
    expect(result.localUser).toEqual({ id: KC_USER, created: false, actionsEmailSent: true });
  });

  it('keeps the invitation when Keycloak cannot send the execute-actions e-mail', async () => {
    keycloak['sendExecuteActionsEmail']!.mockRejectedValue(new KeycloakAdminError('send', 500));
    const result = await service.create(base);
    expect(result.localUser).toEqual({ id: KC_USER, created: true, actionsEmailSent: false });
    expect(fake.events.at(-1)).toBe('commit');
  });

  it('does not e-mail the link when sendEmail is false (bootstrap CLI)', async () => {
    await service.create({ ...base, sendEmail: false });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('rolls back the invitation when the link e-mail fails', async () => {
    mailer.send.mockRejectedValue(new Error('connection refused'));
    await expect(service.create({ ...base, organizationId: URV })).rejects.toMatchObject({
      code: 'oecp.mail.unavailable',
    });
    expect(fake.events.at(-1)).toBe('rollback');
  });

  it('rejects unknown organizations with 404', async () => {
    await expect(
      service.create({ ...base, organizationId: '2d9f6c1e-6a3d-4c55-9a43-0f3d3c2b9a12' }),
    ).rejects.toMatchObject({ code: 'oecp.request.not_found' });
  });

  it('finds pending invitations of a role (unexpired, unaccepted, unrevoked)', async () => {
    await expect(service.hasPendingInvitation('alliance_admin')).resolves.toBe(false);
    pendingRows = [{ id: 'inv-1' }];
    await expect(service.hasPendingInvitation('alliance_admin')).resolves.toBe(true);
    const query = fake.queries.at(-1)!;
    expect(query.sql).toContain('"accepted_at" is null');
    expect(query.sql).toContain('"revoked_at" is null');
    expect(query.sql).toContain('"expires_at" > $2');
    expect(query.parameters).toEqual(['alliance_admin', NOW, 1]);
  });
});
