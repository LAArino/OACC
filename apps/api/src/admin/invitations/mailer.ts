// SPDX-License-Identifier: EUPL-1.2
import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailerPort {
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol('MAILER');

export interface SmtpMailerOptions {
  host: string;
  port: number;
  from: string;
  /** SMTP AUTH user; with `password`. Absent: relay by source address. */
  user?: string | undefined;
  password?: string | undefined;
  /**
   * true: STARTTLS is required (the send fails if the relay does not offer it);
   * false: STARTTLS is used when offered. Port 465 is implicit TLS either way.
   */
  requireStartTls?: boolean;
}

/** nodemailer transport options of {@link SmtpMailer} (exported for tests). */
export function smtpTransportOptions(options: SmtpMailerOptions) {
  return {
    host: options.host,
    port: options.port,
    secure: options.port === 465,
    ...(options.requireStartTls && options.port !== 465 ? { requireTLS: true } : {}),
    ...(options.user ? { auth: { user: options.user, pass: options.password ?? '' } } : {}),
  };
}

/** Plain-text mail through the host institution's relay. */
export class SmtpMailer implements MailerPort {
  private readonly transport: Transporter;

  constructor(private readonly options: SmtpMailerOptions) {
    this.transport = createTransport(smtpTransportOptions(options));
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.options.from, ...message });
  }
}

/**
 * Fallback when `SMTP_HOST` is empty (development; in production only with
 * `OECP_MAIL_LOG_LINKS=true`, checked at start-up): nothing is sent. One warn
 * line says so; the message itself, which carries the live invitation link, is
 * logged at debug level only (`LOG_LEVEL=debug` to see it).
 */
export class LogMailer implements MailerPort {
  private readonly logger = new Logger(LogMailer.name);

  async send(message: MailMessage): Promise<void> {
    this.logger.warn(
      `E-mail not sent, invitation link logged (no SMTP configured): ${message.subject}`,
    );
    this.logger.debug(`To: ${message.to}; Subject: ${message.subject}\n${message.text}`);
  }
}

export function createMailer(options: SmtpMailerOptions): MailerPort {
  return options.host ? new SmtpMailer(options) : new LogMailer();
}
