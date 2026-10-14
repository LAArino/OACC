// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { integrationUpdateRequest, isValidCron } from '../src/index.js';

const codes = (input: unknown) => {
  const result = integrationUpdateRequest.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}:${i.message}`);
};

describe('integration settings schema', () => {
  it('fills defaults', () => {
    expect(integrationUpdateRequest.parse({})).toEqual({
      authoritative_channel: 'form',
      access_mode: null,
      oeapi_version: '5',
      consumer_profile: 'eduxchange',
      base_url: null,
      auth_scheme: 'none',
      api_key_header_name: null,
      surfeduhub_endpoint_id: null,
      schedule_cron: '0 3 * * *',
      schedule_timezone: 'Europe/Brussels',
      page_size: 100,
      max_requests_per_second: 2,
      withdraw_after_absences: 3,
      enabled: false,
    });
  });

  it('accepts the uibk direct configuration against the mock', () => {
    expect(
      codes({
        authoritative_channel: 'oeapi',
        access_mode: 'direct',
        base_url: 'http://oeapi-mock:8090',
        auth_scheme: 'basic',
        secret: 'oecp:oecp-mock-secret',
        enabled: true,
      }),
    ).toEqual([]);
  });

  it('mirrors the DDL cross-field checks', () => {
    expect(codes({ authoritative_channel: 'oeapi' })).toEqual([
      'access_mode:oecp.integration.access_mode_required',
    ]);
    expect(codes({ access_mode: 'direct' })).toEqual([
      'base_url:oecp.integration.base_url_required',
    ]);
    expect(codes({ access_mode: 'surfeduhub' })).toEqual([
      'surfeduhub_endpoint_id:oecp.integration.endpoint_id_required',
    ]);
    expect(codes({ auth_scheme: 'api_key_header', secret: 'k' })).toEqual([
      'api_key_header_name:oecp.integration.header_name_required',
    ]);
    expect(codes({ auth_scheme: 'basic', secret: 'nocolon' })).toEqual([
      'secret:oecp.integration.basic_secret_format',
    ]);
    expect(codes({ auth_scheme: 'bearer', secret: null })).toEqual([
      'secret:oecp.integration.secret_required',
    ]);
    expect(codes({ secret: 'x' })).toEqual(['secret:oecp.integration.secret_not_expected']);
    expect(codes({ enabled: true })).toEqual(['enabled:oecp.sync.channel_disabled']);
  });

  it('refuses malformed base URLs, unknown members and bad schedules', () => {
    for (const base_url of [
      'ftp://x.example',
      'https://user:pw@x.example',
      'https://x.example/?q=1',
      'https://x.example/#f',
      'x.example',
    ]) {
      expect(codes({ base_url }).length, base_url).toBeGreaterThan(0);
    }
    expect(codes({ base_url: 'https://oeapi.uibk.ac.at/v5' })).toEqual([]);
    expect(codes({ unknown: 1 }).length).toBe(1);
    expect(codes({ schedule_cron: '0 3 * *' }).length).toBe(1);
    expect(codes({ schedule_timezone: 'Mars/Olympus' }).length).toBe(1);
    expect(codes({ page_size: 5 }).length).toBe(1);
    expect(codes({ oeapi_version: '6' }).length).toBe(1);
  });

  it('validates five-field cron expressions', () => {
    for (const ok of [
      '0 3 * * *',
      '*/15 * * * *',
      '0 2 1-5 JAN-MAR MON-FRI',
      '30 4 * * 0,6',
      '0 0 1 1 7',
    ]) {
      expect(isValidCron(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      '* * * *',
      '60 * * * *',
      '0 24 * * *',
      '0 0 0 * *',
      '0 0 * 13 *',
      '5-1 * * * *',
      '*/0 * * * *',
      '0 3 * * * *',
      'a b c d e',
    ]) {
      expect(isValidCron(bad), bad).toBe(false);
    }
  });
});
