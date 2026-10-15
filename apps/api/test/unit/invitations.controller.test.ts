// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminController } from '../../src/admin/admin.controller.js';
import { AdminJwtGuard } from '../../src/admin/auth/admin-jwt.guard.js';
import { AdminTokenVerifier } from '../../src/admin/auth/admin-token-verifier.js';
import {
  ORGANIZATION_DIRECTORY,
  type OrganizationDirectory,
} from '../../src/admin/auth/organization-directory.js';
import { generateInvitationToken } from '../../src/admin/invitations/invitation-token.js';
import { InvitationsController } from '../../src/admin/invitations/invitations.controller.js';
import {
  INVITATIONS_OPTIONS,
  InvitationsService,
} from '../../src/admin/invitations/invitations.service.js';
import { MAILER, type MailerPort } from '../../src/admin/invitations/mailer.js';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import { KYSELY } from '../../src/db/db.module.js';
import { KeycloakAdminError } from '../../src/identity/keycloak-admin.error.js';
import { KeycloakAdminService } from '../../src/identity/keycloak-admin.service.js';
import { BASE_CLAIMS, createTestTokens, type TestTokens } from '../support/admin-tokens.js';
import {
  createFakeDb,
  type FakeDb,
  insertedValues,
  type RecordedQuery,
} from '../support/fake-kysely.js';

const NOW = new Date('2026-10-14T12:00:00Z');
const SUB = '5f0c2a47-1b7e-4d1e-9b0a-6f6e2b1d9c3a';
const URV = '0b8f6c1e-6a3d-4c55-9a43-0f3d3c2b9a10';
const AURORA = '1c9f6c1e-6a3d-4c55-9a43-0f3d3c2b9a11';
const INVITATION_ID = '7a1e6c1e-6a3d-4c55-9a43-0f3d3c2b9a13';

interface OrgRow {
  id: string;
  slug: string;
  name: { en: string };
  keycloak_idp_alias: string | null;
  schac_home_organization: string | null;
  deleted_at: Date | null;
}

const organizations: Record<string, OrgRow> = {
  [URV]: {
    id: URV,
    slug: 'urv',
    name: { en: 'Rovira i Virgili University' },
    keycloak_idp_alias: 'urv',
    schac_home_organization: 'urv.cat',
    deleted_at: null,
  },
  [AURORA]: {
    id: AURORA,
    slug: 'aurora',
    name: { en: 'Aurora' },
    keycloak_idp_alias: null,
    schac_home_organization: 'aurora-universities.eu',
    deleted_at: null,
  },
};

const directory: OrganizationDirectory = {
  findActive: async (id) => organizations[id],
};

type InvitationRow = Record<string, unknown> & { token_sha256: Buffer };

