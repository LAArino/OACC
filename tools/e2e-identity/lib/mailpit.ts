// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
/** Mailpit (profile `dev`) catches the api's invitations and Keycloak's set-up e-mails. */
import { AUTH, MAILPIT } from './config';
import { sleep } from './util';

interface MailSummary {
  ID: string;
  Subject: string;
  Created: string;
  To: { Address: string }[];
}

/** Newest message to `to` created after `since` whose subject matches, with its link. */
async function linkFromMail(
  to: string,
  since: number,
  subject: RegExp,
  link: RegExp,
  timeoutMs = 20000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`to:"${to}"`);
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${query}&limit=20`);
    if (!res.ok) throw new Error(`Mailpit search: HTTP ${res.status}`);
    const { messages } = (await res.json()) as { messages: MailSummary[] };
    const m = messages.find(
      (x) =>
        subject.test(x.Subject) &&
        new Date(x.Created).getTime() >= since - 2000 &&
        x.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()),
    );
    if (m) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as {
        Text: string;
      };
      const found = full.Text.match(link)?.[0];
      if (found) return found;
    }
    await sleep(500);
  }
  throw new Error(`no e-mail "${subject.source}" to ${to} in Mailpit within ${timeoutMs} ms`);
}

/** The invitation link (`…/admin/accept#token=…[&idp=…]`) e-mailed by the api. */
export const invitationLinkFromMail = (to: string, since: number) =>
  linkFromMail(to, since, /^Invitation/, /https:\/\/\S+\/admin\/accept#\S+/);

/** Keycloak's execute-actions link (set a password, configure TOTP). */
export const setupLinkFromMail = (to: string, since: number) =>
  linkFromMail(
    to,
    since,
    /Update Your Account/i,
    new RegExp(
      `${AUTH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/realms/oecp/login-actions/action-token\\?[^\\s"<>]+`,
    ),
  );

/** Whether any message to `to` arrived after `since` (used to assert that nothing was sent). */
export async function mailsTo(to: string, since: number): Promise<number> {
  const query = encodeURIComponent(`to:"${to}"`);
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${query}&limit=20`);
  const { messages } = (await res.json()) as { messages: MailSummary[] };
  return messages.filter((x) => new Date(x.Created).getTime() >= since - 2000).length;
}
