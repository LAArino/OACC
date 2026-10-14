// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { AdminApiError, problemMessageKey, toAdminApiError } from '../app/utils/problem';

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
      'oecp.auth.missing_token',
      'oecp.auth.invalid_token',
      'oecp.auth.insufficient_acr',
      'oecp.auth.no_role',
      'oecp.auth.forbidden_role',
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
