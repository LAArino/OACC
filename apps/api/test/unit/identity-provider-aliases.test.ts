// SPDX-License-Identifier: EUPL-1.2
import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { toReference } from '../../src/catalogue/catalogue.mapper.js';
import {
  IDP_ALIASES_RETRY_MS,
  IDP_ALIASES_TTL_MS,
  IdentityProviderAliases,
} from '../../src/identity/identity-provider-aliases.js';
import { KeycloakAdminError } from '../../src/identity/keycloak-admin.error.js';
import type { KeycloakAdminService } from '../../src/identity/keycloak-admin.service.js';

function setup(list: ReturnType<typeof vi.fn>) {
  let now = 1_000_000;
  const aliases = new IdentityProviderAliases(
    { listIdentityProviders: list } as unknown as KeycloakAdminService,
    () => now,
  );
  return { aliases, advance: (ms: number) => (now += ms) };
}

describe('IdentityProviderAliases', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('keeps enabled, well-formed aliases and caches them for 5 minutes', async () => {
    const list = vi
      .fn()
      .mockResolvedValue([
        { alias: 'uibk', enabled: true },
        { alias: 'urv', enabled: false },
        { alias: 'example-partner', enabled: false },
        { alias: 'Weird Alias', enabled: true },
        { alias: 'ude' },
      ]);
    const { aliases, advance } = setup(list);
    expect([...((await aliases.enabled()) ?? [])]).toEqual(['uibk', 'ude']);
    advance(IDP_ALIASES_TTL_MS - 1);
    await aliases.enabled();
    expect(list).toHaveBeenCalledTimes(1);
    advance(2);
    await aliases.enabled();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('fails open: null without a known set, else the last known set; retries after 30 s', async () => {
    const list = vi.fn().mockRejectedValue(new KeycloakAdminError('list identity providers', 503));
    const { aliases, advance } = setup(list);
    expect(await aliases.enabled()).toBeNull();
    expect(await aliases.enabled()).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
    list.mockResolvedValue([{ alias: 'uibk', enabled: true }]);
    advance(IDP_ALIASES_RETRY_MS + 1);
    expect([...((await aliases.enabled()) ?? [])]).toEqual(['uibk']);
    list.mockRejectedValue(new Error('down'));
    advance(IDP_ALIASES_TTL_MS + 1);
    expect([...((await aliases.enabled()) ?? [])]).toEqual(['uibk']);
  });

  it('shares one Keycloak request between concurrent callers', async () => {
    const list = vi.fn().mockResolvedValue([{ alias: 'uibk', enabled: true }]);
    const { aliases } = setup(list);
    await Promise.all([aliases.enabled(), aliases.enabled(), aliases.enabled()]);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe('public reference idp_alias', () => {
  const org = (slug: string, alias: string | null) => ({
    id: '0a000000-0000-4000-8000-000000000002',
    slug,
    name: { en: slug },
    country_code: null,
    logo_url: null,
    website_url: null,
    org_type: 'institution',
    is_partner: true,
    parent_id: null,
    keycloak_idp_alias: alias,
  });
  const rows = (enabled: ReadonlySet<string> | null) =>
    toReference(
      {
        organizations: [org('uibk', 'uibk'), org('urv', 'urv'), org('aurora', null)],
        modes: [],
        isced: [],
        languages: [],
        definitions: [],
      },
      enabled,
    ).organizations.map((o) => o.idp_alias);

  it('publishes only aliases of enabled Keycloak identity providers', () => {
    expect(rows(new Set(['uibk']))).toEqual(['uibk', null, null]);
    expect(rows(null)).toEqual([null, null, null]);
  });
});
