// SPDX-License-Identifier: EUPL-1.2
// Integration settings and organization form logic (app/utils/integrationForm.ts,
// app/utils/organizationForm.ts): defaults, validation, request bodies (checked
// against the shared request schemas) and the write-only credential.
import { integrationUpdateRequest, organizationInput } from '@oecp/schemas';
import { describe, expect, it } from 'vitest';
import type { AdminIntegration, AdminOrganizationRecord } from '../app/types/admin';
import {
  CUSTOM_CRON,
  hostOfUrl,
  type IntegrationForm,
  integrationBody,
  integrationFieldOf,
  integrationFormOf,
  validateIntegrationForm,
} from '../app/utils/integrationForm';
import {
  descendantIds,
  emptyOrganizationForm,
  organizationBody,
  organizationFieldId,
  organizationFieldOf,
  organizationFormOf,
  organizationTreeOptions,
  validateOrganizationForm,
} from '../app/utils/organizationForm';

const ORG = '0b9f6c1e-1d7a-4f39-9a51-6c1e0f0a0001';

function storedIntegration(overrides: Partial<AdminIntegration> = {}): AdminIntegration {
  return {
    organization_id: ORG,
    authoritative_channel: 'oeapi',
    access_mode: 'direct',
    oeapi_version: '5',
    consumer_profile: 'eduxchange',
    base_url: 'https://oeapi.uni.example/v5',
    auth_scheme: 'basic',
    api_key_header_name: null,
    secret_configured: true,
    surfeduhub_endpoint_id: null,
    approved_host: null,
    approved_by: null,
    approved_at: null,
    host_approved: false,
    schedule_cron: '0 3 * * *',
    schedule_timezone: 'Europe/Vienna',
    page_size: 100,
    max_requests_per_second: 2,
    withdraw_after_absences: 3,
    enabled: false,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    last_run: null,
    ...overrides,
  };
}

const codes = (issues: { field: string; code: string }[]) =>
  issues.map((i) => `${i.field}:${i.code}`);

function oeapiForm(overrides: Partial<IntegrationForm> = {}): IntegrationForm {
  return {
    ...integrationFormOf(null),
    authoritative_channel: 'oeapi',
    access_mode: 'direct',
    base_url: 'https://oeapi.uni.example/v5',
    auth_scheme: 'basic',
    basic_username: 'oecp',
    basic_password: 's3cret:with:colons',
    ...overrides,
  };
}

