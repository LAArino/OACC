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

1. Check out tag `v0.2.0` (or later) and copy `.env.example` to `.env`. Set `OECP_PORTAL_HOST`, `OECP_AUTH_HOST`, `ACME_EMAIL`, `OECP_ALLIANCE_NAME`, `OECP_REALM_DISPLAY_NAME`, `KEYCLOAK_ADMIN_ALLOWLIST` (operators' networks only) and `OECP_SMTP_*` (the institutional relay). Leave the `dev` profile off and `OECP_ALLOW_INSECURE_PARTNER_HTTP=false`. Keep `OECP_PUBLISH_RULE=warn` and `OECP_DORMANCY_DRY_RUN=true` for now (step 9 explains when to change them); the IdP metadata settings `OECP_IDP_METADATA_*` are set in step 3.
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
8. Size the server for the **worker**: with the IdP metadata refresh on the eduGAIN aggregate (step 3) the worker needs at least **2 GB** of memory of its own (about 750 MB measured for a 75 MB aggregate; eduGAIN is about 94 MB). Compose sets no memory limit; if you add one, keep it at 2 GB or more.

Check: `https://<portal host>/en` shows the empty catalogue; `https://<auth host>/realms/oecp/.well-known/openid-configuration` answers; `docker compose ps` shows `api` and `worker` as *healthy* (the worker's healthcheck calls its internal `/ready`, which checks PostgreSQL and Valkey).

## 3. Identity

**Who:** hosting operator, Foundation. **Time:** half a day, plus the federation's lead time.

- **Realm as code.** `identity/keycloak/realm-oecp.yaml` is applied on every `docker compose up`; edit the file, never the console. See [identity/keycloak/README.md](../../identity/keycloak/README.md).
- **Local accounts.** Any organization without an identity provider alias (the alliance organization at least) uses local Keycloak accounts: password of at least 12 characters plus a TOTP app, set up from an e-mail Keycloak sends at invitation time. Nobody can self-register.
- **Federation registration.** OECP registers one SAML service provider, entityID `https://<auth host>/realms/oecp`, in the hosting institution's national federation with export to eduGAIN (Aurora: SIR/RedIRIS [DL 15]), requesting the entity categories **REFEDS Personalized Access** and **REFEDS Data Protection Code of Conduct (CoCo) v2** and the **Sirtfi** assurance (no Research and Scholarship). Prepare contacts, names, logo and privacy notice URL now. The generator of the combined multi-ACS metadata ([scripts/sp-metadata.md](../../identity/keycloak/scripts/sp-metadata.md)) is a design only: **not yet available in 0.2.0**.
- **IdP metadata refresh.** Partner IdPs carry a copy of their signing certificates and sign-in endpoints, which universities change. The worker job `idp-metadata-refresh` updates them every day at 04:15 UTC from the federation's signed metadata aggregate (spec [§4](../spec-v4.1.md#4-identity), [identity/keycloak/README.md](../../identity/keycloak/README.md#metadata-refresh-owned-by-the-api)). It is off until you configure it, and it is only needed once a partner IdP is connected:
  1. Choose the aggregate: eduGAIN (`https://mds.edugain.org/edugain-v2.xml`) or the feed of the federation that registers the partner IdPs.
  2. Obtain the aggregate's **signing certificate** from the federation's website and check its SHA-256 fingerprint against a second, independent source (another page of the federation, or its operators). This certificate is the only trust anchor: OECP refuses any aggregate not signed by it. Save it as a PEM file with that one certificate.
  3. Mount the file read-only into the `worker` (for example in a `compose.override.yaml`: `services: worker: volumes: ["./secrets/federation-signer.pem:/run/secrets/federation-signer.pem:ro"]`) and set in `.env` `OECP_IDP_METADATA_URL`, `OECP_IDP_METADATA_SIGNING_CERT_FILE=/run/secrets/federation-signer.pem` and keep `OECP_IDP_METADATA_MAX_BYTES=157286400` (the 50 MiB built-in limit is too small for eduGAIN). The last good aggregate is kept on the volume `idp-metadata` and used for up to 7 days if the federation is unreachable.
  4. Check the memory of step 2, item 8, then try a dry run: `docker compose run --rm worker node dist/cli.js idp-metadata-refresh --dry-run` lists every partner IdP as *updated* (would change), *unchanged*, *skipped* (disabled, or no entity ID) or *failed*, with the keys that would change. Then restart the worker: about a minute after every start it runs once, and daily afterwards.
  5. When certificates are rolled, the run writes them and adds an audit entry `idp.metadata_refresh`; a certificate expiring within 30 days and a failing IdP are reported in the worker log (no e-mail alerts yet). `docker compose up` re-applies `realm-oecp.yaml` and resets the refreshed values until the start-up run a minute later, so keep the values committed in the realm file reasonably current. When the federation renews its signing key, replace the PEM file before the old key stops being used.
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
- **Maintenance jobs.** The worker runs, every day (UTC): `history-partitions` at 00:10 (and at every start: monthly partitions of the raw payload history), `idp-metadata-refresh` at 04:15 (step 3), `csv-retention` at 04:30 (uploaded files after 90 days), `retention` at 04:45 (old run errors, runs, audit entries, invitations and maintenance runs, below) and `dormancy` at 05:00. Each run is recorded in `maintenance_runs` (except the daily IdP metadata refresh, which only logs). **There is no screen for them yet** (backlog "Maintenance runs UI page"): an alliance admin reads and starts them through the admin API, with a token taken from the browser as in step 7:

  ```sh
  API=https://<portal host>/api/admin/v1
  curl -sS "$API/maintenance/runs?limit=20" -H "Authorization: Bearer $TOKEN"              # newest first; ?job=retention filters
  curl -sS -X POST "$API/maintenance/jobs/retention/run" -H "Authorization: Bearer $TOKEN"  # 202 {"job","status":"queued"}
  ```

  Each run shows `job`, `trigger_kind` (`schedule`, `startup`, `manual`), `status` (`succeeded`, `failed`, `skipped` when another run of the same job was in progress), `counters`, `details` and `error`. On demand you can run `history-partitions`, `retention`, `dormancy`, `csv-retention` and `idp-metadata-refresh`; requests are audited. Check once a week that the latest runs `succeeded`.
- **Inactive administrators (dormancy).** The *Administrators* panel shows each person's last sign-in. The `dormancy` job finds administrators (partner and alliance) with no activity for `OECP_DORMANCY_DAYS` (180) days: last use of the admin API, last Keycloak sign-in, account creation and the date of the upgrade that introduced the job, whichever is latest, so nobody becomes dormant earlier than 180 days after that upgrade. It **only reports** while `OECP_DORMANCY_DRY_RUN=true` (the default). Review the dry run:

  ```sh
  curl -sS "$API/maintenance/runs?job=dormancy&limit=1" -H "Authorization: Bearer $TOKEN"
  ```

  `counters.would_revoke` is the number of people it would remove, and `details.candidates` lists each one (`sub`, `roles`, `organization_id`, `last_activity_at`, `basis`, `inactive_days`, `action` `would_revoke`); match the `sub` on the organization's *Administrators* panel. When the Foundation agrees with the result, set `OECP_DORMANCY_DRY_RUN=false` in `.env` and recreate the worker (`docker compose up -d worker`). From then on dormant administrators lose their role and sessions, exactly as with *Remove*, with the audit entry `admin.dormant_revoke`; the last alliance admin is never removed. Their Keycloak account is kept (its deletion after 12 months is not automated yet), and annual recertification is not implemented: review the *Administrators* panels at least once a year.
- **Worker health.** `docker compose ps` shows the worker's health. Its internal endpoints are not published; to look at them: `docker compose exec worker node -e "fetch('http://127.0.0.1:3001/health').then(r=>r.text()).then(console.log)"` lists the scheduled jobs with their next run time; `/ready` says whether PostgreSQL and Valkey answer.
- **Publication rule.** `OECP_PUBLISH_RULE=warn` publishes courses that miss fields the Aurora IT Handbook requires and only flags them (warning `oecp.content.handbook_incomplete`, *Completeness* column of the course list, sync history). Watch those counts per partner; when they are acceptable, set `OECP_PUBLISH_RULE=enforce` for **both** `api` and `worker` (the shared `.env` does that) and recreate both: incomplete courses are then stored as drafts at their next write (ADR-0016). Harvested courses usually lack instructors, so agree with OEAPI partners how they send them first ([API integration guide](../guides/api-integration.md#handbook-completeness)).
- **Backups.** OECP ships none in 0.2.0 (pgBackRest is planned). Until then the operator runs at least a daily `pg_dump` of the databases `oecp` and `keycloak`, a daily copy of the `uploads` volume, an offline copy of the secrets, and a restore test.
- **Retention.** Automatic: uploaded files after 90 days; raw harvested payloads after 12 months (`OECP_RETENTION_HISTORY_MONTHS`); run errors 12 months, sync runs 24 months, audit entries 36 months (`OECP_RETENTION_SYNC_ERRORS_MONTHS`, `_SYNC_RUNS_MONTHS`, `_AUDIT_MONTHS`); settled invitations, maintenance runs and idle activity records 12 months; Keycloak events 90 days. The month values are defaults; Compose does not pass the `OECP_RETENTION_*` variables yet, so changing them means adding them to `x-oecp-backend-env` in `compose.yaml`. Not automated yet: application and access log retention (configure the Docker log driver or Loki yourself) and deleting Keycloak accounts 12 months after role removal. Record the periods in your record of processing activities (step 1).

## Go-live checklist

- [ ] Art. 28 contract signed; record of processing, DPIA or screening, privacy notice and accessibility statement published
- [ ] Access agreements signed with every harvested partner
- [ ] Production TLS, allowlists, SMTP relay; no `dev` profile; insecure partner HTTP off
- [ ] Permanent Keycloak master admin with MFA; secrets and master key copied offline
- [ ] Organizations seeded and identifiers verified; attribute definitions agreed and seeded
- [ ] At least two alliance admins (invite a second one, so the alliance never depends on one person)
- [ ] Every partner has an accepted partner admin and a chosen channel
- [ ] Backups running and one restore tested
- [ ] Worker *healthy*; the latest maintenance runs `succeeded`
- [ ] A dormancy dry run reviewed by the Foundation, and `OECP_DORMANCY_DRY_RUN` decided
- [ ] `OECP_PUBLISH_RULE` decided (`warn` during the transition, `enforce` when the catalogue is complete enough)
- [ ] If partner IdPs are connected: IdP metadata refresh configured (aggregate URL, verified signing certificate, worker memory ≥ 2 GB) and a dry run clean
- [ ] Federation registration submitted, if partner IdP login is wanted later
