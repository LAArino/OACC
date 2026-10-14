<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Guide A: setting up OECP for an alliance

For the alliance (its Foundation or secretariat) and the hosting operator. Partners start with [Guide B](partner-with-oeapi.md), [C](partner-with-integration-capacity.md) or [D](partner-manual.md) once this guide is done. Overview: [onboarding README](README.md).

> **Before you start**
>
> - A decision on who is **data controller** (the alliance body that decides what is published and who administers it) and who is **processor** (the hosting institution). In Aurora: the Aurora Foundation and URV [DL 2].
> - A Linux server with Docker Engine 25+ and Compose v2.24+, ports 80 and 443, and two DNS names, for example `courses.alliance.example` (portal) and `auth.courses.alliance.example` (login).
> - An SMTP relay of the hosting institution.
> - The list of member universities with their official identifiers, and the list of alliance course attributes (hubs, SDGs, flags) you want to show.
> - Elapsed time: one to two weeks of technical work; legal documents and federation registration take longer and run in parallel.

## 1. Legal and governance

**Who:** Foundation, with the hosting institution's data protection officer. **Time:** 1–3 months, in parallel with everything else.

Spec [§10](../spec-v4.1.md#10-non-functional-requirements) lists what is needed. **None of these documents is provided with 0.2.0** (backlog "Docs: GDPR set"); you write them.

- [ ] Processing contract under art. 28 GDPR between controller and processor (hosting, backups, sub-processors, breach notification).
- [ ] Record of processing activities: administrators' names, e-mail addresses and audit trails, plus contact e-mails published with courses (ask partners for functional mailboxes).
- [ ] DPIA, or a documented screening that concludes one is not required.
- [ ] Privacy notice and accessibility statement (Directive (EU) 2016/2102; OECP targets WCAG 2.1 AA but has not been audited). The portal has no `/privacy` or `/accessibility` page in 0.2.0: publish both on the alliance website. The privacy notice URL is also required for the federation registration (step 3).
- [ ] Bilateral access agreement with each partner that will be harvested, including consent to republish data it tags for eduXchange (see [Guide B](partner-with-oeapi.md#2-sign-the-access-agreement)).

## 2. Hosting and deployment

**Who:** hosting operator. **Time:** one day.

Follow [deploy/compose/README.md](../../deploy/compose/README.md) ("Quick start" and "Production checklist"), with these choices:

1. Check out tag `v0.2.0` (or later) and copy `.env.example` to `.env`. Set `OECP_PORTAL_HOST`, `OECP_AUTH_HOST`, `ACME_EMAIL`, `OECP_ALLIANCE_NAME`, `OECP_REALM_DISPLAY_NAME`, `KEYCLOAK_ADMIN_ALLOWLIST` (operators' networks only) and `OECP_SMTP_*` (the institutional relay). Leave the `dev` profile off and `OECP_ALLOW_INSECURE_PARTNER_HTTP=false`.
2. Generate the secrets in `deploy/compose/secrets/` as the README shows. Keep an **offline copy of `oecp_master_key`**: without it the stored partner credentials cannot be decrypted.
3. TLS: in the `traefik` service uncomment the *PRODUCTION* block (ACME, TLS-ALPN challenge) and remove `--api.insecure` and the dashboard port.
4. Start and migrate:

   ```sh
   docker compose up -d --build --wait
   docker compose wait keycloak-config      # realm applied: exit status 0
   docker compose run --rm api pnpm db:migrate
   ```

5. Replace the temporary Keycloak bootstrap admin of the `master` realm by a permanent one with MFA.
6. Note the server's **public outbound IP address**. Partners with an OEAPI endpoint will put it on their allowlist.
7. Keep the login host on the **same site** as the portal (for example `courses.alliance.example` and `auth.courses.alliance.example`, as above) and keep the portal's `X-Frame-Options: SAMEORIGIN` from `deploy/compose/traefik/dynamic/middlewares.yaml` (never `DENY`). Both are needed for the admin session to survive a page reload (spec [§4](../spec-v4.1.md#4-identity)); with a login host on another domain administrators must sign in again after every reload.

Check: `https://<portal host>/en` shows the empty catalogue; `https://<auth host>/realms/oecp/.well-known/openid-configuration` answers.

## 3. Identity

**Who:** hosting operator, Foundation. **Time:** half a day, plus the federation's lead time.

- **Realm as code.** `identity/keycloak/realm-oecp.yaml` is applied on every `docker compose up`; edit the file, never the console. See [identity/keycloak/README.md](../../identity/keycloak/README.md).
- **Local accounts.** Any organization without an identity provider alias (the alliance organization at least) uses local Keycloak accounts: password of at least 12 characters plus a TOTP app, set up from an e-mail Keycloak sends at invitation time. Nobody can self-register.
- **Federation registration.** OECP registers one SAML service provider, entityID `https://<auth host>/realms/oecp`, in the hosting institution's national federation with export to eduGAIN (Aurora: SIR/RedIRIS [DL 15]), requesting the entity categories **REFEDS Personalized Access** and **REFEDS Data Protection Code of Conduct (CoCo) v2** and the **Sirtfi** assurance (no Research and Scholarship). Prepare contacts, names, logo and privacy notice URL now. The generator of the combined multi-ACS metadata ([scripts/sp-metadata.md](../../identity/keycloak/scripts/sp-metadata.md)) is a design only: **not yet available in 0.2.0**.
- **Partner identity providers.** The procedure is in the Keycloak README ("Adding a partner IdP": alias = organization slug, `subject-id` or `pairwise-id`). Partner IdPs are hidden on the Keycloak login page; administrators reach theirs through OECP: the invitation link of an organization with an IdP alias carries that alias, and every admin sign-in prompt offers **Sign in through your university**, listing the partners whose IdP is enabled in the realm. The brokered path is, however, **not yet verified end to end in 0.2.0** (no partner IdP has been connected). Until a partner's IdP is connected and tested, leave its *Identity provider alias* empty (seed `"keycloak_idp_alias": null`, step 4), so its administrators get local accounts. To switch a partner later: enable its IdP in the realm first, then set the alias on the organization page, then re-invite its administrators (accounts of the old login method are refused with `oecp.auth.idp_mismatch`; remove them on the *Administrators* panel).

## 4. Seed the organizations

**Who:** hosting operator, with data checked by the Foundation. **Time:** 1–2 hours.

Organizations can be created in two ways: from a JSON seed file run by the operator, which suits the first bulk load and can be reviewed before it is written, or on the *Organizations* page of the admin dashboard (*Organizations* > *New organization*), which needs an alliance admin (step 6). The seed must contain at least the alliance organization, because the first alliance admin belongs to it. For the seed, copy `apps/api/db/seed/organizations.aurora.json` to a file of your own and edit one entry per university plus one for the alliance. The fields are the same on the page:

| Field | Example (Universität Innsbruck) | Notes |
|---|---|---|
| `slug` | `uibk` | `[a-z0-9-]{2,40}`; the permanent key, do not rename |
| `org_type`, `is_partner` | `institution`, `true` | The alliance entry: `alliance`, `false` |
| `name` | `{"en": "University of Innsbruck", "de": "Universität Innsbruck"}` | English required |
| `schac_home_organization` | `uibk.ac.at` | Verify against the federation metadata |
| `erasmus_code`, `pic` | `null` | Fill only with verified values |
| `country_code` | `AT` | |
| `default_timezone` | `Europe/Vienna` | Used for offering dates |
| `ui_languages` | `["en", "de"]` | Stored for later; the portal is English-only in 0.2.0 |
| `keycloak_idp_alias` | `null` for now | See step 3 |
| `ext_id` (optional) | `uibk.ac.at` | For OEAPI partners: the root organization's `primaryCode.code`; the harvester then refuses an endpoint that answers as another university |

Validate, then write (the command upserts by `slug`, in one transaction, and never deletes):

```sh
docker compose run --rm -T -v "$PWD/organizations.alliance.json:/seed/orgs.json:ro" \
  api node dist/cli.js seed-organizations --file /seed/orgs.json --dry-run
docker compose run --rm -T -v "$PWD/organizations.alliance.json:/seed/orgs.json:ro" \
  api node dist/cli.js seed-organizations --file /seed/orgs.json
```

Later changes are made on the organization page (*Organizations* > the organization > *Details*); the slug cannot be changed. *Delete or restore* hides an organization (soft delete, restorable); it is refused while the organization still has courses, sub-units, administrators, pending invitations or an enabled harvest. The seed command never deletes.

## 5. Define the course attributes

**Who:** Foundation decides, operator runs. **Time:** one hour once the list is agreed.

Alliance attributes are your alliance's own tags and filters (types `boolean`, `enum`, `multi_enum`, `text`). Each becomes an `attr_<key>` CSV column, a field in the course wizard and, if `filterable`, a catalogue filter.

The default file (`attribute-definitions.json`) **is the Aurora list**. Aurora must still confirm it with the Foundation before migrating its current Virtual Campus entries. **Every other alliance must write its own file** and pass it with `--file`, using `attribute-definitions.aurora.json` as a model. Definitions missing from the file are kept, never deleted, so do not run the default first: removing a definition afterwards needs SQL.

```sh
docker compose run --rm -T -v "$PWD/attributes.alliance.json:/seed/attrs.json:ro" \
  api node dist/cli.js seed-attribute-definitions --file /seed/attrs.json --dry-run
```

Run it again without `--dry-run`. Option `value`s are stable identifiers used in CSV cells and URLs; labels can change.

## 6. Bootstrap the first alliance admin

**Who:** operator runs the command; a named Foundation person completes it. **Time:** 30 minutes.

```sh
docker compose run --rm -T api node dist/cli.js bootstrap-alliance-admin \
  --email platform@alliance.example --org aurora --ttl-hours 48
```

The command prints the invitation link (valid 24 hours by default, at most 168) and is refused once an alliance admin exists or is invited. It does **not** e-mail that link: send it to the person over a trusted channel. Keycloak separately e-mails a set-up link; if that mail fails, the command says so; re-send it from the Keycloak console (Users > the user > Credentials > Credential reset), since no alliance admin exists yet to use *Resend set-up e-mail* in OECP.

The new admin then:

1. Opens the Keycloak e-mail, sets a password and scans the TOTP QR code with an authenticator app.
2. Opens the invitation link and signs in with password and code; the page shows "Invitation accepted".
3. Signs out and in again: the new session carries the `alliance_admin` role.

Tokens are kept in memory only. A page reload restores the session without asking again while the login session is alive (30 minutes idle, 8 hours at most) and the requirements of step 2, item 7, are met; otherwise the page asks you to sign in again.

## 7. The administration screens

**Who:** alliance admin. **Time:** a quick tour.

Sign in at `https://<portal host>/en/admin`. Besides the organization modules (courses, CSV upload, sync history, integration settings), an alliance admin sees **Alliance administration**:

| Screen | What it does |
|---|---|
| *Network status* (`/en/admin/network`) | Health of every organization's data feed (OK, warning, error, not configured), with channel, harvesting, host approval, last run, courses, upcoming offerings, administrators and pending invitations; problems first |
| *Organizations* (`/en/admin/organizations`) | List, create, edit, delete and restore organizations; per organization: *Administrators* (remove, resend set-up e-mail), *Invitations*, *Integration* and *Courses* |
| *Invitations* (`/en/admin/invitations`) | Invite administrators of the selected organization; list, revoke and resend invitations |

The organization picker at the top of each page (kept in `?org=`) selects the organization the page works on.

**Scripting with the API.** Every screen calls the admin API ([spec §8.2](../spec-v4.1.md#82-admin-api-apiadminv1-implemented)), which can also be scripted for bulk work. There are no API keys or service accounts: a script needs an access token from an interactive sign-in with MFA (for example copied from the `Authorization: Bearer …` header of an `/api/admin/v1` request in the browser's developer tools), which expires after 5 minutes. Treat it as a password and never share it.

## 8. Invite partner admins

**Who:** alliance admin. **Time:** 15 minutes per partner, plus their response time.

1. Open *Invitations* (or *Organizations* > the organization > *Invitations*) and pick the partner organization.
2. Under *Invite an administrator* enter the e-mail address, choose the role (`partner_admin`) and the validity (7 days by default, or 3 or 1), and choose *Send invitation*.

OECP e-mails the invitation link; for local-account organizations Keycloak also sends the password and TOTP set-up mail. For an organization with an identity provider alias, the link carries the alias and the person signs in through their university. The address must be the one the person signs in with, and one person can administer only one organization.

The list shows each invitation as *Pending*, *Accepted*, *Expired* or *Revoked*. *Revoke* stops a pending link at once; *Resend* replaces a lost or expired link with a new one (the old link stops working). If a local account never finished its password and TOTP set-up, use *Resend set-up e-mail* on the organization's *Administrators* panel. Agree with each partner which guide applies (B, C or D).

## 9. Operate

- **Network status and sync monitor.** *Network status* shows every organization's health at a glance; check it weekly, and open an organization's *Sync history* for the runs of every channel with counters, errors and warnings. OECP sends no notifications, for example when the mass-absence guard (`oecp.oeapi.mass_absence`) stops withdrawals: look at these screens regularly.
- **Approve partner hosts.** Before a partner can be harvested, check with the partner, through a channel you already trust, that the `base_url` host is theirs, then open the partner's *Integration settings* and choose *Approve host …* in the *Host approval* card. Any later change of host clears the approval ([Guide B, step 6](partner-with-oeapi.md#6-approve-the-host)).
- **Remove an administrator.** *Organizations* > the organization > *Administrators* > *Remove*: the role is taken away and the person's sessions end; the Keycloak account is kept. You cannot remove yourself or the last alliance admin. An access token already issued stays valid for up to 5 minutes.
- **Inactive administrators.** The *Administrators* panel shows each person's last sign-in. Nothing removes dormant accounts automatically in 0.2.0: review the list at least twice a year and remove people who left.
- **Backups.** OECP ships none in 0.2.0 (pgBackRest is planned). Until then the operator runs at least a daily `pg_dump` of the databases `oecp` and `keycloak`, a daily copy of the `uploads` volume, an offline copy of the secrets, and a restore test.
- **Retention.** Automatic today: uploaded files after 90 days, Keycloak events after 90 days. Other retention jobs are not yet available in 0.2.0.

## Go-live checklist

- [ ] Art. 28 contract signed; record of processing, DPIA or screening, privacy notice and accessibility statement published
- [ ] Access agreements signed with every harvested partner
- [ ] Production TLS, allowlists, SMTP relay; no `dev` profile; insecure partner HTTP off
- [ ] Permanent Keycloak master admin with MFA; secrets and master key copied offline
- [ ] Organizations seeded and identifiers verified; attribute definitions agreed and seeded
- [ ] At least two alliance admins (invite a second one, so the alliance never depends on one person)
- [ ] Every partner has an accepted partner admin and a chosen channel
- [ ] Backups running and one restore tested
- [ ] Federation registration submitted, if partner IdP login is wanted later