describe('InvitationsController', () => {
  let app: INestApplication;
  let tokens: TestTokens;
  let invitation: InvitationRow | undefined;
  let token: string;
  const keycloak = {
    getUser: vi.fn(),
    findUserByEmail: vi.fn(),
    createLocalUser: vi.fn(),
    sendExecuteActionsEmail: vi.fn(),
    setUserAttribute: vi.fn(),
    addRealmRole: vi.fn(),
    getIdentityProvider: vi.fn(),
  };
  const mailer = { send: vi.fn<MailerPort['send']>() };

  /** Scripted database: the one invitation, the two organizations, writes recorded. */
  function respond(query: RecordedQuery): unknown[] | undefined {
    const { sql, parameters } = query;
    if (sql.startsWith('select') && sql.includes('from "admin_invitations"')) {
      if (!invitation) return [];
      if (sql.includes('"token_sha256" = $1')) {
        return (parameters[0] as Buffer).equals(invitation.token_sha256) ? [invitation] : [];
      }
      if (sql.includes('"id" = $1')) return parameters[0] === invitation['id'] ? [invitation] : [];
      return [invitation];
    }
    if (sql.startsWith('select') && sql.includes('from "organizations"')) {
      const org = organizations[parameters[0] as string];
      return org ? [org] : [];
    }
    if (sql.startsWith('insert into "admin_invitations"')) {
      return [
        {
          id: INVITATION_ID,
          created_at: NOW,
          accepted_at: null,
          accepted_sub: null,
          revoked_at: null,
          ...insertedValues(query),
        },
      ];
    }
    return undefined;
  }

  const fake: FakeDb = createFakeDb((q) => respond(q));
  const writes = () =>
    fake.queries
      .filter((q) => /^(insert|update|delete)/.test(q.sql))
      .map((q) => /^(insert into|update|delete from) "\w+"/.exec(q.sql)![0]);

  beforeAll(async () => {
    tokens = await createTestTokens();
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController, InvitationsController],
      providers: [
        InvitationsService,
        AdminJwtGuard,
        { provide: AdminTokenVerifier, useValue: tokens.verifier },
        { provide: ORGANIZATION_DIRECTORY, useValue: directory },
        { provide: KYSELY, useValue: fake.db },
        { provide: KeycloakAdminService, useValue: keycloak },
        { provide: MAILER, useValue: mailer },
        {
          provide: INVITATIONS_OPTIONS,
          useValue: { publicBaseUrl: 'https://campus.example.org', now: () => NOW },
        },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    keycloak.getIdentityProvider.mockResolvedValue({ alias: 'urv', enabled: true });
    fake.queries.length = 0;
    fake.events.length = 0;
    const generated = generateInvitationToken();
    token = generated.token;
    invitation = {
      id: INVITATION_ID,
      email: 'admin@urv.cat',
      role: 'partner_admin',
      organization_id: URV,
      token_sha256: generated.sha256,
      invited_by: 'kc-alliance-admin',
      expires_at: new Date('2026-10-21T12:00:00Z'),
      accepted_at: null,
      accepted_sub: null,
      revoked_at: null,
      created_at: new Date('2026-10-14T10:00:00Z'),
    };
    keycloak.getUser.mockResolvedValue({ id: SUB, attributes: {} });
  });

  const roleless = { ...BASE_CLAIMS, roles: [], idp: 'urv', email: 'admin@urv.cat' };
  const accept = async (claims: Record<string, unknown>, body: unknown = { token }) =>
    request(app.getHttpServer())
      .post('/api/admin/v1/invitations/accept')
      .set('authorization', `Bearer ${await tokens.sign(claims)}`)
      .send(body as object);
  const errorCode = (body: { errors?: { code: string }[] }) => body.errors?.[0]?.code;

  describe('POST /invitations/accept', () => {
    it('accepts a brokered invitation with a role-less token', async () => {
      const response = await accept({ ...roleless, schac_home_organization: 'urv.cat' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ role: 'partner_admin', org_id: URV, relogin_required: true });
      expect(keycloak.setUserAttribute).toHaveBeenCalledWith(SUB, 'oecp_org_id', URV);
      expect(keycloak.addRealmRole).toHaveBeenCalledWith(SUB, 'partner_admin');
      expect(keycloak.getUser).not.toHaveBeenCalled(); // claim present
      expect(writes()).toEqual(['update "admin_invitations"', 'insert into "audit_log"']);
      const update = fake.queries.find((q) => q.sql.startsWith('update'))!;
      expect(update.parameters).toEqual([NOW, SUB, INVITATION_ID]);
      const audit = insertedValues(fake.queries.find((q) => q.sql.startsWith('insert'))!);
      expect(audit).toMatchObject({
        actor_sub: SUB,
        actor_org_id: URV,
        action: 'invitation.accept',
        entity_type: 'admin_invitation',
        entity_id: INVITATION_ID,
      });
      expect(fake.events.at(0)).toBe('begin');
      expect(fake.events.at(-1)).toBe('commit');
      const select = fake.queries[0]!;
      expect(select.sql).toContain('for update');
    });

    it('reads schacHomeOrganization from the Keycloak user when the token lacks the claim', async () => {
      keycloak.getUser.mockResolvedValue({
        id: SUB,
        attributes: { schacHomeOrganization: ['URV.cat'] },
      });
      const response = await accept(roleless);
      expect(response.status).toBe(200);
      expect(keycloak.getUser).toHaveBeenCalledWith(SUB);
    });

    it('rejects a wrong or missing schacHomeOrganization with 403 and writes nothing', async () => {
      const response = await accept({ ...roleless, schac_home_organization: 'rovira.example' });
      expect(response.status).toBe(403);
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(errorCode(response.body)).toBe('oecp.invitation.mismatch');
      expect(response.body.reason).toBe('home_organization');
      expect((await accept(roleless)).status).toBe(403); // no claim, no attribute
      expect(keycloak.addRealmRole).not.toHaveBeenCalled();
      expect(writes()).toEqual([]);
      expect(fake.events).toContain('rollback');
    });

    it('accepts a local-user invitation when the token has no idp claim', async () => {
      invitation = {
        ...invitation!,
        email: 'chair@aurora.example',
        role: 'alliance_admin',
        organization_id: AURORA,
      };
      const response = await accept({ ...BASE_CLAIMS, roles: [], email: 'Chair@Aurora.example' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        role: 'alliance_admin',
        org_id: AURORA,
        relogin_required: true,
      });
      expect(keycloak.getUser).not.toHaveBeenCalled(); // no schac check for local users
      expect(keycloak.addRealmRole).toHaveBeenCalledWith(SUB, 'alliance_admin');
    });

    it.each([
      [
        'an e-mail mismatch',
        { ...roleless, email: 'other@urv.cat' },
        403,
        'oecp.invitation.mismatch',
        'email',
      ],
      ['an IdP mismatch', { ...roleless, idp: 'uibk' }, 403, 'oecp.invitation.mismatch', 'idp'],
      [
        'a local login for a brokered organization',
        { ...roleless, idp: undefined },
        403,
        'oecp.invitation.mismatch',
        'idp',
      ],
    ])('rejects %s (extension member reason)', async (_label, claims, status, code, reason) => {
      const response = await accept(claims);
      expect(response.status).toBe(status);
      expect(errorCode(response.body)).toBe(code);
      // RFC 9457 extension member next to the standard ones.
      expect(response.body).toMatchObject({ status, reason, type: 'about:blank' });
      expect(keycloak.setUserAttribute).not.toHaveBeenCalled();
    });

    it.each([
      ['expired', { expires_at: new Date('2026-10-14T11:00:00Z') }, 410, 'oecp.invitation.expired'],
      ['revoked', { revoked_at: new Date('2026-10-14T11:00:00Z') }, 409, 'oecp.invitation.invalid'],
      [
        'accepted',
        { accepted_at: new Date('2026-10-14T11:00:00Z') },
        409,
        'oecp.invitation.invalid',
      ],
    ])('rejects an %s invitation', async (_label, patch, status, code) => {
      invitation = { ...invitation!, ...patch };
      const response = await accept(roleless);
      expect(response.status).toBe(status);
      expect(errorCode(response.body)).toBe(code);
      expect(response.body).not.toHaveProperty('reason');
      expect(writes()).toEqual([]);
    });

    it('rejects an unknown token with 404', async () => {
      const response = await accept(roleless, { token: generateInvitationToken().token });
      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('oecp.invitation.invalid');
    });

    it('validates the body', async () => {
      const response = await accept(roleless, { token: 'short' });
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('oecp.request.validation_failed');
    });

    it('requires a bearer token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/admin/v1/invitations/accept')
        .send({ token });
      expect(response.status).toBe(401);
    });

    it('rolls back when Keycloak fails, leaving the invitation usable', async () => {
      keycloak.addRealmRole.mockRejectedValue(new KeycloakAdminError('add realm role', 500));
      const response = await accept({ ...roleless, schac_home_organization: 'urv.cat' });
      expect(response.status).toBe(502);
      expect(errorCode(response.body)).toBe('oecp.identity.unavailable');
      expect(writes()).toEqual([]);
      expect(fake.events.at(-1)).toBe('rollback');
    });
  });

  describe('GET /me', () => {
    it('returns the principal of a role-less token, idp defaulting to local', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/admin/v1/me')
        .set(
          'authorization',
          `Bearer ${await tokens.sign({ ...BASE_CLAIMS, email: 'a@aurora.example', name: 'A B' })}`,
        );
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        sub: SUB,
        email: 'a@aurora.example',
        name: 'A B',
        roles: [],
        org_id: null,
        idp: 'local',
      });
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/api/admin/v1/me').expect(401);
    });
  });

  describe('alliance_admin endpoints', () => {
    const allianceAdmin = {
      ...BASE_CLAIMS,
      roles: ['alliance_admin'],
      org_id: AURORA,
      email: 'chair@aurora.example',
    };
    const partnerAdmin = { ...BASE_CLAIMS, roles: ['partner_admin'], org_id: URV, idp: 'urv' };
    const as = async (claims: Record<string, unknown>) => `Bearer ${await tokens.sign(claims)}`;

    it('creates an invitation, stores only the token hash and e-mails the link', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/admin/v1/invitations')
        .set('authorization', await as(allianceAdmin))
        .send({ email: 'New.Admin@URV.cat', role: 'partner_admin', organization_id: URV });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        id: INVITATION_ID,
        email: 'new.admin@urv.cat',
        role: 'partner_admin',
        organization_id: URV,
        status: 'pending',
        expires_at: '2026-10-21T12:00:00.000Z',
      });
      expect(JSON.stringify(response.body)).not.toMatch(/token/);
      const insert = insertedValues(
        fake.queries.find((q) => q.sql.startsWith('insert into "admin_invitations"'))!,
      );
      expect(insert['token_sha256']).toBeInstanceOf(Buffer);
      expect((insert['token_sha256'] as Buffer).length).toBe(32);
      expect(insert['invited_by']).toBe(SUB);
      const mail = mailer.send.mock.calls[0]![0];
      expect(mail.to).toBe('new.admin@urv.cat');
      expect(mail.text).toMatch(
        /https:\/\/campus\.example\.org\/en\/admin\/accept#token=[A-Za-z0-9_-]{43}/,
      );
      expect(keycloak.createLocalUser).not.toHaveBeenCalled(); // brokered organization
    });

    it('forbids partner_admin from creating or revoking invitations', async () => {
      const create = await request(app.getHttpServer())
        .post('/api/admin/v1/invitations')
        .set('authorization', await as(partnerAdmin))
        .send({ email: 'x@urv.cat', role: 'partner_admin', organization_id: URV });
      expect(create.status).toBe(403);
      expect(errorCode(create.body)).toBe('oecp.auth.forbidden_role');
      const revoke = await request(app.getHttpServer())
        .delete(`/api/admin/v1/invitations/${INVITATION_ID}`)
        .set('authorization', await as(partnerAdmin));
      expect(revoke.status).toBe(403);
    });

    it('lists every invitation for alliance_admin and only its own for partner_admin', async () => {
      const all = await request(app.getHttpServer())
        .get('/api/admin/v1/invitations')
        .set('authorization', await as(allianceAdmin));
      expect(all.status).toBe(200);
      expect(all.body.items).toHaveLength(1);
      expect(fake.queries.at(-1)!.sql).not.toContain('"organization_id" =');

      const own = await request(app.getHttpServer())
        .get('/api/admin/v1/invitations')
        .set('authorization', await as(partnerAdmin));
      expect(own.status).toBe(200);
      const last = fake.queries.at(-1)!;
      expect(last.sql).toContain('"organization_id" = $1');
      expect(last.parameters[0]).toBe(URV);
    });

    it('revokes a pending invitation and audits it', async () => {
      await request(app.getHttpServer())
        .delete(`/api/admin/v1/invitations/${INVITATION_ID}`)
        .set('authorization', await as(allianceAdmin))
        .expect(204);
      expect(writes()).toEqual(['update "admin_invitations"', 'insert into "audit_log"']);
    });

    it('refuses to revoke an accepted invitation', async () => {
      invitation = { ...invitation!, accepted_at: new Date('2026-10-14T11:00:00Z') };
      const response = await request(app.getHttpServer())
        .delete(`/api/admin/v1/invitations/${INVITATION_ID}`)
        .set('authorization', await as(allianceAdmin));
      expect(response.status).toBe(409);
    });
  });
});
