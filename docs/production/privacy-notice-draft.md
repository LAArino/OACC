<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Privacy notice draft: Aurora pilot of OACC

**Editor's preface (not part of the notice).** This is a draft for the Aurora Foundation, written from the [RoPA](ropa.md) and the [DPIA outline](dpia.md) for the pilot at `https://lspurv.urv.cat`. It is not legal advice and takes no legal decision. Every fact that the sources do not contain is marked `[TO COMPLETE: …]` (a value someone must supply) or `[TO CONFIRM: …]` (a statement the sources support only in part). Search for both strings before publishing.

Before publishing:

1. The Foundation, with its DPO, reviews and approves the text, and completes the RoPA entries it depends on (legal basis per activity, hosting and backup locations, contacts). If the RoPA changes, this text changes with it.
2. Publish the text below the rule: copy it verbatim, without this preface and without the two SPDX comment lines at the top of this file, to `deploy/compose/branding/privacy.en.md` on the server (or to `privacy.<lang>.md` for another language; English is the fallback and is mandatory), readable by uid 1000, then run `docker compose up -d web`. The portal serves it at `/en/privacy` (404 until the English file exists) and adds the footer link. Use only the Markdown the portal renders: headings, paragraphs, bold and italic, lists, links and horizontal rules; no tables and no raw HTML.
3. Put `https://<portal host>/en/privacy` as the `privacyStatementUrl` of the SAML service provider metadata (required by the Data Protection Code of Conduct v2; [sp-metadata.md](../../identity/keycloak/scripts/sp-metadata.md)).
4. Keep the text accurate: review it with the RoPA at least yearly and whenever the deployment changes (switching on the dormancy and account clean-up jobs, a new backup site, a new partner, the Phase 2 wallet login).

---

# Privacy notice

Version 0.1 (draft), [TO COMPLETE: date of publication]. This notice explains how personal data is handled by the Aurora course portal (the "portal") run for the Aurora alliance at https://lspurv.urv.cat, during its pilot.

## 1. In short

- The portal publishes the course catalogue of the Aurora alliance. It does not handle applications and it stores no data about students.
- If you only browse the catalogue, the portal sets no cookies, runs no analytics and uses no third-party tracking. Its server logs do not contain your IP address by default.
- The portal does hold personal data about two groups of people: the teaching staff named on published courses, and the administrators who maintain the catalogue.

## 2. Who is responsible

- **Controller of the published catalogue and of the administrators' accounts:** Aurora Foundation, [TO COMPLETE: legal name, registered address, registration number]. Contact: [TO COMPLETE: representative or functional mailbox]. Data protection officer: [TO COMPLETE: name or function, contact; or state that none is designated].
- **Processor (hosting):** Universitat Rovira i Virgili (URV), [TO COMPLETE: address, DPO contact]. URV runs the portal's infrastructure on behalf of the Foundation under a data processing contract (GDPR art. 28) dated [TO COMPLETE: date]. It acts only on the Foundation's instructions.
- **Partner universities:** the universities of the alliance (UIBK, UICE, VUA, UDE, URV, UNINA, UP, CBS and UPEC) supply the course data. Each is an independent controller of the data it supplies about its own staff, such as instructors and contact mailboxes, and has its own privacy notice for them. The Foundation is the controller of the catalogue as published on this portal. There is no joint controllership between them.

## 3. What personal data we process, about whom, and why

### 3.1 Administrators who sign in

The people who maintain the catalogue are staff of the partner universities and of the Foundation.

- **Data:** name, e-mail address, home organization, a persistent identifier assigned by your home institution's identity provider (for federated sign-in), your role and organization in the portal, and, for accounts created locally, a password (stored only as a hash) and the secret of your second factor. The portal also records when you last used the administration panel (at most once an hour) and keeps an audit record of administrative actions.
- **Where it comes from:** from you, or from your home institution's identity provider when you sign in through your university.
- **Purpose:** to authenticate administrators, require a second factor, assign and withdraw roles, and keep the catalogue secure.
- **Legal basis:** [TO COMPLETE: the Foundation chooses between GDPR art. 6(1)(e), a task carried out in the public interest, with its basis in law, and art. 6(1)(f), legitimate interests].

### 3.2 Invitations

When an administrator is invited, the portal keeps the invited person's e-mail address, the role and organization offered, who invited them, a one-way fingerprint of the invitation link (never the link itself), and the relevant dates. It sends the invitation by e-mail through a mail relay run by [TO COMPLETE: relay operator].

- **Purpose:** to onboard a named person as administrator of one organization.
- **Legal basis:** [TO COMPLETE: same as 3.1].

### 3.3 Security and audit records

