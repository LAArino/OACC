// SPDX-License-Identifier: EUPL-1.2
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvitationsService } from '../../src/admin/invitations/invitations.service.js';
import {
  BOOTSTRAP_ACTOR,
  BootstrapAllianceAdminCommand,
} from '../../src/cli/bootstrap-alliance-admin.js';
import {
  type CliHandlers,
  DEFAULT_ATTRIBUTE_SEED_FILE,
  DEFAULT_SEED_FILE,
  EXIT,
  runProgram,
} from '../../src/cli/program.js';
import {
  attributeDefinitionSeedFile,
  SeedAttributeDefinitionsCommand,
} from '../../src/cli/seed-attribute-definitions.js';
import {
  organizationSeedFile,
  SeedOrganizationsCommand,
} from '../../src/cli/seed-organizations.js';
import type { KeycloakAdminService } from '../../src/identity/keycloak-admin.service.js';
import { createFakeDb, insertedValues } from '../support/fake-kysely.js';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    output: {
      writeOut: (t: string) => void out.push(t),
      writeErr: (t: string) => void err.push(t),
    },
  };
}

function handlers() {
  return {
    seedOrganizations: vi.fn<CliHandlers['seedOrganizations']>().mockResolvedValue(EXIT.OK),
    seedAttributeDefinitions: vi
      .fn<CliHandlers['seedAttributeDefinitions']>()
      .mockResolvedValue(EXIT.OK),
    bootstrapAllianceAdmin: vi
      .fn<CliHandlers['bootstrapAllianceAdmin']>()
      .mockResolvedValue(EXIT.OK),
    storeSecret: vi.fn<CliHandlers['storeSecret']>().mockResolvedValue(EXIT.OK),
  };
}

describe('oecp command line', () => {
  it('parses store-secret with a purpose label', async () => {
    const h = handlers();
    await expect(
      runProgram(['store-secret', '--purpose', 'surfeduhub'], h, capture().output),
    ).resolves.toBe(EXIT.OK);
    expect(h.storeSecret).toHaveBeenCalledWith({ purpose: 'surfeduhub' });
  });

  it('rejects store-secret without a valid purpose', async () => {
    const h = handlers();
    await expect(
      runProgram(['store-secret', '--purpose', 'Not Valid'], h, capture().output),
    ).resolves.toBe(EXIT.USAGE);
    expect(h.storeSecret).not.toHaveBeenCalled();
  });

  it('parses seed-organizations with defaults', async () => {
    const h = handlers();
    await expect(runProgram(['seed-organizations'], h, capture().output)).resolves.toBe(EXIT.OK);
    expect(h.seedOrganizations).toHaveBeenCalledWith({ file: DEFAULT_SEED_FILE, dryRun: false });
    expect(DEFAULT_SEED_FILE).toMatch(/apps\/api\/db\/seed\/organizations\.json$/);
  });

  it('resolves --file against the working directory and accepts --dry-run', async () => {
    const h = handlers();
    await runProgram(
      ['seed-organizations', '--file', 'x/orgs.json', '--dry-run'],
      h,
      capture().output,
    );
    expect(h.seedOrganizations).toHaveBeenCalledWith({
      file: resolve('x/orgs.json'),
      dryRun: true,
    });
  });

  it('parses seed-attribute-definitions with defaults and options', async () => {
    const h = handlers();
    await runProgram(['seed-attribute-definitions'], h, capture().output);
    expect(h.seedAttributeDefinitions).toHaveBeenCalledWith({
      file: DEFAULT_ATTRIBUTE_SEED_FILE,
      dryRun: false,
    });
    expect(DEFAULT_ATTRIBUTE_SEED_FILE).toMatch(
      /apps\/api\/db\/seed\/attribute-definitions\.json$/,
    );
    await runProgram(
      ['seed-attribute-definitions', '--file', 'x/a.json', '--dry-run'],
      h,
      capture().output,
    );
    expect(h.seedAttributeDefinitions).toHaveBeenLastCalledWith({
      file: resolve('x/a.json'),
      dryRun: true,
    });
  });

  it('parses bootstrap-alliance-admin with a 24-hour default', async () => {
    const h = handlers();
    const code = await runProgram(
      ['bootstrap-alliance-admin', '--email', 'Chair@Aurora.example', '--org', 'aurora'],
      h,
      capture().output,
    );
    expect(code).toBe(EXIT.OK);
    expect(h.bootstrapAllianceAdmin).toHaveBeenCalledWith({
      email: 'chair@aurora.example',
      org: 'aurora',
      ttlHours: 24,
    });
  });

  it('propagates the handler exit code', async () => {
    const h = handlers();
    h.bootstrapAllianceAdmin.mockResolvedValue(EXIT.REFUSED);
    const code = await runProgram(
      ['bootstrap-alliance-admin', '--email', 'a@b.eu', '--org', 'aurora', '--ttl-hours', '48'],
      h,
      capture().output,
    );
    expect(code).toBe(EXIT.REFUSED);
    expect(h.bootstrapAllianceAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ ttlHours: 48 }),
    );
  });

  it.each([
    [[]],
    [['unknown-command']],
    [['bootstrap-alliance-admin', '--org', 'aurora']],
    [['bootstrap-alliance-admin', '--email', 'not-an-email', '--org', 'aurora']],
    [['bootstrap-alliance-admin', '--email', 'a@b.eu', '--org', 'Aurora!']],
    [['bootstrap-alliance-admin', '--email', 'a@b.eu', '--org', 'aurora', '--ttl-hours', '0']],
    [['bootstrap-alliance-admin', '--email', 'a@b.eu', '--org', 'aurora', '--ttl-hours', '1.5']],
    [['seed-organizations', 'extra']],
  ])('rejects %j with the usage exit code and runs nothing', async (argv) => {
    const h = handlers();
    const io = capture();
    await expect(runProgram(argv, h, io.output)).resolves.toBe(EXIT.USAGE);
    expect(h.seedOrganizations).not.toHaveBeenCalled();
    expect(h.bootstrapAllianceAdmin).not.toHaveBeenCalled();
    expect(io.out.join('')).toBe('');
    expect(io.err.join('')).not.toBe('');
  });

  it('prints help on --help with exit code 0', async () => {
    const io = capture();
    await expect(runProgram(['--help'], handlers(), io.output)).resolves.toBe(EXIT.OK);
    expect(io.out.join('')).toContain('bootstrap-alliance-admin');
  });
});

