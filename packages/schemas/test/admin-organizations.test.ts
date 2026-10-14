// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  adminOrganizationListQuery,
  createOrganizationInvitationRequest,
  IDP_ALIAS_PATTERN,
  isIdpAlias,
  ERROR_CODES,
  networkStatus,
  organizationInput,
  referenceResponse,
  resendInvitationRequest,
} from '../src/index.js';

const minimal = {
  slug: 'uibk',
  org_type: 'institution',
  is_partner: true,
  name: { en: 'University of Innsbruck', de: 'Universität Innsbruck' },
  default_timezone: 'Europe/Vienna',
  ui_languages: ['en', 'de'],
};

const issues = (input: unknown) => {
  const result = organizationInput.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
};

describe('organization input', () => {
  it('fills optional members with null (PUT is a full replace)', () => {
    expect(organizationInput.parse(minimal)).toEqual({
      ...minimal,
      parent_id: null,
      country_code: null,
      schac_home_organization: null,
      keycloak_idp_alias: null,
      contact_email: null,
      website_url: null,
      logo_url: null,
      erasmus_code: null,
      pic: null,
      ext_id: null,
    });
  });

  it('accepts a complete brokered partner', () => {
    expect(
      issues({
        ...minimal,
        country_code: 'AT',
        schac_home_organization: 'uibk.ac.at',
        keycloak_idp_alias: 'uibk',
        contact_email: 'aurora@uibk.ac.at',
        website_url: 'https://www.uibk.ac.at',
        logo_url: 'https://www.uibk.ac.at/logo.svg',
        erasmus_code: 'A INNSBRU01',
        pic: '999876155',
        ext_id: 'UIBK',
      }),
    ).toEqual([]);
  });

  it.each([
    [{ slug: 'UIBK' }, 'slug'],
    [{ slug: 'x' }, 'slug'],
    [{ name: { de: 'Nur Deutsch' } }, 'name.en'],
    [{ default_timezone: 'Mars/Olympus' }, 'default_timezone'],
    [{ ui_languages: [] }, 'ui_languages'],
    [{ ui_languages: ['en-GB'] }, 'ui_languages.0'],
    [{ ui_languages: ['en', 'en'] }, 'ui_languages.1'],
    [{ website_url: 'http://insecure.example' }, 'website_url'],
    [{ logo_url: 'ftp://x.example/logo.png' }, 'logo_url'],
    [{ pic: '12345' }, 'pic'],
    [{ country_code: 'at' }, 'country_code'],
    [{ keycloak_idp_alias: 'local' }, 'keycloak_idp_alias'],
    [{ keycloak_idp_alias: 'has space' }, 'keycloak_idp_alias'],
    [{ keycloak_idp_alias: 'UIBK' }, 'keycloak_idp_alias'],
    [{ keycloak_idp_alias: 'u' }, 'keycloak_idp_alias'],
    [{ keycloak_idp_alias: '-uibk' }, 'keycloak_idp_alias'],
    [{ parent_id: 'not-a-uuid' }, 'parent_id'],
    [{ partner_id: '0a000000-0000-4000-8000-000000000001' }, ''],
  ])('rejects %o at %s', (patch, path) => {
    expect(issues({ ...minimal, ...patch }).some((i) => i.startsWith(`${path}:`))).toBe(true);
  });

  it('keeps the alliance at the top and out of the partners', () => {
    const alliance = { ...minimal, slug: 'aurora', org_type: 'alliance', is_partner: false };
    expect(issues(alliance)).toEqual([]);
    expect(issues({ ...alliance, is_partner: true })).toHaveLength(1);
    expect(issues({ ...alliance, parent_id: '0a000000-0000-4000-8000-000000000002' })).toEqual([
      'parent_id:oecp.content.invalid_parent',
    ]);
  });

  it('parses include_deleted', () => {
    expect(adminOrganizationListQuery.parse({})).toEqual({ include_deleted: false });
    expect(adminOrganizationListQuery.parse({ include_deleted: 'true' })).toEqual({
      include_deleted: true,
    });
    expect(adminOrganizationListQuery.safeParse({ include_deleted: 'yes' }).success).toBe(false);
  });
});