- **Data:** the audit record of administrative actions (who did what, to which item, when; for invitations and withdrawn access it includes the administrator's e-mail address, as evidence of who received or lost access); sign-in and administration events of the identity service, which include the IP address used to sign in; the technical logs of the portal and its interface, with one line per request (method, address requested, result, duration, request number and, for administrators, the account identifier). These logs do not record the visitor's IP address or browser identification by default. [TO CONFIRM: whether the web server's access log, which would record IP addresses, and the optional salted hash of client addresses are switched on in this deployment.]
- **Purpose:** accountability, detection and investigation of security incidents, and troubleshooting.
- **Legal basis:** [TO COMPLETE: art. 6(1)(f) or 6(1)(e); art. 6(1)(c) if a law requires the logs].

### 3.4 Teaching staff and contacts on published courses

- **Data:** the names (or role descriptions) of the instructors of a course, as the partner university already publishes them for the same course, and the functional contact mailbox of the course or of the university, which should not be a personal mailbox. Course texts written by the universities may also mention people, as published by them. We do not publish instructors' e-mail addresses or phone numbers, and the portal never looks persons up.
- **Where it comes from:** from the partner universities, by an automatic exchange between systems, by file upload, or by a web form filled by their administrators. We do not collect it from you directly.
- **Purpose:** to publish the alliance's course offer to the public, through the portal and the open read API, so that students can choose courses.
- **Legal basis:** [TO COMPLETE: the Foundation confirms art. 6(1)(e), public interest, proposed because the universities already publish the same data for the same purpose, and names the law that gives the universities and their alliance this task].
- **Who informs the staff:** [TO COMPLETE: the partner university, the Foundation, or both]. This notice is that information where the Foundation provides it (GDPR art. 14).

### 3.5 Maintenance of access

Access to the administration panel is removed after 180 days of inactivity, and the account of a person who no longer holds any role is deleted 12 months after the role was removed. For this the portal uses the last activity, roles, organization, account creation date and the date and kind of the last role removal. The purpose is to keep only the accounts that are needed. Legal basis: [TO COMPLETE: same as 3.1]. During the pilot these two automatic clean-ups only list what they would do and delete nothing, until the Foundation switches them on [TO COMPLETE: date]; until then accounts and access stay longer than the figures above.

### 3.6 Backups

All of the data above, including the identity service's data, is copied to backups so the service can be restored after a failure. The backup site is [TO COMPLETE: in-house or external provider, and its location].

### 3.7 Visitors of the portal

We do not process personal data about visitors for statistics, profiling or advertising. The portal sets no cookies and loads no third-party analytics or tracking. Like any web server, it necessarily receives your IP address to answer your request; by default it does not write that address to its logs. [TO CONFIRM: web server access log off; see 3.3.]

## 4. Who receives the data

- **The public:** the course data in 3.4 is published on the portal, in its sitemap and in an open interface (API) that anyone can use; search engines and other reusers may copy it. This is the purpose of the catalogue.
- **The identity federation and your home university:** when you sign in as an administrator through your university, the portal exchanges data with your home identity provider through the academic identity federations (SIR2 and, through it, eduGAIN). The portal asks only for your e-mail address, home organization, names and persistent identifier.
- **URV, as hosting operator and processor,** and its mail relay [TO COMPLETE: relay operator].
- **Administrators of the Foundation and of the partner universities,** who can see the names, e-mail addresses and last sign-in of the administrators of the organizations they manage, and the history of administrative actions.
- **The backup site** [TO COMPLETE: provider, if external: it would be a sub-processor].
- **Transfers outside the EU/EEA:** none are planned; the hosting, the partner universities and the data sources are in the EU/EEA (Iceland through the EEA Agreement). [TO CONFIRM: hosting and backup locations, and that the mail relay does not route outside the EEA.] Publication on the internet is accessible worldwide; [TO COMPLETE: DPO assessment].

## 5. How long we keep the data

- **Invitations:** the link is valid for 1 to 7 days; the invitation record is deleted 12 months after acceptance, revocation or expiry.
- **Audit records of administrative actions:** 36 months.
- **Administration activity:** 12 months after the last activity, and removed with the account.
- **Sign-in and administration events of the identity service:** 90 days.
- **Technical logs of the portal and its interface:** 90 days; the web server's access log, if switched on, 30 days. [TO CONFIRM: periods as configured in this deployment.]
- **Administrators' accounts:** while the person holds a role; deleted 12 months after the last role was removed (including removal for inactivity), once the clean-up is switched on (see 3.5). Access is removed after 180 days of inactivity.
- **Records of automatic maintenance and synchronisation runs:** 12 months for maintenance runs and 24 months for synchronisation runs.
- **Source copies of harvested or uploaded course data:** 12 months (up to 13), without person records other than the instructors' names; uploaded files, 90 days; error reports, 12 months.
- **Instructors and contacts on courses:** while the course is published. A course deleted in the web form is purged 12 months after deletion. [TO COMPLETE: the Foundation's rule for instructors of withdrawn courses.]
- **Backups:** 35 days. Data deleted earlier survives in backups until they expire.

## 6. Your rights

Under the GDPR you may ask the Foundation for access to your data, rectification, erasure, restriction of processing, and you may object to processing based on public interest or legitimate interests (art. 15 to 18 and 21). Portability (art. 20) does not apply to these activities, which do not rest on your consent or a contract.

- **To exercise them,** write to [TO COMPLETE: functional mailbox or address of the Foundation] or to its data protection officer [TO COMPLETE: contact]. We reply within one month. For teaching staff listed on a course, the Foundation informs the partner university concerned [TO COMPLETE: within how many days], the entry on the portal can be corrected or removed at once, and the university corrects the source. You may also contact your university directly.
- **Automated decisions:** no decision with legal effect is taken about you solely by automated means, apart from the automatic withdrawal of an administrator's access after 180 days of inactivity (once switched on, see 3.5). [TO CONFIRM.]
- **Complaints:** you have the right to lodge a complaint with a supervisory authority, in particular in the member state of your habitual residence, place of work or place of the alleged infringement. For the Foundation and URV that is [TO COMPLETE: supervisory authority of the Foundation, and the Spanish Agencia Española de Protección de Datos for URV, if confirmed].

## 7. Providing the data

Teaching staff do not have to provide data to us. Administrators must give the data in 3.1 to be able to sign in; without it no account can be created.

## 8. Changes to this notice

We will update this notice when the processing changes and publish the new version here with its date. Version 0.1 (draft), [TO COMPLETE: date]. Previous versions: none.