describe('integration form', () => {
  it('starts from the API defaults when nothing is configured', () => {
    const form = integrationFormOf(null);
    expect(form).toMatchObject({
      authoritative_channel: 'form',
      access_mode: '',
      consumer_profile: 'eduxchange',
      auth_scheme: 'none',
      secret_action: 'replace',
      schedule_preset: '0 3 * * *',
      schedule_timezone: 'Europe/Brussels',
      page_size: '100',
      max_requests_per_second: '2',
      withdraw_after_absences: '3',
      enabled: false,
    });
    expect(validateIntegrationForm(form, { secretConfigured: false })).toEqual([]);
    const body = integrationBody(form, { secretConfigured: false });
    expect(body).not.toHaveProperty('secret');
    expect(integrationUpdateRequest.safeParse(body).success).toBe(true);
  });

  it('loads stored settings, keeps the credential and recognises custom schedules', () => {
    const form = integrationFormOf(storedIntegration({ schedule_cron: '30 2 * * 1-5' }));
    expect(form.secret_action).toBe('keep');
    expect(form.schedule_preset).toBe(CUSTOM_CRON);
    expect(form.schedule_cron).toBe('30 2 * * 1-5');
    expect(form.secret).toBe('');
    const body = integrationBody(form, { secretConfigured: true });
    // Omitted secret = keep the stored credential.
    expect(body).not.toHaveProperty('secret');
    expect(body).toMatchObject({ auth_scheme: 'basic', schedule_cron: '30 2 * * 1-5' });
    expect(integrationUpdateRequest.safeParse(body).success).toBe(true);
  });

  it('sends a replaced basic credential as username:password', () => {
    const body = integrationBody(oeapiForm(), { secretConfigured: false });
    expect(body.secret).toBe('oecp:s3cret:with:colons');
    expect(integrationUpdateRequest.parse(body)).toMatchObject({
      authoritative_channel: 'oeapi',
      access_mode: 'direct',
      oeapi_version: '5',
    });
  });

  it('sends bearer tokens and API keys as given, with the header name', () => {
    const bearer = integrationBody(oeapiForm({ auth_scheme: 'bearer', secret: 'tok' }), {
      secretConfigured: false,
    });
    expect(bearer).toMatchObject({ secret: 'tok', api_key_header_name: null });
    const key = integrationBody(
      oeapiForm({ auth_scheme: 'api_key_header', api_key_header_name: 'X-API-Key', secret: 'k' }),
      { secretConfigured: false },
    );
    expect(key).toMatchObject({ secret: 'k', api_key_header_name: 'X-API-Key' });
    expect(integrationUpdateRequest.safeParse(key).success).toBe(true);
  });

  it('deletes the stored credential with null (scheme none, or delete)', () => {
    const none = integrationBody(oeapiForm({ auth_scheme: 'none' }), { secretConfigured: true });
    expect(none.secret).toBeNull();
    expect(integrationUpdateRequest.safeParse(none).success).toBe(true);
    const noneNothingStored = integrationBody(oeapiForm({ auth_scheme: 'none' }), {
      secretConfigured: false,
    });
    expect(noneNothingStored).not.toHaveProperty('secret');
    const deleted = integrationBody(oeapiForm({ secret_action: 'delete' }), {
      secretConfigured: true,
    });
    expect(deleted.secret).toBeNull();
    // A scheme that needs a credential cannot lose it: the form says so first.
    expect(
      codes(
        validateIntegrationForm(oeapiForm({ secret_action: 'delete' }), { secretConfigured: true }),
      ),
    ).toEqual(['secret_action:secretRequired']);
  });

  it('leaves the credential alone outside direct access', () => {
    const stored = storedIntegration({ auth_scheme: 'bearer' });
    const form = {
      ...integrationFormOf(stored),
      access_mode: 'surfeduhub' as const,
      surfeduhub_endpoint_id: 'uni.example',
    };
    const body = integrationBody(form, { secretConfigured: true, stored });
    expect(body).not.toHaveProperty('secret');
    expect(body).toMatchObject({
      access_mode: 'surfeduhub',
      auth_scheme: 'bearer',
      surfeduhub_endpoint_id: 'uni.example',
      // A valid base URL of the other mode is kept.
      base_url: 'https://oeapi.uni.example/v5',
    });
    expect(validateIntegrationForm(form, { secretConfigured: true })).toEqual([]);
  });

  it('checks the rules of the API', () => {
    const issues = validateIntegrationForm(
      {
        ...integrationFormOf(null),
        authoritative_channel: 'csv',
        access_mode: 'direct',
        base_url: 'https://user:pw@uni.example/v5?x=1',
        consumer_profile: 'bad profile',
        auth_scheme: 'api_key_header',
        api_key_header_name: 'X Key',
        secret: '',
        schedule_preset: CUSTOM_CRON,
        schedule_cron: '61 * * * *',
        schedule_timezone: 'Mars/Olympus',
        page_size: '5',
        max_requests_per_second: '0',
        withdraw_after_absences: '31',
        enabled: true,
      },
      { secretConfigured: false },
    );
    expect(codes(issues)).toEqual([
      'consumer_profile:consumerProfile',
      'base_url:baseUrl',
      'api_key_header_name:headerName',
      'secret:secretRequired',
      'schedule_cron:cron',
      'schedule_timezone:timezone',
      'page_size:pageSize',
      'max_requests_per_second:rate',
      'withdraw_after_absences:absences',
      'enabled:enabledNeedsOeapi',
    ]);
    expect(
      codes(
        validateIntegrationForm(
          { ...integrationFormOf(null), authoritative_channel: 'oeapi' },
          { secretConfigured: false },
        ),
      ),
    ).toEqual(['access_mode:accessModeRequired']);
    expect(
      codes(
        validateIntegrationForm(
          oeapiForm({ base_url: '', basic_username: 'a:b', basic_password: '' }),
          {
            secretConfigured: false,
          },
        ),
      ),
    ).toEqual([
      'base_url:baseUrlRequired',
      'basic_username:usernameColon',
      'basic_password:passwordRequired',
    ]);
    expect(
      codes(
        validateIntegrationForm(
          oeapiForm({ access_mode: 'surfeduhub', surfeduhub_endpoint_id: '' }),
          {
            secretConfigured: false,
          },
        ),
      ),
    ).toEqual(['surfeduhub_endpoint_id:endpointRequired']);
  });

  it('maps server pointers and hosts', () => {
    expect(integrationFieldOf('/secret', oeapiForm())).toBe('basic_username');
    expect(integrationFieldOf('/secret', oeapiForm({ auth_scheme: 'bearer' }))).toBe('secret');
    expect(integrationFieldOf('/base_url', oeapiForm())).toBe('base_url');
    expect(hostOfUrl('https://OEAPI.Uni.example:8443/v5')).toBe('oeapi.uni.example:8443');
    expect(hostOfUrl('not a url')).toBeNull();
    expect(hostOfUrl(null)).toBeNull();
  });
});

