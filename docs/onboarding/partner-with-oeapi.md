<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Guide B: a university with an OEAPI v5 endpoint

For universities that already run an Open Education API (OEAPI, formerly OOAPI) **v5** endpoint, typically the one eduXchange harvests. In Aurora: Universität Innsbruck, University of Iceland, Vrije Universiteit Amsterdam and Universität Duisburg-Essen [DL 4, DL 13]. OACC then pulls your courses once a day; nobody types them twice. Technical details of every request and field: [API integration guide](../guides/api-integration.md). Overview: [onboarding README](README.md).

> **Before you start**
>
> - The alliance has finished [Guide A](alliance.md) and invited your partner admin.
> - Your endpoint speaks OEAPI **v5.0** (v6 is not supported in 0.10.0) over `https` on port 443 at a public address.
> - You know which **consumer profile** returns the courses meant for the alliance (usually `eduxchange`).
> - Elapsed time: 2–8 weeks, most of it for the access agreement; the technical work is 1–2 days.

## What OACC needs from you

OACC connects **directly** to your endpoint, not through SURFeduhub [DL 14]. SURFeduhub access exists only as a fallback the alliance operator would have to configure.

| Item | Detail |
|---|---|
| Base URL | For example `https://oeapi.uni.example/v5`; a path prefix is fine; `https` on 443 only |
| Credential | HTTP Basic (`username:password`), a bearer token, an API key in a header you name, or none |
| IP allowlist entry | The OACC server's outbound address, from the hosting operator |
| Consumer profile | OACC adds `consumer=<profile>` to every request; default `eduxchange`, or another value your endpoint supports |
| Data selection | OACC publishes **everything** your endpoint returns for that profile. It does not filter by `alliances.name`. Make sure the profile returns only the courses you want in the alliance catalogue |

OACC reads `GET /organizations?organizationType=root`, `/courses`, `/courses/{id}/offerings` and `/offerings/{id}?expand=academicSession`. It never calls person or enrolment endpoints and never asks for `expand=coordinators`; if your course items already contain coordinators **with their names**, OACC keeps only those names, as the course's instructors (below).

## 1. Agree the channel

**Who:** partner admin with the alliance. **Time:** one meeting.

Confirm that your organization's authoritative channel will be `oeapi`. From then on your courses are created and changed only in your own system; CSV uploads are refused and the web form can only add overrides (see step 9). If your university entered courses by CSV or in the web form before, the harvest takes over the records whose course codes match your `primaryCode`s; a record that was deleted in OACC **comes back** when the harvest returns its code (written as new, its old overrides dropped).

## 2. Sign the access agreement

**Who:** Foundation and the partner's legal or data protection office. **Time:** 2–8 weeks.

A bilateral agreement between the alliance (as data controller) and your university [DL 14]. It should record:

- [ ] **Consent to reuse** the data you tag for eduXchange and to republish it in the public catalogue and through OACC's anonymous read API (`/oeapi/v5`) (spec §10).
- [ ] Scope: which profile and which courses.
- [ ] Credential handling: who issues it, how it is sent, rotation and revocation.
- [ ] Technical and data contacts on both sides, and how to end the arrangement.

OACC provides no agreement template in 0.10.0; the same items, with the controller's side, are in section B of the [art. 28 checklist](../production/art28-processor-checklist.md#b-access-agreement-with-each-harvested-partner).

## 3. Issue a credential and open the firewall

**Who:** partner IT. **Time:** 1–2 days.

1. Create a **read-only** credential dedicated to OACC.
2. Add the OACC outbound IP address to your allowlist.
3. Test from outside your network:

   ```sh
   curl -s -u 'oecp:<password>' -H 'Accept: application/json' \
     'https://oeapi.uni.example/v5/courses?consumer=eduxchange&pageSize=1'
   ```

   You should get a v5 page (`items`, `hasNextPage`) whose courses have a `primaryCode`.
4. Send the base URL and the credential to whoever enters the settings (step 5) over a secure channel. OACC stores the credential encrypted and never shows it again.

## 4. Accept the invitation

