// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  adminOrganization,
  adminOrganizationList,
  invitation,
  invitationList,
  networkStatus,
  organizationAdminList,
} from '@oecp/schemas';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminJwtGuard } from '../../src/admin/auth/admin-jwt.guard.js';
import { AdminTokenVerifier } from '../../src/admin/auth/admin-token-verifier.js';
import {
  KyselyOrganizationDirectory,
  ORGANIZATION_DIRECTORY,
} from '../../src/admin/auth/organization-directory.js';
import { OrganizationAccess } from '../../src/admin/integrations/organization-access.js';
import { InvitationsController } from '../../src/admin/invitations/invitations.controller.js';
import {
  INVITATIONS_OPTIONS,
  InvitationsService,
} from '../../src/admin/invitations/invitations.service.js';
import { MAILER, type MailMessage } from '../../src/admin/invitations/mailer.js';
import { NetworkStatusController } from '../../src/admin/network/network-status.controller.js';
import { NetworkStatusService } from '../../src/admin/network/network-status.service.js';
import { OrganizationAdminsService } from '../../src/admin/organizations/organization-admins.service.js';
import { OrganizationsController } from '../../src/admin/organizations/organizations.controller.js';
import { OrganizationsService } from '../../src/admin/organizations/organizations.service.js';
import { ProblemDetailsFilter } from '../../src/common/problem-details.filter.js';
import { KYSELY } from '../../src/db/db.module.js';
import { KeycloakAdminService } from '../../src/identity/keycloak-admin.service.js';
import { OeapiClientFactory } from '../../src/ingestion/oeapi/oeapi-client.factory.js';
import { BASE_CLAIMS, createTestTokens } from '../support/admin-tokens.js';
import { FakeKeycloak } from '../support/fake-keycloak.js';
import {
  createTestDatabase,
  describeWithDatabase,
  ORG,
  type TestDatabase,
} from '../support/test-database.js';

const ALLIANCE_SUB = '22222222-2222-4222-8222-222222222222';
const ALLIANCE2_SUB = '23232323-2323-4323-8323-232323232323';
const UIBK_SUB = '44444444-4444-4444-8444-444444444444';
const URV_SUB = '33333333-3333-4333-8333-333333333333';
const FACULTY_SUB = '55555555-5555-4555-8555-555555555555';
const api = '/api/admin/v1';

const orgBody = (patch: Record<string, unknown> = {}) => ({
  slug: 'uva',
  org_type: 'institution',
  is_partner: true,
  name: { en: 'University of Amsterdam', nl: 'Universiteit van Amsterdam' },
  country_code: 'NL',
  schac_home_organization: 'uva.nl',
  keycloak_idp_alias: 'uva',
  contact_email: 'aurora@uva.example',
  default_timezone: 'Europe/Amsterdam',
  ui_languages: ['en', 'nl'],
  website_url: 'https://www.uva.example',
  ...patch,
});