function record(overrides: Partial<AdminOrganizationRecord> = {}): AdminOrganizationRecord {
  return {
    id: ORG,
    slug: 'uibk',
    org_type: 'institution',
    is_partner: true,
    parent_id: null,
    partner_id: ORG,
    name: { en: 'University of Innsbruck', de: 'Universität Innsbruck' },
    country_code: 'AT',
    schac_home_organization: 'uibk.ac.at',
    keycloak_idp_alias: 'uibk',
    contact_email: 'oecp@uibk.ac.at',
    default_timezone: 'Europe/Vienna',
    ui_languages: ['en', 'de'],
    website_url: 'https://www.uibk.ac.at',
    logo_url: null,
    erasmus_code: 'A INNSBRU01',
    pic: '999876543',
    ext_id: null,
    deleted_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
    counts: { courses_total: 3, courses_published: 2, sub_units: 1 },
    ...overrides,
  };
}

describe('organization form', () => {
  it('round-trips a record into a valid OrganizationInput', () => {
    const form = organizationFormOf(record());
    expect(form.names).toEqual([
      { lang: 'en', text: 'University of Innsbruck' },
      { lang: 'de', text: 'Universität Innsbruck' },
    ]);
    expect(form.ui_languages).toBe('en, de');
    expect(validateOrganizationForm(form, { creating: false, selfId: ORG })).toEqual([]);
    const body = organizationBody(form);
    expect(body).toEqual({
      slug: 'uibk',
      org_type: 'institution',
      is_partner: true,
      parent_id: null,
      name: { en: 'University of Innsbruck', de: 'Universität Innsbruck' },
      country_code: 'AT',
      schac_home_organization: 'uibk.ac.at',
      keycloak_idp_alias: 'uibk',
      contact_email: 'oecp@uibk.ac.at',
      default_timezone: 'Europe/Vienna',
      ui_languages: ['en', 'de'],
      website_url: 'https://www.uibk.ac.at',
      logo_url: null,
      erasmus_code: 'A INNSBRU01',
      pic: '999876543',
      ext_id: null,
    });
    expect(organizationInput.safeParse(body).success).toBe(true);
    // Aliases follow the API rule (dots and underscores allowed).
    const dotted = { ...form, keycloak_idp_alias: 'uni.bk_saml' };
    expect(validateOrganizationForm(dotted, { creating: false, selfId: ORG })).toEqual([]);
    expect(organizationInput.safeParse(organizationBody(dotted)).success).toBe(true);
  });

  it('turns empty optional fields into null', () => {
    const form = {
      ...emptyOrganizationForm(),
      slug: 'new-uni',
      names: [{ lang: 'en', text: 'New' }],
    };
    const body = organizationBody(form);
    expect(body).toMatchObject({ contact_email: null, keycloak_idp_alias: null, parent_id: null });
    expect(organizationInput.safeParse(body).success).toBe(true);
  });

  it('checks the rules of the API', () => {
    const form = {
      ...emptyOrganizationForm(),
      slug: 'Bad Slug',
      org_type: 'alliance' as const,
      is_partner: true,
      parent_id: 'p',
      names: [
        { lang: 'en', text: ' ' },
        { lang: 'de', text: 'Name' },
        { lang: 'de', text: '' },
        { lang: 'Not a tag', text: 'x' },
      ],
      country_code: 'at',
      keycloak_idp_alias: 'local',
      contact_email: 'nope',
      default_timezone: 'Nowhere/City',
      ui_languages: 'en, pt-BR',
      website_url: 'http://insecure.example',
      pic: '123',
    };
    expect(codes(validateOrganizationForm(form, { creating: true }))).toEqual([
      'slug:slug',
      'is_partner:alliancePartner',
      'parent_id:allianceParent',
      'names/0/text:nameEnglish',
      'names/2/lang:languageDuplicate',
      'names/2/text:nameText',
      'names/3/lang:language',
      'country_code:countryCode',
      'keycloak_idp_alias:idpAlias',
      'contact_email:email',
      'default_timezone:timezone',
      'ui_languages:uiLanguages',
      'website_url:https',
      'pic:pic',
    ]);
    // The slug is not checked after creation (immutable, sent back unchanged).
    const existing = { ...organizationFormOf(record()), slug: 'whatever', parent_id: ORG };
    expect(codes(validateOrganizationForm(existing, { creating: false, selfId: ORG }))).toEqual([
      'parent_id:parentSelf',
    ]);
    expect(
      codes(
        validateOrganizationForm(
          {
            ...emptyOrganizationForm(),
            slug: 'ok',
            names: [{ lang: 'en', text: 'A' }],
            ui_languages: ' ',
          },
          { creating: true },
        ),
      ),
    ).toEqual(['ui_languages:uiLanguagesRequired']);
  });

  it('maps server pointers to fields and DOM ids', () => {
    const form = organizationFormOf(record());
    expect(organizationFieldOf('/name/de', form)).toBe('names/1/text');
    expect(organizationFieldOf('/name/en', form)).toBe('names/0/text');
    expect(organizationFieldOf('/slug', form)).toBe('slug');
    expect(organizationFieldId('names/1/text')).toBe('org-names-1-text');
    expect(organizationFieldId('keycloak_idp_alias')).toBe('org-keycloak_idp_alias');
  });

  it('builds the parent choices without the organization and its descendants', () => {
    const a = record({ id: 'a', slug: 'a', name: { en: 'Alpha' } });
    const b = record({ id: 'b', slug: 'b', name: { en: 'Beta' }, parent_id: 'a' });
    const c = record({ id: 'c', slug: 'c', name: { en: 'Gamma' }, parent_id: 'b' });
    const d = record({ id: 'd', slug: 'd', name: { en: 'Delta' } });
    const gone = record({
      id: 'e',
      slug: 'e',
      name: { en: 'Deleted' },
      deleted_at: '2026-10-01T00:00:00Z',
    });
    const all = [c, d, b, a, gone];
    expect([...descendantIds('b', all)].sort()).toEqual(['b', 'c']);
    expect(organizationTreeOptions(all).map((o) => o.label)).toEqual([
      'Alpha',
      '— Beta',
      '— — Gamma',
      'Delta',
    ]);
    expect(organizationTreeOptions(all, descendantIds('b', all)).map((o) => o.value)).toEqual([
      'a',
      'd',
    ]);
  });
});