**Who:** partner admin. **Time:** 15 minutes.

> **Local accounts** (your university is outside eduGAIN, or its identity provider is not connected yet): two e-mails, Keycloak's set-up e-mail and OACC's invitation link. **Federated**: one e-mail, the invitation link, which takes you to your university's login. Which one applies, and what your identity team must provide: [identity-paths.md](identity-paths.md).

With local accounts, follow the two e-mails: Keycloak's (enrol a TOTP app, then set a password of at least 12 characters), then OACC's invitation link (sign in; the page confirms the acceptance; sign out and in again). Local accounts are the permanent mode of a university outside eduGAIN, and the interim mode of one in eduGAIN until its identity provider is connected to OACC and tested; once it is, the invitation e-mail is the only one and its link takes you to *Sign in through your university*. A page reload keeps you signed in while your login session is alive (30 minutes idle, 8 hours at most).

![Keycloak "Mobile Authenticator Setup": the warning that you need to set up Mobile Authenticator to activate your account, the list of apps, the barcode step with the QR code masked as a black square, Unable to scan?, and the empty One-time code and Device Name fields with Submit](../images/onboarding-keycloak-totp.png)

![Keycloak "Update password" page with the empty New Password and Confirm password fields, the Sign out from other devices box and the Submit button](../images/onboarding-keycloak-set-password.png)

![Accept invitation page with the Sign in button, before signing in](../images/admin-invitation-accept.png)

## 5. Enter the integration settings

**Who:** partner admin (or the alliance admin). **Time:** 30 minutes.

Open the admin dashboard > *Integration settings* (an alliance admin first picks your organization) and fill in the *Settings* form:

| Section | Value |
|---|---|
| Authoritative channel | *OEAPI harvest* |
| Access mode and endpoint | *Direct*; *Base URL* `https://oeapi.uni.example/v5`; *Consumer profile* `eduxchange` unless agreed otherwise |
| Credentials | *Authentication* (*Basic*, *Bearer token*, *API key in a header* with its header name, or *None*) and the credential from step 3 |
| Schedule | *Daily at 03:00* (default), another preset or a cron expression, and its time zone (default Europe/Brussels) |
| Limits | Page size 100, 2 requests per second, withdraw after 3 absences (defaults) |
| Harvesting | Leave *Harvest on the schedule* **off** for now (step 8) |

Choose *Save settings*. The form checks every field before saving and lists what to fix. The credential is stored encrypted and never shown again: the page only says *A credential is stored*, and later you can keep, replace or delete it.

![Integration settings of the University of Innsbruck with the Host approval card showing the approved host](../images/manual-integration.png)

## 6. Approve the host

**Who:** alliance admin. **Time:** 5 minutes.

The *Host approval* card on the *Integration settings* page shows the host of your base URL as *Waiting for approval*. The alliance admin confirms with you, through a known contact, that the host is yours, then opens the same page and chooses *Approve host …* and confirms. Partner admins see a request to ask an alliance admin instead of the button. Nothing is requested from your endpoint before this. Changing the host later clears the approval; changing only the path keeps it.

![Integration settings of the University of Innsbruck on the development stack: Current settings (OEAPI harvest, Direct, harvesting No, last run None) and the Host approval card with host oeapi-mock:8090, Approval "Waiting for approval" and the button "Approve host oeapi-mock:8090"](../images/onboarding-host-waiting-approval.png)

## 7. Test the connection

**Who:** partner admin or alliance admin, with partner IT on call. **Time:** 15 minutes.

Under *Test and run*, choose *Test connection*. OACC calls `GET /` and `GET /courses?pageSize=1` with the **saved** settings (save your changes first). *The connection works* shows the service contact and documentation, the number of courses if your endpoint reports it and the first course code; *The connection failed* shows the error code, the HTTP status and a hint:

