// SPDX-License-Identifier: EUPL-1.2
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMailer,
  LogMailer,
  SmtpMailer,
  smtpTransportOptions,
} from '../../src/admin/invitations/mailer.js';

describe('mailer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('relays without authentication by default, STARTTLS when offered', () => {
    expect(smtpTransportOptions({ host: 'smtp.urv.cat', port: 25, from: 'a@b.c' })).toEqual({
      host: 'smtp.urv.cat',
      port: 25,
      secure: false,
    });
  });

  it('authenticates and requires STARTTLS when configured; port 465 is implicit TLS', () => {
    expect(
      smtpTransportOptions({
        host: 'smtp.urv.cat',
        port: 587,
        from: 'a@b.c',
        user: 'oecp',
        password: 'pw',
        requireStartTls: true,
      }),
    ).toEqual({
      host: 'smtp.urv.cat',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'oecp', pass: 'pw' },
    });
    expect(
      smtpTransportOptions({ host: 'h', port: 465, from: 'a@b.c', requireStartTls: true }),
    ).toEqual({ host: 'h', port: 465, secure: true });
  });

  it('chooses SMTP with a host and the log fallback without', () => {
    expect(createMailer({ host: 'smtp.urv.cat', port: 25, from: 'a@b.c' })).toBeInstanceOf(
      SmtpMailer,
    );
    expect(createMailer({ host: '', port: 25, from: 'a@b.c' })).toBeInstanceOf(LogMailer);
  });

  it('logs only a one-line warning; the link goes to debug level', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const link = 'https://campus.example.org/en/admin/accept#token=abc';
    await new LogMailer().send({ to: 'ana@urv.cat', subject: 'Invitation', text: `Open ${link}` });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'invitation link logged (no SMTP configured)',
    );
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(link);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('ana@urv.cat');
    expect(String(debug.mock.calls[0]?.[0])).toContain(link);
  });
});