describe.runIf(describeWithDatabase === 'run')('Organizations admin API (PostgreSQL)', () => {
  let tdb: TestDatabase;
  let app: INestApplication;
  const keycloak = new FakeKeycloak();
  const mail: MailMessage[] = [];
  let mailFails = false;
  const auth = { alliance: '', alliance2: '', uibk: '', urv: '', roleless: '' };
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(url).set('Authorization', token),
    post: (url: string, body?: object) => {
      const r = http().post(url).set('Authorization', token);
      return body ? r.send(body) : r;
    },
    put: (url: string, body: object) => http().put(url).set('Authorization', token).send(body),
    delete: (url: string) => http().delete(url).set('Authorization', token),
  });
  const code = (res: request.Response) =>
    (res.body as { errors?: { code: string }[] }).errors?.[0]?.code;
  const audit = (action: string) =>
    tdb.db
      .selectFrom('audit_log')
      .selectAll()
      .where('action', '=', action)
      .orderBy('id', 'desc')
      .execute();
  const orgRow = (id: string) =>
    tdb.db.selectFrom('organizations').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  beforeAll(async () => {
    Logger.overrideLogger(['error']);
    tdb = await createTestDatabase();
    const tokens = await createTestTokens();
    const moduleRef = await Test.createTestingModule({
      controllers: [OrganizationsController, NetworkStatusController, InvitationsController],
      providers: [
        { provide: KYSELY, useValue: tdb.db },
        { provide: AdminTokenVerifier, useValue: tokens.verifier },
        { provide: ORGANIZATION_DIRECTORY, useClass: KyselyOrganizationDirectory },
        { provide: KeycloakAdminService, useValue: keycloak.service() },
        { provide: INVITATIONS_OPTIONS, useValue: { publicBaseUrl: 'https://campus.example' } },
        {
          provide: MAILER,
          useValue: {
            send: async (message: MailMessage) => {
              if (mailFails) throw new Error('relay down');
              mail.push(message);
            },
          },
        },
        {
          provide: OeapiClientFactory,
          useValue: {
            settings: {
              gatewayUrl: 'https://gateway.example',
              surfeduhubSecretRef: undefined,
              allowInsecure: false,
            },
          },
        },
        AdminJwtGuard,
        OrganizationAccess,
        OrganizationsService,
        OrganizationAdminsService,
        NetworkStatusService,
        InvitationsService,
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const sign = async (sub: string, claims: Record<string, unknown>) =>
      `Bearer ${await tokens.sign({ ...BASE_CLAIMS, ...claims }, sub)}`;
    auth.alliance = await sign(ALLIANCE_SUB, { roles: ['alliance_admin'], org_id: ORG.aurora });
    auth.alliance2 = await sign(ALLIANCE2_SUB, { roles: ['alliance_admin'], org_id: ORG.aurora });
    auth.uibk = await sign(UIBK_SUB, { roles: ['partner_admin'], org_id: ORG.uibk, idp: 'uibk' });
    auth.urv = await sign(URV_SUB, { roles: ['partner_admin'], org_id: ORG.urv, idp: 'urv' });
    auth.roleless = await sign('66666666-6666-4666-8666-666666666666', {});

    keycloak.addUser({
      id: ALLIANCE_SUB,
      email: 'chair@aurora.example',
      firstName: 'Ada',
      lastName: 'Chair',
      attributes: { oecp_org_id: [ORG.aurora] },
      roles: new Set(['default-roles-oecp', 'alliance_admin']),
      lastLogin: Date.UTC(2026, 9, 10, 9, 0, 0),
    });
    keycloak.addUser({
      id: ALLIANCE2_SUB,
      email: 'office@aurora.example',
      attributes: { oecp_org_id: [ORG.aurora] },
      roles: new Set(['default-roles-oecp', 'alliance_admin']),
    });
    keycloak.addUser({
      id: UIBK_SUB,
      email: 'aurora@uibk.example',
      attributes: { oecp_org_id: [ORG.uibk] },
      roles: new Set(['default-roles-oecp', 'partner_admin']),
      idp: 'uibk',
    });
    keycloak.addUser({
      id: FACULTY_SUB,
      email: 'informatik@uibk.example',
      attributes: { oecp_org_id: [ORG.uibkFaculty] },
      roles: new Set(['default-roles-oecp', 'partner_admin']),
      requiredActions: ['CONFIGURE_TOTP'],
    });
    // A user of another organization and one without any OACC attribute.
    keycloak.addUser({
      id: URV_SUB,
      email: 'aurora@urv.example',
      attributes: { oecp_org_id: [ORG.urv] },
      idp: 'urv',
    });
    keycloak.addUser({ id: '77777777-7777-4777-8777-777777777777', email: 'student@example.org' });
    for (const alias of ['uibk', 'urv']) {
      keycloak.identityProviders.set(alias, { alias, enabled: true });
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await tdb?.drop();
  });

  beforeEach(() => {
    mail.length = 0;
    mailFails = false;
    keycloak.failWith = undefined;
    keycloak.eventsReadable = false;
  });

  describe('authentication and roles', () => {
    it.each([
      ['GET', `${api}/organizations`],
      ['POST', `${api}/organizations`],
      ['GET', `${api}/organizations/${ORG.uibk}`],
      ['GET', `${api}/organizations/${ORG.uibk}/admins`],
      ['DELETE', `${api}/organizations/${ORG.uibk}/admins/${UIBK_SUB}`],
      ['GET', `${api}/organizations/${ORG.uibk}/invitations`],
      ['POST', `${api}/organizations/${ORG.uibk}/invitations`],
      ['POST', `${api}/invitations/${ORG.uibk}/resend`],
      ['GET', `${api}/network-status`],
    ])('%s %s needs a bearer token', async (method, url) => {
      const res = await http()[method.toLowerCase() as 'get'](url).expect(401);
      expect(code(res)).toBe('oecp.auth.missing_token');
    });

    it('refuses role-less tokens and partner writes', async () => {
      expect(code(await as(auth.roleless).get(`${api}/organizations`).expect(403))).toBe(
        'oecp.auth.no_role',
      );
      expect(code(await as(auth.uibk).post(`${api}/organizations`, orgBody()).expect(403))).toBe(
        'oecp.auth.forbidden_role',
      );
      await as(auth.uibk).get(`${api}/network-status`).expect(403);
      await as(auth.uibk).post(`${api}/organizations/${ORG.uibk}/restore`).expect(403);
    });
  });

  describe('organizations', () => {
    it('lists every organization for the alliance, alliance first, with counts', async () => {
      await tdb.db.transaction().execute(async (trx) => {
        const course = await trx
          .insertInto('courses')
          .values({
            organization_id: ORG.uibk,
            ext_id: 'UIBK-1',
            source_channel: 'form',
            status: 'published',
            ects: 5,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('course_texts')
          .values({ course_id: course.id, lang: 'en', title: 'Alpine Ecology' })
          .execute();
        await trx
          .insertInto('courses')
          .values({ organization_id: ORG.uibk, ext_id: 'UIBK-2', source_channel: 'form', ects: 3 })
          .execute();
        await trx
          .insertInto('course_offerings')
          .values({
            course_id: course.id,
            ext_offering_id: 'UIBK-1-2099',
            source_channel: 'form',
            status: 'published',
            start_date: '2099-03-01',
            end_date: '2099-06-30',
            timezone: 'Europe/Vienna',
            teaching_languages: ['en'],
          })
          .execute();
      });
      const list = adminOrganizationList.parse(
        (await as(auth.alliance).get(`${api}/organizations`).expect(200)).body,
      );
      expect(list.items.map((o) => o.slug)).toEqual(['aurora', 'uibk', 'urv', 'uibk-informatik']);
      const uibk = list.items.find((o) => o.slug === 'uibk')!;
      expect(uibk).toMatchObject({
        id: ORG.uibk,
        is_partner: true,
        partner_id: ORG.uibk,
        keycloak_idp_alias: 'uibk',
        name: { en: 'University of Innsbruck', de: 'Universität Innsbruck' },
        ui_languages: ['en'],
        deleted_at: null,
        counts: { courses_total: 2, courses_published: 1, sub_units: 1 },
      });
    });

    it('limits a partner_admin to its organization and sub-units', async () => {
      const list = adminOrganizationList.parse(
        (await as(auth.uibk).get(`${api}/organizations`).expect(200)).body,
      );
      expect(list.items.map((o) => o.slug)).toEqual(['uibk', 'uibk-informatik']);
      await as(auth.uibk).get(`${api}/organizations/${ORG.uibkFaculty}`).expect(200);
      expect(code(await as(auth.uibk).get(`${api}/organizations/${ORG.urv}`).expect(403))).toBe(
        'oecp.auth.forbidden_organization',
      );
      await as(auth.alliance)
        .get(`${api}/organizations/00000000-0000-4000-8000-000000000999`)
        .expect(404);
    });

    it('creates a partner (partner_id = id) and a sub-unit inheriting it', async () => {
      const res = await as(auth.alliance).post(`${api}/organizations`, orgBody()).expect(201);
      const uva = adminOrganization.parse(res.body);
      expect(res.headers['location']).toBe(`${api}/organizations/${uva.id}`);
      expect(uva).toMatchObject({
        slug: 'uva',
        partner_id: uva.id,
        parent_id: null,
        keycloak_idp_alias: 'uva',
        logo_url: null,
        ui_languages: ['en', 'nl'],
        counts: { courses_total: 0, courses_published: 0, sub_units: 0 },
      });
      const fnwi = adminOrganization.parse(
        (
          await as(auth.alliance)
            .post(
              `${api}/organizations`,
              orgBody({
                slug: 'uva-fnwi',
                org_type: 'faculty',
                is_partner: false,
                parent_id: uva.id,
                name: { en: 'Faculty of Science' },
                schac_home_organization: null,
                keycloak_idp_alias: null,
                ext_id: 'FNWI',
              }),
            )
            .expect(201)
        ).body,
      );
      expect(fnwi.partner_id).toBe(uva.id);
      const [entry] = await audit('organization.create');
      expect(entry).toMatchObject({
        actor_sub: ALLIANCE_SUB,
        actor_org_id: ORG.aurora,
        entity_type: 'organization',
        entity_id: fnwi.id,
      });
      expect(entry!.changes).toMatchObject({
        slug: 'uva-fnwi',
        partner_id: uva.id,
        ext_id: 'FNWI',
      });
    });

    it('rejects duplicate slugs and identifiers, invalid parents and bad bodies', async () => {
      const post = (patch: Record<string, unknown>) =>
        as(auth.alliance).post(`${api}/organizations`, orgBody(patch));
      expect(code(await post({}).expect(409))).toBe('oecp.content.duplicate_slug');
      const alias = await post({
        slug: 'uva2',
        schac_home_organization: null,
        keycloak_idp_alias: 'uibk',
      }).expect(409);
      expect(code(alias)).toBe('oecp.content.duplicate_identifier');
      expect(alias.body.detail).toContain('keycloak_idp_alias');
      expect(code(await post({ slug: 'uva2' }).expect(409))).toBe(
        'oecp.content.duplicate_identifier',
      );
      expect(
        code(
          await post({
            slug: 'orphan',
            is_partner: false,
            schac_home_organization: null,
            keycloak_idp_alias: null,
            parent_id: '00000000-0000-4000-8000-000000000999',
          }).expect(422),
        ),
      ).toBe('oecp.content.invalid_parent');
      const bad = await post({ slug: 'Bad Slug', ui_languages: [] }).expect(400);
      expect(bad.headers['content-type']).toContain('application/problem+json');
      await post({ slug: 'uva3', partner_id: ORG.uibk }).expect(400);
    });

    it('replaces an organization, keeps the slug and audits an IdP change', async () => {
      const uva = (await as(auth.alliance).get(`${api}/organizations`).expect(200)).body.items.find(
        (o: { slug: string }) => o.slug === 'uva',
      );
      expect(
        code(
          await as(auth.alliance)
            .put(`${api}/organizations/${uva.id}`, orgBody({ slug: 'uva-new' }))
            .expect(409),
        ),
      ).toBe('oecp.content.slug_immutable');

      const updated = adminOrganization.parse(
        (
          await as(auth.alliance)
            .put(
              `${api}/organizations/${uva.id}`,
              orgBody({ keycloak_idp_alias: 'uva-saml', website_url: null, name: { en: 'UvA' } }),
            )
            .expect(200)
        ).body,
      );
      expect(updated).toMatchObject({
        keycloak_idp_alias: 'uva-saml',
        website_url: null,
        name: { en: 'UvA' },
        counts: { sub_units: 1 },
      });
      const [entry] = await audit('organization.update');
      expect(entry!.changes).toMatchObject({
        slug: 'uva',
        keycloak_idp_alias: { from: 'uva', to: 'uva-saml' },
        website_url: { from: 'https://www.uva.example', to: null },
      });
      expect(String((entry!.changes as Record<string, unknown>)['note'])).toContain('uva-saml');

      // Same body again: nothing changes, no audit row.
      const before = (await audit('organization.update')).length;
      await as(auth.alliance)
        .put(
          `${api}/organizations/${uva.id}`,
          orgBody({ keycloak_idp_alias: 'uva-saml', website_url: null, name: { en: 'UvA' } }),
        )
        .expect(200);
      expect(await audit('organization.update')).toHaveLength(before);
    });

    it('refuses cycles and self-parenting', async () => {
      const body = {
        slug: 'uibk',
        org_type: 'institution',
        is_partner: true,
        name: { en: 'University of Innsbruck' },
        default_timezone: 'Europe/Vienna',
        ui_languages: ['en'],
        keycloak_idp_alias: 'uibk',
      };
      expect(
        code(
          await as(auth.alliance)
            .put(`${api}/organizations/${ORG.uibk}`, { ...body, parent_id: ORG.uibkFaculty })
            .expect(422),
        ),
      ).toBe('oecp.content.invalid_parent');
      expect(
        code(
          await as(auth.alliance)
            .put(`${api}/organizations/${ORG.uibk}`, { ...body, parent_id: ORG.uibk })
            .expect(422),
        ),
      ).toBe('oecp.content.invalid_parent');
    });

    it('recomputes partner_id below an organization that stops or starts being a partner', async () => {
      const items = (await as(auth.alliance).get(`${api}/organizations`).expect(200)).body
        .items as {
        id: string;
        slug: string;
      }[];
      const uva = items.find((o) => o.slug === 'uva')!;
      const fnwi = items.find((o) => o.slug === 'uva-fnwi')!;
      const body = orgBody({
        keycloak_idp_alias: 'uva-saml',
        website_url: null,
        name: { en: 'UvA' },
      });
      await as(auth.alliance)
        .put(`${api}/organizations/${uva.id}`, { ...body, is_partner: false })
        .expect(200);
      expect((await orgRow(uva.id)).partner_id).toBeNull();
      expect((await orgRow(fnwi.id)).partner_id).toBeNull();
      await as(auth.alliance).put(`${api}/organizations/${uva.id}`, body).expect(200);
      expect((await orgRow(uva.id)).partner_id).toBe(uva.id);
      expect((await orgRow(fnwi.id)).partner_id).toBe(uva.id);
    });

    it('soft-deletes unused organizations only, and restores them', async () => {
      const items = (await as(auth.alliance).get(`${api}/organizations`).expect(200)).body
        .items as {
        id: string;
        slug: string;
      }[];
      const uva = items.find((o) => o.slug === 'uva')!;
      const fnwi = items.find((o) => o.slug === 'uva-fnwi')!;

      const inUse = await as(auth.alliance).delete(`${api}/organizations/${uva.id}`).expect(409);
      expect(code(inUse)).toBe('oecp.content.organization_in_use');
      expect(inUse.body.detail).toContain('1 sub-unit');
      const busy = await as(auth.alliance).delete(`${api}/organizations/${ORG.uibk}`).expect(409);
      expect(busy.body.detail).toMatch(/2 courses, 1 sub-unit, 1 administrator/);

      await as(auth.alliance).delete(`${api}/organizations/${fnwi.id}`).expect(204);
      await as(auth.alliance).delete(`${api}/organizations/${uva.id}`).expect(204);
      const [entry] = await audit('organization.delete');
      expect(entry).toMatchObject({ entity_id: uva.id, changes: { slug: 'uva' } });

      const visible = (await as(auth.alliance).get(`${api}/organizations`).expect(200)).body.items;
      expect(visible.map((o: { slug: string }) => o.slug)).not.toContain('uva');
      const all = (
        await as(auth.alliance).get(`${api}/organizations?include_deleted=true`).expect(200)
      ).body.items as { slug: string; deleted_at: string | null }[];
      expect(all.find((o) => o.slug === 'uva')!.deleted_at).not.toBeNull();
      expect(
        (await as(auth.alliance).get(`${api}/organizations/${uva.id}`).expect(200)).body.deleted_at,
      ).not.toBeNull();
      await as(auth.alliance).put(`${api}/organizations/${uva.id}`, orgBody()).expect(404);
      await as(auth.alliance).delete(`${api}/organizations/${uva.id}`).expect(404);
      expect(
        code(await as(auth.alliance).post(`${api}/organizations`, orgBody()).expect(409)),
      ).toBe('oecp.content.duplicate_slug');

      expect(
        code(await as(auth.alliance).post(`${api}/organizations/${fnwi.id}/restore`).expect(409)),
      ).toBe('oecp.content.invalid_parent');
      const restored = adminOrganization.parse(
        (await as(auth.alliance).post(`${api}/organizations/${uva.id}/restore`).expect(200)).body,
      );
      expect(restored.deleted_at).toBeNull();
      // Idempotent.
      await as(auth.alliance).post(`${api}/organizations/${uva.id}/restore`).expect(200);
      expect(await audit('organization.restore')).toHaveLength(1);
    });

    it('refuses deleting an organization with administrators or pending invitations', async () => {
      const res = await as(auth.alliance).delete(`${api}/organizations/${ORG.urv}`).expect(409);
      expect(res.body.detail).toContain('1 administrator');
    });
  });

  describe('administrators', () => {
    it('lists the Keycloak users of an organization (attribute search)', async () => {
      const list = organizationAdminList.parse(
        (await as(auth.alliance).get(`${api}/organizations/${ORG.aurora}/admins`).expect(200)).body,
      );
      expect(list.items).toEqual([
        {
          sub: ALLIANCE_SUB,
          username: 'chair@aurora.example',
          email: 'chair@aurora.example',
          name: 'Ada Chair',
          roles: ['alliance_admin'],
          idp: 'local',
          enabled: true,
          email_verified: true,
          created_at: '2026-10-01T00:00:00.000Z',
          last_login_at: null,
          required_actions: [],
        },
        expect.objectContaining({ sub: ALLIANCE2_SUB, name: null, roles: ['alliance_admin'] }),
      ]);
      const search = keycloak.callsTo('GET', /^\/users$/).at(-1)!;
      expect(search.query.get('q')).toBe(`oecp_org_id:${ORG.aurora}`);
      // Events are not readable: asked once, not per user.
      expect(keycloak.callsTo('GET', /^\/events$/).length).toBe(1);
    });

    it('reports the last login when events are readable and the IdP alias of brokered users', async () => {
      keycloak.eventsReadable = true;
      const aurora = organizationAdminList.parse(
        (await as(auth.alliance).get(`${api}/organizations/${ORG.aurora}/admins`).expect(200)).body,
      );
      expect(aurora.items[0]!.last_login_at).toBe('2026-10-10T09:00:00.000Z');
      const uibk = organizationAdminList.parse(
        (await as(auth.uibk).get(`${api}/organizations/${ORG.uibk}/admins`).expect(200)).body,
      );
      expect(uibk.items).toEqual([
        expect.objectContaining({ sub: UIBK_SUB, idp: 'uibk', roles: ['partner_admin'] }),
      ]);
    });

    it('lets a partner_admin read only its own scope', async () => {
      await as(auth.uibk).get(`${api}/organizations/${ORG.uibkFaculty}/admins`).expect(200);
      expect(
        code(await as(auth.uibk).get(`${api}/organizations/${ORG.aurora}/admins`).expect(403)),
      ).toBe('oecp.auth.forbidden_organization');
      await as(auth.uibk).delete(`${api}/organizations/${ORG.uibk}/admins/${UIBK_SUB}`).expect(403);
    });

    it('answers 502 when Keycloak is unavailable', async () => {
      keycloak.failWith = 503;
      const res = await as(auth.alliance)
        .get(`${api}/organizations/${ORG.aurora}/admins`)
        .expect(502);
      expect(code(res)).toBe('oecp.identity.unavailable');
    });

    it('refuses to remove yourself, strangers and the last alliance_admin', async () => {
      expect(
        code(
          await as(auth.alliance)
            .delete(`${api}/organizations/${ORG.aurora}/admins/${ALLIANCE_SUB}`)
            .expect(409),
        ),
      ).toBe('oecp.admin.cannot_remove_self');
      await as(auth.alliance)
        .delete(`${api}/organizations/${ORG.urv}/admins/${UIBK_SUB}`)
        .expect(404);
      await as(auth.alliance)
        .delete(`${api}/organizations/${ORG.aurora}/admins/00000000-0000-4000-8000-000000000999`)
        .expect(404);
    });

    it('revokes an administrator: roles, attribute, sessions, audit', async () => {
      await as(auth.alliance)
        .delete(`${api}/organizations/${ORG.aurora}/admins/${ALLIANCE2_SUB}`)
        .expect(204);
      const user = keycloak.users.get(ALLIANCE2_SUB)!;
      expect([...user.roles]).toEqual(['default-roles-oecp']);
      expect(user.attributes['oecp_org_id']).toBeUndefined();
      expect(keycloak.loggedOut).toContain(ALLIANCE2_SUB);
      const [entry] = await audit('admin.revoke');
      expect(entry).toMatchObject({
        actor_sub: ALLIANCE_SUB,
        entity_type: 'organization',
        entity_id: ORG.aurora,
        changes: { keycloak_user_id: ALLIANCE2_SUB, roles_removed: ['alliance_admin'] },
      });
      const list = organizationAdminList.parse(
        (await as(auth.alliance).get(`${api}/organizations/${ORG.aurora}/admins`).expect(200)).body,
      );
      expect(list.items.map((a) => a.sub)).toEqual([ALLIANCE_SUB]);
    });

    it('keeps the last alliance_admin even against a still-valid token of a revoked one', async () => {
      // The revoked administrator's access token lives up to 5 minutes.
      const res = await as(auth.alliance2)
        .delete(`${api}/organizations/${ORG.aurora}/admins/${ALLIANCE_SUB}`)
        .expect(409);
      expect(code(res)).toBe('oecp.admin.last_alliance_admin');
      expect(keycloak.users.get(ALLIANCE_SUB)!.roles.has('alliance_admin')).toBe(true);
    });

    it('re-sends the setup e-mail of a local account with pending actions only', async () => {
      const res = await as(auth.alliance)
        .post(`${api}/organizations/${ORG.uibkFaculty}/admins/${FACULTY_SUB}/resend-setup`)
        .expect(200);
      expect(res.body).toEqual({ sub: FACULTY_SUB, actions: ['CONFIGURE_TOTP'] });
      expect(keycloak.actionEmails.at(-1)).toEqual({
        id: FACULTY_SUB,
        actions: ['CONFIGURE_TOTP'],
      });
      const [entry] = await audit('admin.resend_setup');
      expect(entry).toMatchObject({
        entity_id: ORG.uibkFaculty,
        changes: { actions: ['CONFIGURE_TOTP'] },
      });

      expect(
        code(
          await as(auth.alliance)
            .post(`${api}/organizations/${ORG.uibk}/admins/${UIBK_SUB}/resend-setup`)
            .expect(409),
        ),
      ).toBe('oecp.admin.not_local_account');
      expect(
        code(
          await as(auth.alliance)
            .post(`${api}/organizations/${ORG.aurora}/admins/${ALLIANCE_SUB}/resend-setup`)
            .expect(409),
        ),
      ).toBe('oecp.admin.setup_complete');
    });
  });

  describe('invitations', () => {
    const invite = (organizationId: string, email: string) =>
      as(auth.alliance)
        .post(`${api}/invitations`, {
          email,
          role: 'partner_admin',
          organization_id: organizationId,
          ttl_hours: 48,
        })
        .expect(201);

    it('puts the IdP alias of brokered organizations in the link fragment', async () => {
      await invite(ORG.uibk, 'second@uibk.example');
      expect(mail.at(-1)!.text).toMatch(
        /https:\/\/campus\.example\/en\/admin\/accept#token=[A-Za-z0-9_-]{43}&idp=uibk\n/,
      );
      await invite(ORG.aurora, 'new@aurora.example');
      expect(mail.at(-1)!.text).toMatch(/accept#token=[A-Za-z0-9_-]{43}\n/);
    });

    it('refuses invitations to an organization whose IdP is not enabled in the realm', async () => {
      keycloak.identityProviders.set('urv', { alias: 'urv', enabled: false });
      try {
        const res = await as(auth.alliance)
          .post(`${api}/organizations/${ORG.urv}/invitations`, {
            email: 'blocked@urv.example',
            role: 'partner_admin',
          })
          .expect(409);
        expect(code(res)).toBe('oecp.invitation.idp_not_enabled');
        expect(res.body).toMatchObject({ idp_alias: 'urv' });
        expect(mail).toHaveLength(0);
      } finally {
        keycloak.identityProviders.set('urv', { alias: 'urv', enabled: true });
      }
    });

    it('creates invitations through the org-scoped alias of POST /invitations', async () => {
      const res = await as(auth.alliance)
        .post(`${api}/organizations/${ORG.uibk}/invitations`, {
          email: 'Scoped@UIBK.example',
          role: 'partner_admin',
          ttl_hours: 24,
        })
        .expect(201);
      const created = invitation.parse(res.body);
      expect(res.body).not.toHaveProperty('token');
      expect(created).toMatchObject({
        email: 'scoped@uibk.example',
        role: 'partner_admin',
        organization_id: ORG.uibk,
        invited_by: ALLIANCE_SUB,
        status: 'pending',
      });
      expect(mail.at(-1)!.text).toContain('&idp=uibk');
      const [entry] = await audit('invitation.create');
      expect(entry).toMatchObject({ entity_id: created.id, actor_sub: ALLIANCE_SUB });

      await as(auth.uibk)
        .post(`${api}/organizations/${ORG.uibk}/invitations`, {
          email: 'x@uibk.example',
          role: 'partner_admin',
        })
        .expect(403);
      await as(auth.alliance)
        .post(`${api}/organizations/00000000-0000-4000-8000-000000000999/invitations`, {
          email: 'x@uibk.example',
          role: 'partner_admin',
        })
        .expect(404);
      await as(auth.alliance)
        .post(`${api}/organizations/${ORG.uibk}/invitations`, {
          email: 'x@uibk.example',
          role: 'partner_admin',
          organization_id: ORG.urv,
        })
        .expect(400);
    });

    it('resends: revokes the old invitation and sends a new one with the same lifetime', async () => {
      const first = invitation.parse((await invite(ORG.urv, 'Coordinator@URV.example')).body);
      mail.length = 0;
      const res = await as(auth.alliance).post(`${api}/invitations/${first.id}/resend`).expect(201);
      const second = invitation.parse(res.body);
      expect(res.body).not.toHaveProperty('token');
      expect(second).toMatchObject({
        email: 'coordinator@urv.example',
        role: 'partner_admin',
        organization_id: ORG.urv,
        invited_by: ALLIANCE_SUB,
        status: 'pending',
      });
      expect(second.id).not.toBe(first.id);
      const lifetime = Date.parse(second.expires_at) - Date.parse(second.created_at);
      expect(Math.round(lifetime / 3_600_000)).toBe(48);
      expect(mail).toHaveLength(1);
      expect(mail[0]!.text).toContain('&idp=urv');

      const listed = invitationList.parse(
        (await as(auth.urv).get(`${api}/organizations/${ORG.urv}/invitations`).expect(200)).body,
      );
      expect(listed.items.find((i) => i.id === first.id)!.status).toBe('revoked');
      expect(listed.items.find((i) => i.id === second.id)!.status).toBe('pending');
      const [revoked] = await audit('invitation.revoke');
      expect(revoked).toMatchObject({ entity_id: first.id, changes: { reason: 'resend' } });
      const [resent] = await audit('invitation.resend');
      expect(resent).toMatchObject({ entity_id: second.id, changes: { replaces: first.id } });

      // A revoked invitation can be resent again; a body may shorten the lifetime.
      const third = invitation.parse(
        (
          await as(auth.alliance)
            .post(`${api}/invitations/${first.id}/resend`, { ttl_hours: 2 })
            .expect(201)
        ).body,
      );
      expect(Date.parse(third.expires_at) - Date.parse(third.created_at)).toBeLessThanOrEqual(
        2 * 3_600_000 + 1000,
      );
    });

    it('keeps the old invitation when the new e-mail cannot be sent', async () => {
      const first = invitation.parse((await invite(ORG.urv, 'mailfail@urv.example')).body);
      mailFails = true;
      expect(
        code(await as(auth.alliance).post(`${api}/invitations/${first.id}/resend`).expect(502)),
      ).toBe('oecp.mail.unavailable');
      const row = await tdb.db
        .selectFrom('admin_invitations')
        .selectAll()
        .where('id', '=', first.id)
        .executeTakeFirstOrThrow();
      expect(row.revoked_at).toBeNull();
    });

    it('refuses resending accepted or unknown invitations, and partner callers', async () => {
      const accepted = invitation.parse((await invite(ORG.urv, 'done@urv.example')).body);
      await tdb.db
        .updateTable('admin_invitations')
        .set({ accepted_at: new Date(), accepted_sub: URV_SUB })
        .where('id', '=', accepted.id)
        .execute();
      expect(
        code(await as(auth.alliance).post(`${api}/invitations/${accepted.id}/resend`).expect(409)),
      ).toBe('oecp.invitation.invalid');
      await as(auth.alliance)
        .post(`${api}/invitations/00000000-0000-4000-8000-000000000999/resend`)
        .expect(404);
      await as(auth.urv).post(`${api}/invitations/${accepted.id}/resend`).expect(403);
    });

    it('lists an organization’s invitations with the derived status, within scope', async () => {
      await tdb.db
        .insertInto('admin_invitations')
        .values({
          email: 'late@uibk.example',
          role: 'partner_admin',
          organization_id: ORG.uibkFaculty,
          token_sha256: Buffer.alloc(32, 7),
          invited_by: ALLIANCE_SUB,
          expires_at: new Date(Date.now() - 1000),
        })
        .execute();
      const list = invitationList.parse(
        (await as(auth.uibk).get(`${api}/organizations/${ORG.uibkFaculty}/invitations`).expect(200))
          .body,
      );
      expect(list.items).toEqual([
        expect.objectContaining({
          email: 'late@uibk.example',
          status: 'expired',
          accepted_at: null,
        }),
      ]);
      await as(auth.urv).get(`${api}/organizations/${ORG.uibk}/invitations`).expect(403);
    });
  });

  describe('network status', () => {
    beforeAll(async () => {
      const now = Date.now();
      await tdb.db
        .insertInto('partner_integrations')
        .values([
          {
            organization_id: ORG.uibk,
            authoritative_channel: 'oeapi',
            access_mode: 'direct',
            base_url: 'https://oeapi.uibk.example',
            approved_host: 'oeapi.uibk.example',
            enabled: true,
          },
          {
            organization_id: ORG.urv,
            authoritative_channel: 'oeapi',
            access_mode: 'direct',
            base_url: 'https://oeapi.urv.example',
            enabled: true,
          },
        ])
        .execute();
      await tdb.db
        .insertInto('sync_runs')
        .values([
          {
            organization_id: ORG.uibk,
            channel: 'oeapi',
            trigger_kind: 'schedule',
            schema_version: 'oeapi-5.0',
            status: 'succeeded',
            is_complete: true,
            started_at: new Date(now - 3_600_000),
            finished_at: new Date(now - 3_500_000),
            n_created: 2,
            created_at: new Date(now - 3_600_000),
          },
          {
            organization_id: ORG.uibk,
            channel: 'form',
            trigger_kind: 'form',
            schema_version: 'form-1',
            status: 'succeeded',
            is_complete: true,
            started_at: new Date(now - 60_000),
            finished_at: new Date(now - 60_000),
            created_at: new Date(now - 60_000),
          },
          {
            organization_id: ORG.uibkFaculty,
            channel: 'csv',
            trigger_kind: 'upload',
            schema_version: 'csv-1.1',
            status: 'failed',
            started_at: new Date(now - 60_000),
            finished_at: new Date(now - 60_000),
            created_at: new Date(now - 60_000),
          },
        ])
        .execute();
    });

    it('summarises every organization with a health verdict', async () => {
      const status = networkStatus.parse(
        (await as(auth.alliance).get(`${api}/network-status`).expect(200)).body,
      );
      const by = Object.fromEntries(status.items.map((i) => [i.organization.slug, i]));
      expect(status.items[0]!.organization.slug).toBe('aurora');
      expect(by['uibk']).toMatchObject({
        authoritative_channel: 'oeapi',
        access_mode: 'direct',
        enabled: true,
        host_approved: true,
        secret_configured: false,
        schedule_cron: '0 3 * * *',
        last_run: { channel: 'oeapi', status: 'succeeded', n_created: 2 },
        courses_total: 2,
        courses_published: 1,
        offerings_upcoming: 1,
        admins_count: 1,
        health: 'ok',
      });
      expect(by['uibk']!.last_success_at).not.toBeNull();
      expect(by['urv']).toMatchObject({ host_approved: false, health: 'error', last_run: null });
      expect(by['aurora']).toMatchObject({
        authoritative_channel: 'form',
        enabled: false,
        last_run: null,
        health: 'unconfigured',
        admins_count: 1,
      });
      expect(by['aurora']!.pending_invitations).toBeGreaterThanOrEqual(1);
      expect(by['uibk-informatik']).toMatchObject({
        last_run: { channel: 'csv', status: 'failed' },
        last_success_at: null,
        health: 'warning',
        admins_count: 1,
      });
    });

    it('still answers with null administrator counts when Keycloak is down', async () => {
      keycloak.failWith = 503;
      const status = networkStatus.parse(
        (await as(auth.alliance).get(`${api}/network-status`).expect(200)).body,
      );
      expect(status.items.every((i) => i.admins_count === null)).toBe(true);
    });
  });
});
