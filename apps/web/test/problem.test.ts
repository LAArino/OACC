// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  AdminApiError,
  asAdminApiError,
  parseRetryAfter,
  problemMessageKey,
  toAdminApiError,
} from '../app/utils/problem';

function problem(code: string, status: number, detail?: string) {
  return {
    type: 'about:blank',
    title: 'Some title',
    status,
    ...(detail ? { detail } : {}),
    instance: '/api/admin/v1/invitations/accept',
    errors: [{ code, severity: 'error', message: 'Some message' }],
  };
}

describe('toAdminApiError', () => {
  it('parses problem+json', () => {
    const error = toAdminApiError(410, problem('oecp.invitation.expired', 410, 'expired'));
    expect(error).toBeInstanceOf(AdminApiError);
    expect(error.status).toBe(410);
    expect(error.title).toBe('Some title');
    expect(error.detail).toBe('expired');
    expect(error.codes).toEqual(['oecp.invitation.expired']);
    expect(error.code).toBe('oecp.invitation.expired');
    expect(error.fromServer).toBe(true);
  });

  it('keeps the HTTP status when the body has none', () => {
    const error = toAdminApiError(403, { title: 'Forbidden' });
    expect(error.status).toBe(403);
    expect(error.codes).toEqual([]);
    expect(error.detail).toBeUndefined();
  });

  it('ignores malformed errors[] entries', () => {
    const error = toAdminApiError(400, { title: 'Bad', errors: [{}, 'x', { code: 'oecp.a' }] });
    expect(error.codes).toEqual(['oecp.a']);
  });

  it('handles non-problem bodies and network failures', () => {
    expect(toAdminApiError(502, '<html>')).toMatchObject({
      status: 502,
      codes: [],
      fromServer: false,
    });
    expect(toAdminApiError(undefined, undefined)).toMatchObject({ status: 0, codes: [] });
  });
});

describe('problemMessageKey', () => {
  it.each([
    ['oecp.invitation.expired', 410, 'problem.invitationExpired'],
    ['oecp.invitation.invalid', 404, 'problem.invitationInvalid'],
    ['oecp.invitation.invalid', 409, 'problem.invitationInvalid'],
    ['oecp.invitation.mismatch', 403, 'problem.invitationMismatch'],
    ['oecp.invitation.idp_not_enabled', 409, 'problem.invitationIdpNotEnabled'],
    ['oecp.auth.invalid_token', 401, 'problem.signInAgain'],
    ['oecp.auth.insufficient_acr', 401, 'problem.insufficientAcr'],
    ['oecp.auth.unknown_organization', 403, 'problem.forbidden'],
  ])('maps %s (%i) to %s', (code, status, key) => {
    expect(problemMessageKey(toAdminApiError(status, problem(code, status)))).toBe(key);
  });

  it('falls back on the status', () => {
    expect(problemMessageKey(new AdminApiError({ status: 0, title: 'x' }))).toBe('problem.network');
    expect(problemMessageKey(new AdminApiError({ status: 401, title: 'x' }))).toBe(
      'problem.signInAgain',
    );
    expect(problemMessageKey(new AdminApiError({ status: 500, title: 'x' }))).toBe(
      'problem.generic',
    );
  });

  it('uses the first known code', () => {
    const error = new AdminApiError({
      status: 403,
      title: 'x',
      codes: ['oecp.unknown', 'oecp.invitation.mismatch'],
    });
    expect(problemMessageKey(error)).toBe('problem.invitationMismatch');
  });
});

describe('translations', () => {
  it('has an English message for every key', async () => {
    const { readFile } = await import('node:fs/promises');
    const en = JSON.parse(
      await readFile(new URL('../i18n/locales/en.json', import.meta.url), 'utf8'),
    ) as { problem: Record<string, string> };
    const codes = [
      'oecp.invitation.expired',
      'oecp.invitation.invalid',
      'oecp.invitation.mismatch',
      'oecp.invitation.idp_not_enabled',
      'oecp.auth.missing_token',
      'oecp.auth.invalid_token',
      'oecp.auth.insufficient_acr',
      'oecp.auth.no_role',
      'oecp.auth.forbidden_role',
      'oecp.request.not_found',
      'oecp.sync.channel_disabled',
      'oecp.csv.file_too_large',
      'oecp.csv.rate_limited',
      'oecp.csv.no_files',
      'oecp.csv.unexpected_file',
      'oecp.integration.not_configured',
      'oecp.media.too_large',
      'oecp.media.unsupported_type',
      'oecp.media.invalid_image',
      'oecp.media.alt_required',
      'oecp.media.not_found',
    ];
    const keys = [
      ...codes.map((code) => problemMessageKey({ status: 400, codes: [code] })),
      ...[0, 401, 500].map((status) => problemMessageKey({ status, codes: [] })),
    ];
    for (const key of keys) {
      expect(en.problem[key.replace(/^problem\./, '')], key).toBeTypeOf('string');
    }
  });
});

describe('course image problems [DL 27]', () => {
  it.each([
    ['oecp.media.too_large', 413, 'problem.mediaTooLarge'],
    ['oecp.media.unsupported_type', 415, 'problem.mediaUnsupportedType'],
    ['oecp.media.invalid_image', 422, 'problem.mediaInvalidImage'],
    ['oecp.media.alt_required', 422, 'problem.mediaAltRequired'],
    ['oecp.media.not_found', 404, 'problem.mediaNotFound'],
  ])('maps %s (%i) to %s', (code, status, key) => {
    expect(problemMessageKey(toAdminApiError(status, problem(code, status)))).toBe(key);
  });
});

describe('CSV upload problems', () => {
  it.each([
    ['oecp.sync.channel_disabled', 409, 'problem.channelDisabled'],
    ['oecp.csv.file_too_large', 413, 'problem.fileTooLarge'],
    ['oecp.csv.rate_limited', 429, 'problem.uploadRateLimited'],
    ['oecp.csv.no_files', 400, 'problem.noFiles'],
  ])('maps %s to a message', (code, status, key) => {
    expect(problemMessageKey(toAdminApiError(status, problem(code, status)))).toBe(key);
  });

  it('keeps the problem body with its extension members and Retry-After', () => {
    const body = {
      ...problem('oecp.csv.invalid_date', 422),
      title: 'Upload validation failed',
      sync_run_id: 'run-1',
      error_count: 3,
    };
    const error = toAdminApiError(422, body, '120');
    expect(error.problem).toMatchObject({ sync_run_id: 'run-1', error_count: 3, status: 422 });
    expect(error.problem?.errors).toHaveLength(1);
    expect(error.retryAfterSeconds).toBe(120);
    expect(toAdminApiError(500, 'oops').problem).toBeUndefined();
  });

  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
    const inAMinute = new Date(Date.now() + 60_000).toUTCString();
    expect(parseRetryAfter(inAMinute)).toBeGreaterThanOrEqual(58);
  });

  it('wraps anything thrown', () => {
    const known = new AdminApiError({ status: 409, title: 'x' });
    expect(asAdminApiError(known)).toBe(known);
    expect(asAdminApiError(new Error('boom')).status).toBe(0);
  });
});
