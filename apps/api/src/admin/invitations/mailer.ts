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
}

/** Plain-text mail through the host institution's relay (no SMTP auth, STARTTLS if offered). */
export class SmtpMailer implements MailerPort {
  private readonly transport: Transporter;

  constructor(private readonly options: SmtpMailerOptions) {
    this.transport = createTransport({
      host: options.host,
      port: options.port,
      secure: options.port === 465,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.options.from, ...message });
  }
}

/** Development fallback when `SMTP_HOST` is empty: the message is logged at warn level. */
export class LogMailer implements MailerPort {
  private readonly logger = new Logger(LogMailer.name);

  async send(message: MailMessage): Promise<void> {
    this.logger.warn(
      `SMTP_HOST is empty, e-mail not sent. To: ${message.to}; Subject: ${message.subject}\n${message.text}`,
    );
  }
}

export function createMailer(options: SmtpMailerOptions): MailerPort {
  return options.host ? new SmtpMailer(options) : new LogMailer();
}