![The same page after approval, full page: Host approval "Approved" with the approval time, the Settings form (OEAPI harvest, Direct, base URL http://oeapi-mock:8090, consumer eduxchange, a stored Basic credential, daily schedule, limits, Harvest on the schedule unchecked), Test and run with Test connection and Sync now, and the result "The connection works" with the target, 17 ms, service contact oeapi-mock@uibk.example, specification and documentation links, courses available Yes and first course code 201420](../images/onboarding-integration-test-ok.png)

| `error.code` | Usual cause |
|---|---|
| `oecp.oeapi.unauthorized` | Wrong credential or scheme |
| `oecp.oeapi.unreachable`, `oecp.oeapi.timeout` | Allowlist not open, DNS, firewall |
| `oecp.oeapi.address_refused` | The name resolves to a private address |
| `oecp.oeapi.invalid_payload` | `/courses` is not a v5 page (wrong path prefix or version) |

*The connection cannot be tested yet* means a setting is missing or the host is not approved yet.

## 8. Run the first harvest and read the report

**Who:** partner admin. **Time:** an hour, plus fixes at the source.

1. Choose *Sync now* under *Test and run*. It works while *Harvest on the schedule* is still off, needs *OEAPI harvest* as the saved channel and an approved host, and is limited to once every 15 minutes (the page says when you can try again) and to one run at a time.

   ![Lower part of the Integration settings page: stored credential, schedule, limits, Harvest on the schedule, Save settings, Test connection and Sync now](../images/manual-integration-test-run.png)

2. Choose *Follow the run*, or open *Sync history* and the run. Status is `succeeded` (nothing rejected), `partial` (some records rejected) or `failed` (nothing processed). Counters show created, updated, unchanged, rejected and withdrawn records.

   ![Sync run page: summary with status, channel, trigger, times and counters, then the list of errors and warnings](../images/manual-sync-run.png)

3. Read the errors and warnings, each with a JSON Pointer into your data. Errors reject the course or offering (or stop the run); warnings only report what OACC ignored or adjusted. The most common ones:

| Code | Severity | Meaning and fix |
|---|---|---|
| `oecp.oeapi.english_missing` | warning | No English `name`: the course is stored as **draft** and not shown. Add an English name |
| `oecp.oeapi.invalid_isced` | warning | A `fieldsOfStudy` value is not an ISCED-F code; it is ignored |
| `oecp.oeapi.unknown_isced_field` | warning | A `fieldsOfStudy` code whose first two digits are not an ISCED-F broad field; it is ignored |
| `oecp.oeapi.delivery_mode_dropped` | warning | Some `modeOfDelivery` values have no OACC mapping and are ignored; the others are kept |
| `oecp.oeapi.invalid_coordinators` | warning | `coordinators` is not a list; ignored, the course is kept (without instructors from it) |
| `oecp.oeapi.multiple_roots` | warning | Your endpoint returned several root organizations; OACC used the first |
| `oecp.oeapi.duplicate_entity` | warning | A course code (or an offering code within a course) appears twice; the first item is used, the repeat ignored |
| `oecp.content.session_ignored` | warning | The offering's academic session is invalid or unknown; the offering is stored without it |
| `oecp.oeapi.insecure_link` | warning | A `link` is not `https`; it is dropped |
| `oecp.oeapi.language_dropped`, `invalid_language` | warning | `mul`, `und` or malformed language codes ignored |
| `oecp.oeapi.missing_teaching_language` | error | Offering rejected: no usable `teachingLanguage` on offering or course |
| `oecp.oeapi.unmappable_delivery_mode` | error | Offering rejected: no `modeOfDelivery` OACC understands |
| `oecp.oeapi.study_load_unit` | error | Rejected: `studyLoad` not in ECTS or not above 0 |
| `oecp.oeapi.missing_primary_code` | error | Course rejected: no `primaryCode` |
| `oecp.content.handbook_incomplete` | warning | The course lacks fields the Aurora IT Handbook requires to show it (the message lists them, e.g. `instructors`, `texts.en.assessment`, `offerings.enrol_start_date`). Published anyway while the alliance runs the rule in `warn` mode; stored as **draft** once it is set to `enforce`. See *Completeness* below |

The full list, with the severity of every code as `packages/schemas/errors.json` defines it, is in the [API integration guide](../guides/api-integration.md#warning-and-rejection-codes). Fix data at the source and run again.

4. When the result is right, switch on *Harvest on the schedule*, keep the stored credential and choose *Save settings*. The daily schedule then starts; the page shows the last run.

## What is mapped and what is not

Mapped from OEAPI: titles and texts per language, ECTS, ISCED fields, level, information and application links, dates and application deadline, academic sessions, teaching language, delivery mode, seats when you publish `maxNumberStudents` and `enrolledNumberStudents`, and **instructors** from `coordinators` when your endpoint returns them expanded with a name (`displayName`, or given name and surname). Coordinators given only as ids are ignored, and nothing else about the person (e-mail, phone, identifiers) is kept. The names are shown on the public course page, so return only names your university already publishes for the course.

Optional OACC extensions your IT can add if it wants (same shape as OACC's own read API): `ext.oecp.instructors` (a list of names or role descriptions, used when no coordinator has a name), `ext.oecp.texts` (mode of repetition, methods, literature, privacy notice, remarks per language) on the course, and `ext.oecp.applicationInstructions` on the offering. Details and an example: [API integration guide](../guides/api-integration.md#handbook-completeness).

Not available from OEAPI in 0.10.0:

- **Course kind**: every harvested course is `course`; BIPs and lecture series must be set by override.
- **Alliance attributes** (for example educational hub or SDGs): always empty; set by override.
- **"How to apply" instructions**: set by override, or, if your IT can add it, the optional extension `ext.oecp.applicationInstructions` on the offering.
- Teaching hours, campus and seats reserved for the alliance: override only.

### Completeness

The alliance applies the Aurora IT Handbook's publication rule: a course is shown only with English description, learning outcomes, prerequisites and assessment, ECTS, a study cycle, a contact, at least one instructor, and a published offering with start and end dates, application start and deadline, a teaching language and a delivery mode. After each harvest the run report lists every published course that misses something (`oecp.content.handbook_incomplete`), and the course list of the admin dashboard shows a *Completeness* column. During the transition (`warn`) such courses stay public; once the alliance switches to `enforce`, they are kept as drafts until a harvest finds them complete. **Instructors are the usual gap**, since few endpoints return named coordinators: return them expanded in your course listing, send `ext.oecp.instructors`, or set an *Instructors* override in the dashboard (it survives every harvest). Fix everything else at the source.

## 9. Keep it running

- **Withdrawal by absence.** A course or offering missing from three complete daily harvests in a row is withdrawn; it comes back when it reappears. Failed or incomplete harvests never withdraw anything, and if 30% or more of your published courses vanish at once, absences are not counted.
- **Overrides.** In the admin dashboard, open a course: each field shows the harvested value with an *Override* box. Ticked values survive every harvest until you untick them. Use this for alliance attributes, kind, instructors and instructions, not to correct errors your own system should fix. See the [web form guide](../guides/web-form.md).

  ![Course page of a harvested course: banner, source values from the partner's OEAPI and an Override checkbox per field](../images/admin-course-editor-overrides.png)

- **Unpublishing.** Change the status in your own system, or set a status override in OACC (a status action on the course page). The override wins over every harvest until an administrator chooses **Revert status to the partner's value** on the same page; the course then takes your system's status again.
- **Credential rotation.** On *Integration settings* choose *Replace it* under *Stored credential*, enter the new credential and save; then *Test connection*.

## Checklist

- [ ] Access agreement signed, including consent to republish eduXchange-tagged data
- [ ] Consumer profile returns only alliance courses
- [ ] Read-only credential issued; OACC outbound IP allowlisted
- [ ] Partner admin invitation accepted
- [ ] Integration settings saved with authoritative channel *OEAPI harvest*
- [ ] Host approved by the alliance admin; *Test connection* says *The connection works*
- [ ] First harvest reviewed: no unexpected rejections, English names present
- [ ] *Harvest on the schedule* switched on; daily runs visible in *Sync history*
- [ ] Alliance attributes, kind and application instructions added as overrides
- [ ] *Completeness* reviewed: instructors delivered (named coordinators, `ext.oecp.instructors` or overrides) and no other handbook field missing