describe('bootstrap-alliance-admin', () => {
  const ORG = {
    id: '1c9f6c1e-6a3d-4c55-9a43-0f3d3c2b9a11',
    slug: 'aurora',
    org_type: 'alliance',
    keycloak_idp_alias: null,
  };
  const options = { email: 'chair@aurora.example', org: 'aurora', ttlHours: 24 };
  let keycloak: { countUsersWithRole: ReturnType<typeof vi.fn> };
  let invitations: {
    hasPendingInvitation: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let orgRows: unknown[];

  const command = () =>
    new BootstrapAllianceAdminCommand(
      createFakeDb(() => orgRows).db,
      keycloak as unknown as KeycloakAdminService,
      invitations as unknown as InvitationsService,
    );

  beforeEach(() => {
    orgRows = [ORG];
    keycloak = { countUsersWithRole: vi.fn().mockResolvedValue(0) };
    invitations = {
      hasPendingInvitation: vi.fn().mockResolvedValue(false),
      create: vi.fn().mockResolvedValue({
        invitation: { email: 'chair@aurora.example', expires_at: new Date('2026-10-15T12:00:00Z') },
        token: 't'.repeat(43),
        link: `https://campus.example.org/en/admin/accept#token=${'t'.repeat(43)}`,
        localUser: { id: 'kc', created: true, actionsEmailSent: true },
      }),
    };
  });

  it('creates a 24-hour alliance_admin invitation and prints only the link on stdout', async () => {
    const io = capture();
    await expect(command().run(options, io.output)).resolves.toBe(EXIT.OK);
    expect(invitations.create).toHaveBeenCalledWith({
      email: 'chair@aurora.example',
      role: 'alliance_admin',
      organizationId: ORG.id,
      invitedBy: BOOTSTRAP_ACTOR,
      invitedByOrgId: null,
      ttlHours: 24,
      sendEmail: false,
    });
    expect(BOOTSTRAP_ACTOR).toBe('system:bootstrap');
    expect(io.out).toEqual([
      `https://campus.example.org/en/admin/accept#token=${'t'.repeat(43)}\n`,
    ]);
    expect(io.err.join('')).toContain('Keycloak local user created');
  });

  it('refuses with exit 2 when a Keycloak user already holds alliance_admin', async () => {
    keycloak.countUsersWithRole.mockResolvedValue(1);
    const io = capture();
    await expect(command().run(options, io.output)).resolves.toBe(EXIT.REFUSED);
    expect(keycloak.countUsersWithRole).toHaveBeenCalledWith('alliance_admin');
    expect(invitations.create).not.toHaveBeenCalled();
    expect(io.out).toEqual([]);
    expect(io.err.join('')).toMatch(/Refused: 1 Keycloak user\(s\) already hold alliance_admin/);
  });

  it('refuses with exit 2 when a pending alliance_admin invitation exists', async () => {
    invitations.hasPendingInvitation.mockResolvedValue(true);
    const io = capture();
    await expect(command().run(options, io.output)).resolves.toBe(EXIT.REFUSED);
    expect(invitations.hasPendingInvitation).toHaveBeenCalledWith('alliance_admin');
    expect(invitations.create).not.toHaveBeenCalled();
    expect(io.out).toEqual([]);
  });

  it('fails with exit 1 when the organization is unknown', async () => {
    orgRows = [];
    const io = capture();
    await expect(command().run(options, io.output)).resolves.toBe(EXIT.FAILURE);
    expect(keycloak.countUsersWithRole).not.toHaveBeenCalled();
    expect(io.err.join('')).toContain('seed-organizations');
  });
});

describe('seed-organizations', () => {
  const read = (name: string) =>
    JSON.parse(readFileSync(new URL(`../../db/seed/${name}`, import.meta.url), 'utf8'));

  it('ships a valid Aurora seed file, which is also the default', () => {
    const aurora = organizationSeedFile.parse(read('organizations.aurora.json'));
    expect(read('organizations.json')).toEqual(read('organizations.aurora.json'));
    const slugs = aurora.organizations.map((o) => o.slug);
    expect(slugs).toEqual([
      'aurora',
      'uibk',
      'uice',
      'vua',
      'ude',
      'urv',
      'unina',
      'up',
      'cbs',
      'upec',
    ]);
    const alliance = aurora.organizations[0]!;
    expect(alliance).toMatchObject({
      org_type: 'alliance',
      is_partner: false,
      keycloak_idp_alias: null,
      schac_home_organization: 'aurora-universities.eu',
    });
    for (const partner of aurora.organizations.slice(1)) {
      expect(partner.is_partner).toBe(true);
      expect(partner.keycloak_idp_alias).toBe(partner.slug);
      expect(Object.keys(partner.name).length).toBeGreaterThanOrEqual(2);
      expect(partner.erasmus_code).toBeNull();
      expect(partner.pic).toBeNull();
    }
  });

  it('rejects duplicate slugs and unknown keys', () => {
    const org = { slug: 'aa', org_type: 'institution', name: { en: 'A' } };
    expect(organizationSeedFile.safeParse({ organizations: [org, org] }).success).toBe(false);
    expect(organizationSeedFile.safeParse({ organizations: [{ ...org, typo: 1 }] }).success).toBe(
      false,
    );
  });

  it('upserts by slug in one transaction, partners being their own partner', async () => {
    const results = [[{ inserted: true }], [{ inserted: false }], []];
    const fake = createFakeDb(() => results.shift());
    const seeds = organizationSeedFile
      .parse(read('organizations.aurora.json'))
      .organizations.slice(0, 3);
    const result = await new SeedOrganizationsCommand(fake.db).upsert(seeds);
    expect(result).toEqual({ created: ['aurora'], updated: ['uibk'], unchanged: ['uice'] });
    expect(fake.events.filter((e) => e !== 'query')).toEqual(['begin', 'commit']);
    const [alliance, uibk] = fake.queries.map(insertedValues);
    expect(alliance!['partner_id']).toBeNull();
    expect(uibk!['partner_id']).toBe(uibk!['id']);
    expect(fake.queries[0]!.sql).toContain('on conflict ("slug") do update set');
    expect(fake.queries[0]!.sql).toMatch(/is distinct from/i);
  });

  it('reports a dry run without writing', async () => {
    const fake = createFakeDb((q) =>
      q.sql.startsWith('select') ? [{ slug: 'aurora' }] : undefined,
    );
    const io = capture();
    const code = await new SeedOrganizationsCommand(fake.db).run(
      { file: DEFAULT_SEED_FILE, dryRun: true },
      io.output,
    );
    expect(code).toBe(EXIT.OK);
    expect(fake.queries.every((q) => q.sql.startsWith('select'))).toBe(true);
    expect(io.out.join('')).toContain('would update  aurora');
    expect(io.out.join('')).toContain('would create  urv');
  });

  it('fails with exit 1 on an invalid file', async () => {
    const io = capture();
    const code = await new SeedOrganizationsCommand(createFakeDb().db).run(
      { file: resolve('does-not-exist.json'), dryRun: false },
      io.output,
    );
    expect(code).toBe(EXIT.FAILURE);
  });
});

describe('seed-attribute-definitions', () => {
  const read = (name: string) =>
    JSON.parse(readFileSync(new URL(`../../db/seed/${name}`, import.meta.url), 'utf8'));

  it("ships Aurora's definitions, which are also the default", () => {
    const aurora = attributeDefinitionSeedFile.parse(read('attribute-definitions.aurora.json'));
    expect(read('attribute-definitions.json')).toEqual(read('attribute-definitions.aurora.json'));
    expect(JSON.stringify(read('attribute-definitions.json')['$comment'])).toContain(
      'To be confirmed by the Aurora Foundation',
    );
    const byKey = new Map(aurora.attribute_definitions.map((d) => [d.key, d]));
    expect([...byKey.keys()]).toEqual([
      'educational_hub',
      'sdg',
      'competence_framework',
      'micro_credential',
      'free_course',
      'enrolled_only',
      'open_to_alliance',
      'target_audience',
    ]);
    expect(byKey.get('sdg')!.options!.map((o) => o.value)).toEqual(
      Array.from({ length: 17 }, (_, i) => `sdg${String(i + 1).padStart(2, '0')}`),
    );
    expect(byKey.get('sdg')!.options![12]!.label.en).toBe('SDG 13: Climate action');
    expect(byKey.get('competence_framework')!.options!.map((o) => o.value)).toEqual([
      'louis',
      'none',
    ]);
    expect(byKey.get('target_audience')!.options!.map((o) => o.value)).toEqual([
      'students',
      'phd_candidates',
      'staff',
    ]);
    for (const key of ['micro_credential', 'free_course', 'enrolled_only', 'open_to_alliance']) {
      expect(byKey.get(key)).toMatchObject({ value_type: 'boolean', options: null });
    }
  });

  it('rejects duplicate keys, enums without options and booleans with options', () => {
    const def = { key: 'hub', value_type: 'boolean', label: { en: 'Hub' } };
    const parse = (defs: unknown[]) =>
      attributeDefinitionSeedFile.safeParse({ attribute_definitions: defs }).success;
    expect(parse([def])).toBe(true);
    expect(parse([def, def])).toBe(false);
    expect(parse([{ ...def, value_type: 'enum' }])).toBe(false);
    expect(parse([{ ...def, options: [{ value: 'a', label: { en: 'A' } }] }])).toBe(false);
    expect(parse([{ ...def, key: 'Bad-Key' }])).toBe(false);
  });

  it('upserts by key in one transaction and reports keys missing from the file', async () => {
    const results: unknown[][] = [
      [{ inserted: true }],
      [{ inserted: false }],
      [],
      [{ key: 'old' }],
    ];
    const fake = createFakeDb(() => results.shift());
    const defs = attributeDefinitionSeedFile
      .parse(read('attribute-definitions.aurora.json'))
      .attribute_definitions.slice(0, 3);
    const result = await new SeedAttributeDefinitionsCommand(fake.db).upsert(defs);
    expect(result).toEqual({
      created: ['educational_hub'],
      updated: ['sdg'],
      unchanged: ['competence_framework'],
      kept: ['old'],
    });
    expect(fake.events.filter((e) => e !== 'query')).toEqual(['begin', 'commit']);
    expect(fake.queries[0]!.sql).toContain('on conflict ("key") do update set');
    expect(fake.queries[0]!.sql).toMatch(/is distinct from/i);
    // jsonb arrays are sent as JSON text, not as PostgreSQL arrays.
    expect(typeof insertedValues(fake.queries[0]!)!['options']).toBe('string');
  });

  it('reports a dry run without writing', async () => {
    const fake = createFakeDb((q) => (q.sql.startsWith('select') ? [{ key: 'sdg' }] : undefined));
    const io = capture();
    const code = await new SeedAttributeDefinitionsCommand(fake.db).run(
      { file: DEFAULT_ATTRIBUTE_SEED_FILE, dryRun: true },
      io.output,
    );
    expect(code).toBe(EXIT.OK);
    expect(fake.queries.every((q) => q.sql.startsWith('select'))).toBe(true);
    expect(io.out.join('')).toContain('would update  sdg');
    expect(io.out.join('')).toContain('would create  free_course');
  });

  it('fails with exit 1 on an unreadable file', async () => {
    const io = capture();
    const code = await new SeedAttributeDefinitionsCommand(createFakeDb().db).run(
      { file: resolve('does-not-exist.json'), dryRun: false },
      io.output,
    );
    expect(code).toBe(EXIT.FAILURE);
  });
});