describe('IdP aliases', () => {
  it('shares one pattern: lower case, digits, dots, underscores, hyphens; not local', () => {
    for (const ok of ['uibk', 'uni-due.de', 'vu_amsterdam', 'a1']) {
      expect(isIdpAlias(ok)).toBe(true);
      expect(IDP_ALIAS_PATTERN.test(ok)).toBe(true);
    }
    for (const bad of ['local', 'UIBK', 'u', '.uibk', 'with space', '', null, undefined]) {
      expect(isIdpAlias(bad)).toBe(false);
    }
    expect(issues({ ...minimal, keycloak_idp_alias: 'uni-due.de' })).toEqual([]);
  });
});

describe('organization invitations', () => {
  it('takes the organization from the path', () => {
    expect(
      createOrganizationInvitationRequest.parse({ email: 'A@B.example', role: 'partner_admin' }),
    ).toEqual({ email: 'a@b.example', role: 'partner_admin', ttl_hours: 168 });
    expect(
      createOrganizationInvitationRequest.safeParse({
        email: 'a@b.example',
        role: 'partner_admin',
        organization_id: '0a000000-0000-4000-8000-000000000002',
      }).success,
    ).toBe(false);
  });
});

describe('invitation resend', () => {
  it('takes an optional ttl_hours of at most 168', () => {
    expect(resendInvitationRequest.parse({})).toEqual({});
    expect(resendInvitationRequest.parse({ ttl_hours: 24 })).toEqual({ ttl_hours: 24 });
    expect(resendInvitationRequest.safeParse({ ttl_hours: 169 }).success).toBe(false);
    expect(resendInvitationRequest.safeParse({ email: 'x@y.z' }).success).toBe(false);
  });
});

describe('network status', () => {
  it('validates an item with and without a run', () => {
    const item = {
      organization: {
        id: '0a000000-0000-4000-8000-000000000002',
        slug: 'uibk',
        name: { en: 'UIBK' },
        is_partner: true,
        org_type: 'institution',
        parent_id: null,
      },
      authoritative_channel: 'oeapi',
      access_mode: 'direct',
      enabled: true,
      host_approved: true,
      secret_configured: false,
      schedule_cron: '0 3 * * *',
      last_run: {
        id: '0b000000-0000-4000-8000-000000000001',
        channel: 'oeapi',
        status: 'succeeded',
        is_complete: true,
        started_at: '2026-10-14T03:00:00.000Z',
        finished_at: '2026-10-14T03:01:00.000Z',
        n_created: 1,
        n_updated: 0,
        n_unchanged: 0,
        n_rejected: 0,
        n_withdrawn: 0,
      },
      last_success_at: '2026-10-14T03:01:00.000Z',
      courses_total: 1,
      courses_published: 1,
      offerings_upcoming: 0,
      admins_count: null,
      pending_invitations: 0,
      health: 'ok',
    };
    expect(
      networkStatus.safeParse({ generated_at: '2026-10-14T12:00:00.000Z', items: [item] }).success,
    ).toBe(true);
    expect(
      networkStatus.safeParse({
        generated_at: '2026-10-14T12:00:00.000Z',
        items: [{ ...item, last_run: null, health: 'stale' }],
      }).success,
    ).toBe(false);
  });
});

describe('public reference', () => {
  it('carries the IdP alias of each organization', () => {
    const org = referenceResponse.shape.organizations.element;
    const base = {
      id: '0a000000-0000-4000-8000-000000000002',
      slug: 'uibk',
      name: { en: 'UIBK' },
      country_code: 'AT',
      logo_url: null,
      website_url: null,
      org_type: 'institution',
      is_partner: true,
      parent_id: null,
    };
    expect(org.safeParse({ ...base, idp_alias: 'uibk' }).success).toBe(true);
    expect(org.safeParse({ ...base, idp_alias: null }).success).toBe(true);
    expect(org.safeParse(base).success).toBe(false);
    expect(org.safeParse({ ...base, idp_alias: 'Not Valid' }).success).toBe(false);
  });
});

describe('organization error codes', () => {
  it.each([
    'oecp.content.duplicate_slug',
    'oecp.content.duplicate_identifier',
    'oecp.content.slug_immutable',
    'oecp.content.invalid_parent',
    'oecp.content.organization_in_use',
    'oecp.admin.cannot_remove_self',
    'oecp.admin.last_alliance_admin',
    'oecp.admin.not_local_account',
    'oecp.admin.setup_complete',
  ])('%s exists', (code) => {
    expect(ERROR_CODES).toHaveProperty([code]);
  });
});
