<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Open European Campus Portal (OECP): Specification v4.1

Status: as built · Date: 2026-10-14 · Supersedes `docs/spec-v4.0.md` (kept unchanged) · Licence: EUPL-1.2

**Sources,** by precedence: the code and migrations (`apps/api/db/migrations/`); [DL n] = row *n* of `docs/decisions-log.md`; `docs/spec-v4.0.md` for structure. [RP] = `docs/research/partner-oeapi-endpoints.md`; [R00]–[R03] = `docs/review/`. RFC 2119 keywords apply.

## Status of this document

v4.1 describes OECP **as built on 2026-10-14** (`main`, 9 commits): three ingestion channels, identity, public catalogue and OEAPI read API, verified on the Docker Compose development stack. Where v4.0 promised something not built, this document says so.

**Markers:** **[Implemented]** in the code and tested or manually verified; **[Partial]** part built, the rest named; **[Deferred]** not built, with the `docs/backlog.md` item or "not in backlog". **Note for the owner** lines flag deviations from a decision or from v4.0.

### What changed since v4.0

| Area | v4.1 (as built) |
|---|---|
| Stack | NestJS 12.1, Nuxt 4.6, BullMQ 6.3 (v4.0: 5), Kysely, node-pg-migrate, Zod 4, Node 22; no Reka UI |
| Search | PostgreSQL only; migration 0004 reweights the vector, adds `oecp_search_fold()` and partial indexes |
| `base_url` | Migration 0003 allows `http` in the database; `https:443` enforced in code unless `OECP_ALLOW_INSECURE_PARTNER_HTTP=true` (development) |
| [DL 18] | Migration 0005: `kind`, `levels[]`, `attributes` + `attribute_definitions`, `application_instructions`; `attr_<key>` filters and facets; `sort=deadline` |
| `level` | `levels[]` authoritative; `level = levels[0]`, kept for the OEAPI read API |
| Public API | `locale` = display language, `lang` = teaching-language filter; `upcoming`, `kind`, `level`, aliases, disjunctive facets, sitemap; suggestions ≤ 10 |
| `/oeapi/v5` | Strict `consumer` [DL 19] |
| CSV | Template 1.1 (1.0 accepted); one Zod validator in browser and server; inline ≤ 500 rows, else queued; all-or-nothing |
| Overrides | Entries keep their `source` value (restored at once when cleared); form modes `write`/`overrides`; keys `texts.<lang>.<field>` |
| Invitations | Defined failure statuses and codes, `relogin_required`, `GET /me` for role-less tokens |
| Admin tokens | In memory: a page reload signs the administrator out |
| Harvester | Always running in the worker; a partner is scheduled only when enabled, `oeapi`-authoritative and host-approved |
| Admin UI | Built: CSV console, course wizard with overrides, sync monitor. Not built: integration settings, organizations, administrators, network status |

## 1. Purpose and scope

OECP is an EUPL-1.2 web application that publishes the course offer of a European University alliance as one public catalogue and one read API. Partners feed courses through three channels: scheduled harvesting of OEAPI (formerly OOAPI), CSV upload, or a web form. An anti-corruption layer (`CanonicalWriter`) normalises every channel into one canonical model before publication.

**Alliance-agnostic.** Alliance name, partners, attribute definitions and UI languages are configuration (seeded tables, Keycloak realm, Nuxt runtime config). One deployment serves one alliance.

**First deployment: Aurora** [DL 2, DL 4, DL 13]:

| Channel at launch | Partners | Status |
|---|---|---|
| A: OEAPI v5, direct access [DL 14] | UIBK, UICE, VUA, UDE | [Implemented], verified only against `tools/oeapi-mock` (backlog "Harvest a real partner") |
| B/C: CSV or web form | URV, UNINA, UP, CBS, UPEC, Aurora Foundation | [Implemented] |

**Out of scope for the MVP** (unchanged from v4.0): wallet login, EWP, analytics, ELM/LOQ, OEAPI v4 (v2); "harvest now" notification (v1); push ingestion. OECP never handles applications and stores no student data.

## 2. Actors and roles

| Actor | Auth | Permissions | Status |
|---|---|---|---|
| Anonymous visitor | none, no cookies | Public catalogue, `/api/public/v1`, `/oeapi/v5` | [Implemented] |
| `partner_admin` | Keycloak + MFA | Courses, offerings, overrides, integration settings, uploads and sync runs of the organization in claim `org_id` and its descendants (`parent_id` chain, depth ≤ 32); lists its organization's invitations | [Implemented] |
| `alliance_admin` | Keycloak + MFA | All of the above for every organization, plus invitations (create, revoke) and host approval | [Implemented]; organization management only through `oecp seed-organizations` |

Roles are assigned in OECP through the Keycloak Admin API, never derived from federated attributes [R01 §2; DL 9]. Every admin endpoint resolves the target organization: unknown or soft-deleted → 404 `oecp.request.not_found`; outside the caller's scope → 403 `oecp.auth.forbidden_organization`.

### 2.1 Onboarding [Implemented for local accounts; Partial for brokered]

1. The organization exists (seeded by `oecp seed-organizations`; no organizations API or UI) with `schac_home_organization` and, for eduGAIN partners, `keycloak_idp_alias`.
2. An `alliance_admin` calls `POST /api/admin/v1/invitations` `{email, role, organization_id, ttl_hours?}` (default and maximum 168 h). The API stores only the SHA-256 of a 256-bit token (base64url, 43 characters), audits `invitation.create` and e-mails `{OECP_PUBLIC_BASE_URL}/en/admin/accept#token=…` in the same transaction: if the mail fails (502 `oecp.mail.unavailable`) nothing remains. With `SMTP_HOST` empty the mail is only logged.
3. **Organizations without IdP alias** (Aurora Foundation): the API also finds or creates a Keycloak local user with required actions `UPDATE_PASSWORD`, `CONFIGURE_TOTP` and has Keycloak send its execute-actions e-mail (lifespan = invitation TTL); a failure there is logged, not fatal.
4. The page `/{locale}/admin/accept` reads the token from the fragment, clears the address bar, parks the token in `sessionStorage` only for the OIDC round trip, signs in (Authorization Code + PKCE, `acr_values=mfa`), then calls `GET /me` and `POST /api/admin/v1/invitations/accept` `{token}`.
5. The API locks the invitation row and checks, in order:
   - unknown token → 404 `oecp.invitation.invalid`; accepted or revoked → 409 `oecp.invitation.invalid`; expired → 410 `oecp.invitation.expired`; organization deleted → 409 `oecp.invitation.invalid`;
   - `email` claim ≠ invited address (case-insensitive), or `idp` ≠ organization alias (`local` when NULL) → 403 `oecp.invitation.mismatch`;
   - caller already administers another organization → 409 `oecp.invitation.mismatch`;
   - brokered organization with `schac_home_organization` not asserted (claim, else Keycloak user attribute) → 403 `oecp.invitation.mismatch`.

On success the API first sets the user attribute `oecp_org_id` and the realm role through the Admin API (idempotent; a Keycloak failure, 502/504 `oecp.identity.unavailable` or 409 `oecp.identity.conflict`, rolls back and keeps the invitation usable), then marks it accepted and audits `invitation.accept`. Response 200 `{role, org_id, relogin_required: true}`: the user must sign in again to get a token with the role.

**Note for the owner:** no page sends `kc_idp_hint` (`useAuth.login()` supports it but is never called with one; the SPA cannot know the alias before acceptance), while partner IdPs are `hideOnLogin: true`. A brokered partner administrator therefore has no UI path to their IdP. Only the local-account path is verified end to end (backlog "Playwright E2E in CI with a test SAML IdP").

**Invitation management:** `GET /invitations` (alliance: all; partner: own organization; 500 most recent; computed status `pending|accepted|revoked|expired`); `DELETE /invitations/{id}` (alliance; 204; 409 if accepted or revoked). No UI [Deferred: not in backlog].

**Bootstrap** [Implemented]: `oecp bootstrap-alliance-admin` (Appendix C).

### 2.2 MFA, sessions, logout, revocation

| Item | As built | Status |
|---|---|---|
| MFA | LoA 2 (`acr=mfa`) on every login: flow `oecp-browser-mfa` (local), post-broker flow `oecp-post-broker-mfa` (brokered); WebAuthn or TOTP if configured, else TOTP enrolment | [Partial]: the SPA does not offer WebAuthn registration |
| Lifetimes | Access 300 s; rotating single-use refresh tokens; SSO idle 30 min, max 8 h; no remember-me, no `offline_access` | [Implemented] |
| SPA tokens | In memory; OIDC state only in `sessionStorage`; no silent renew, so a reload signs out | [Implemented]; renewal [Deferred: backlog "Admin session survives a page reload"] |
| Logout | RP-initiated; SAML SLO when the IdP declares it | [Implemented] |
| Revocation | `removeRealmRole()`/`logoutUser()` exist in `KeycloakAdminService` but no endpoint uses them; use the Keycloak console | [Deferred: not in backlog] |
| Dormancy (180 days), recertification | — | [Deferred: not in backlog] |

## 3. Architecture

A **modular monolith** [R03 §0]: one NestJS codebase and image (`oecp/api`), two processes: `api` (`dist/main.js`, HTTP) and `worker` (`dist/worker.js`, BullMQ, no HTTP). Modules: `catalogue`, `oeapi`, `admin`, `ingestion`, `identity`, `secrets`, `health`.

```
 Internet ──> Traefik v3.7 (TLS, routing, per-IP rate limits, security headers)
   portal-host:  /                -> web  (Nuxt SSR catalogue; client-rendered /{locale}/admin)
                 /api/public/v1   -> api  (anonymous)
                 /oeapi/v5        -> api  (anonymous)
                 /api/admin/v1    -> api  (Bearer JWT)
   auth-host:    /realms/oecp, /resources -> Keycloak 26.8 <── SAML ──> partner IdPs
                 /admin, /realms/master   -> Keycloak, IP-allowlisted
 api, worker ──> PostgreSQL 16 | Valkey 8.1 (BullMQ) | uploads volume /data/uploads
 worker ──(network `egress`, approved host only)──> partner OEAPI endpoints | SURFeduhub gateway
```

Compose versions: Traefik 3.7.14, Nuxt 4.6.1, NestJS 12.1, PostgreSQL 16.15 (Keycloak uses database `keycloak` in the same cluster), Keycloak 26.8.1 with keycloak-config-cli 6.5.1, Valkey 8.1.10 with BullMQ 6.3, local volume `/data/uploads` (S3 in v1).

**Queues.** `harvest-schedule`: one job scheduler per harvestable partner (`schedule_cron` in `schedule_timezone`), re-registered at worker start and every 15 minutes, so Valkey state is rebuildable. `harvest`: job id `harvest-{organization_id}` (BullMQ forbids `:`), one run per partner at a time, concurrency 2. `csv`: queued uploads (`csv-{syncRunId}`) and the daily retention job (04:30 UTC).

The public portal never loads OIDC code. **Health:** `GET /health` and `GET /ready` (PostgreSQL, Valkey) on the api container, not routed by Traefik [Implemented]; worker health [Deferred: backlog "Worker health endpoint"].

## 4. Identity

**Realm** `oecp`, Keycloak only [DL 1], as code (`identity/keycloak/realm-oecp.yaml`), applied by keycloak-config-cli on every `docker compose up` with the import cache disabled [Implemented]. Local-user password policy: 12–128 characters, not username or e-mail, history 5; brute-force protection; events kept 90 days; no self-registration.

**Partner IdPs** [Partial: none configured]. One SAML IdP per partner, alias = organization `slug`; the realm ships the disabled template `example-partner`: importers for `mail`, `schacHomeOrganization`, `displayName`, `givenName`, `sn` (sync FORCE), principal attribute `subject-id` (per partner `pairwise-id`, or ePPN with written confirmation), signed and encrypted assertions, `hideOnLogin: true`, first-broker-login `oecp-first-broker-login` (create if unique, no linking by e-mail). Not built: the daily `idp-metadata-refresh` job [Deferred: not in backlog], the multi-ACS SP metadata generator for SIR/eduGAIN [DL 15] (design only), the `schac_home_organization` claim mapper [Deferred: backlog "Keycloak mapper…"; the API reads the user attribute instead].

**Clients.** `oecp-admin`: public, Authorization Code + PKCE S256, redirect `https://{portal}/en/admin/*`, minimum ACR `mfa`, scopes `basic, acr, email, web-origins, oecp`, role scope limited to the two OECP roles. `oecp-api`: audience only. `oecp-backend`: confidential service account (`manage-users`, `view-users`, `manage-identity-providers`, `view-identity-providers`). ACR-to-LoA map `{"mfa": 2}`.

**JWT contract** (`apps/api/src/admin/auth/claims.ts`) [Implemented]: signature by the cached realm JWKS (RS256, ES256); `iss` = `KEYCLOAK_ISSUER`; `aud` ∋ `oecp-api`; `azp` = `oecp-admin`; `exp`, `iat`, `sub`, `azp`, `acr` required, 30 s tolerance; `acr` = `mfa`, else 401 `oecp.auth.insufficient_acr` with the RFC 9470 challenge `Bearer error="insufficient_user_authentication", acr_values="mfa"`; `roles` flat, non-OECP values ignored, absent = `[]`, empty → 403 `oecp.auth.no_role` except on `GET /me` and `POST /invitations/accept`; with roles, `org_id` must name a non-deleted organization (403 `oecp.auth.unknown_organization`) whose alias, or `local` when NULL, equals `idp` (absent = `local`; 403 `oecp.auth.idp_mismatch`); `email`, `name`, `schac_home_organization` for display and invitation matching.

Missing bearer: 401 `oecp.auth.missing_token`; other verification failures: 401 `oecp.auth.invalid_token`; role not permitted: 403 `oecp.auth.forbidden_role`. **Phase 2** (wallet login as one more IdP): unchanged from v4.0 §4.

## 5. Canonical data model

**Conventions** (as v4.0): UUID keys; dates local to the offering `timezone`; no hard deletes (`deleted_at` marks records created in error; its 12-month purge [Deferred: not in backlog]); short labels are `{lang: text}` with `en`; long texts in `course_texts`, one row per primary subtag. **Lifecycle** [DL 6]: `draft`, `published`, `withdrawn`, `cancelled`, from any channel; natural keys `(organization_id, ext_id)` and `(course_id, ext_offering_id)`. **Languages** [DL 5]: English required to publish (deferred trigger `courses_publishable`); no machine translation by OECP.

### 5.1 Effective schema

The effective schema is the `-- Up Migration` sections of migrations 0001–0005 in order, copied verbatim by script: 0001 (extracted from v4.0 §5) followed by the deltas 0002–0005, applied by `node-pg-migrate --check-order`. Down sections are omitted.

**0001_init** (canonical schema):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE DOMAIN language_tag AS text CHECK (VALUE ~ '^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$');
CREATE TYPE lifecycle_status AS ENUM ('draft', 'published', 'withdrawn', 'cancelled');
CREATE TYPE source_channel   AS ENUM ('oeapi', 'csv', 'form');
CREATE TYPE sync_run_status  AS ENUM ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled');

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE TABLE organizations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id               uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  partner_id              uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  org_type                text NOT NULL CHECK (org_type IN
                            ('alliance', 'institution', 'faculty', 'department', 'campus', 'other')),
  is_partner              boolean NOT NULL DEFAULT false,
  slug                    text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name                    jsonb NOT NULL CHECK (jsonb_typeof(name) = 'object' AND name ? 'en'),
  schac_home_organization text UNIQUE,
  erasmus_code            text UNIQUE,
  pic                     text UNIQUE CHECK (pic ~ '^[0-9]{9}$'),
  country_code            text CHECK (country_code ~ '^[A-Z]{2}$'),
  website_url             text CHECK (website_url ~ '^https://'),
  logo_url                text CHECK (logo_url ~ '^https://'),
  contact_email           text CHECK (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  default_timezone        text NOT NULL DEFAULT 'Europe/Brussels',
  ui_languages            language_tag[] NOT NULL DEFAULT '{en}',
  ext_id                  text,
  keycloak_idp_alias      text UNIQUE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (NOT is_partner OR partner_id = id),
  UNIQUE (partner_id, ext_id)
);

CREATE TABLE delivery_modes (                     -- OEAPI v6 vocabulary [DL 7]
  code        text PRIMARY KEY CHECK (code ~ '^(x-)?[a-z][a-z0-9_-]*$'),
  label       jsonb NOT NULL CHECK (label ? 'en'),
  schema_org  text NOT NULL CHECK (schema_org IN ('Onsite', 'Online', 'Blended')),
  sort_order  smallint NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);
INSERT INTO delivery_modes (code, label, schema_org, sort_order) VALUES
  ('presential', '{"en":"On campus"}', 'Onsite', 10), ('online', '{"en":"Online"}', 'Online', 20),
  ('hybrid', '{"en":"Hybrid"}', 'Blended', 30),       ('blended', '{"en":"Blended"}', 'Blended', 40),
  ('coil', '{"en":"COIL"}', 'Online', 50),            ('joint_delivery', '{"en":"Joint delivery"}', 'Blended', 60);

CREATE TABLE isced_broad_fields (                 -- seeded with ISCED-F 2013 codes 00-10, 99
  code   text PRIMARY KEY CHECK (code ~ '^[0-9]{2}$'),
  label  jsonb NOT NULL CHECK (label ? 'en')
);

CREATE TABLE academic_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  ext_id           text NOT NULL,
  parent_id        uuid REFERENCES academic_sessions(id) ON DELETE RESTRICT,
  session_type     text NOT NULL CHECK (session_type IN
                     ('academic_year', 'semester', 'trimester', 'quarter', 'testing_period', 'period')),
  name             jsonb NOT NULL CHECK (name ? 'en'),
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  source_channel   source_channel NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  UNIQUE (organization_id, ext_id),
  CHECK (end_date >= start_date)
);

CREATE TABLE courses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  teaching_unit_id  uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  ext_id            text NOT NULL CHECK (length(ext_id) BETWEEN 1 AND 200),
  source_ref        text,
  source_channel    source_channel NOT NULL,
  status            lifecycle_status NOT NULL DEFAULT 'draft',
  ects              numeric(5,2) NOT NULL CHECK (ects > 0 AND ects <= 120),
  level             text CHECK (level IN ('short_cycle', 'bachelor', 'master', 'doctoral', 'other')),
  eqf_level         smallint CHECK (eqf_level BETWEEN 1 AND 8),
  teaching_hours    numeric(6,1) CHECK (teaching_hours > 0),
  info_url          text CHECK (info_url ~ '^https://'),
  contact_email     text CHECK (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  overrides         jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(overrides) = 'object'),
  content_hash      bytea CHECK (octet_length(content_hash) = 32),
  absent_count      smallint NOT NULL DEFAULT 0 CHECK (absent_count >= 0),
  last_seen_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (organization_id, ext_id)
);

CREATE TABLE course_texts (
  course_id              uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lang                   language_tag NOT NULL CHECK (lang !~ '-'),
  title                  text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  abstract               text,
  description            text,
  learning_outcomes      text,
  prerequisites          text,
  assessment             text,
  keywords               text[] NOT NULL DEFAULT '{}',
  is_machine_translated  boolean NOT NULL DEFAULT false,
  overrides              jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(overrides) = 'object'),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, lang)
);

CREATE TABLE course_isced_codes (
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  isced_code  text NOT NULL CHECK (isced_code ~ '^[0-9]{2,6}$'),
  broad_code  text NOT NULL REFERENCES isced_broad_fields(code),
  is_primary  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (course_id, isced_code),
  CHECK (broad_code = left(isced_code, 2))
);
CREATE UNIQUE INDEX course_isced_one_primary ON course_isced_codes (course_id) WHERE is_primary;

CREATE TABLE course_offerings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id             uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  ext_offering_id       text NOT NULL CHECK (length(ext_offering_id) BETWEEN 1 AND 200),
  source_ref            text,
  source_channel        source_channel NOT NULL,
  status                lifecycle_status NOT NULL DEFAULT 'draft',
  academic_session_id   uuid REFERENCES academic_sessions(id) ON DELETE RESTRICT,
  start_date            date NOT NULL,
  end_date              date NOT NULL,
  enrol_start_date      date,
  application_deadline  date,
  timezone              text NOT NULL,
  teaching_languages    language_tag[] NOT NULL CHECK (cardinality(teaching_languages) >= 1),
  campus                text CHECK (length(campus) <= 200),
  max_students          integer CHECK (max_students > 0),
  alliance_seats        integer CHECK (alliance_seats >= 0),
  seats_available       integer CHECK (seats_available >= 0),
  seats_updated_at      timestamptz,
  application_url       text CHECK (application_url ~ '^https://'),
  overrides             jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(overrides) = 'object'),
  content_hash          bytea CHECK (octet_length(content_hash) = 32),
  absent_count          smallint NOT NULL DEFAULT 0 CHECK (absent_count >= 0),
  last_seen_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  UNIQUE (course_id, ext_offering_id),
  CHECK (end_date >= start_date),
  CHECK (application_deadline IS NULL OR application_deadline <= end_date),
  CHECK (enrol_start_date IS NULL OR application_deadline IS NULL OR enrol_start_date <= application_deadline),
  CHECK (alliance_seats IS NULL OR max_students IS NULL OR alliance_seats <= max_students),
  CHECK (seats_available IS NULL OR seats_updated_at IS NOT NULL),
  CHECK (seats_available IS NULL OR max_students IS NULL OR seats_available <= max_students)
);

CREATE TABLE course_offering_delivery_modes (
  offering_id  uuid NOT NULL REFERENCES course_offerings(id) ON DELETE CASCADE,
  mode_code    text NOT NULL REFERENCES delivery_modes(code) ON UPDATE CASCADE,
  PRIMARY KEY (offering_id, mode_code)
);

CREATE FUNCTION check_course_publishable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'published' AND NOT EXISTS
     (SELECT 1 FROM course_texts t WHERE t.course_id = NEW.id AND t.lang = 'en') THEN
    RAISE EXCEPTION 'course % has no English text', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER courses_publishable AFTER INSERT OR UPDATE ON courses
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_course_publishable();

CREATE TABLE secrets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose      text NOT NULL,
  key_version  smallint NOT NULL,
  nonce        bytea NOT NULL CHECK (octet_length(nonce) = 12),
  ciphertext   bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE partner_integrations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE RESTRICT,
  authoritative_channel    source_channel NOT NULL DEFAULT 'form',
  access_mode              text CHECK (access_mode IN ('direct', 'surfeduhub')),
  oeapi_version            text NOT NULL DEFAULT '5' CHECK (oeapi_version IN ('5', '6')),
  consumer_profile         text NOT NULL DEFAULT 'eduxchange',
  base_url                 text CHECK (base_url ~ '^https://[^/?#@]+(/[^?#]*)?$'),
  auth_scheme              text NOT NULL DEFAULT 'none' CHECK (auth_scheme IN
                             ('none', 'basic', 'bearer', 'api_key_header')),
  api_key_header_name      text CHECK (api_key_header_name ~ '^[A-Za-z0-9-]{1,64}$'),
  secret_ref               text CHECK (secret_ref ~ '^(db:[0-9a-f-]{36}|openbao:[A-Za-z0-9/_-]+)$'),
  surfeduhub_endpoint_id   text,
  approved_host            text,
  approved_by              text,
  approved_at              timestamptz,
  schedule_cron            text NOT NULL DEFAULT '0 3 * * *',
  schedule_timezone        text NOT NULL DEFAULT 'Europe/Brussels',
  page_size                smallint NOT NULL DEFAULT 100 CHECK (page_size BETWEEN 10 AND 250),
  max_requests_per_second  numeric(4,1) NOT NULL DEFAULT 2 CHECK (max_requests_per_second > 0),
  withdraw_after_absences  smallint NOT NULL DEFAULT 3 CHECK (withdraw_after_absences BETWEEN 1 AND 30),
  enabled                  boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (authoritative_channel <> 'oeapi' OR access_mode IS NOT NULL),
  CHECK (access_mode IS DISTINCT FROM 'direct' OR base_url IS NOT NULL),
  CHECK (access_mode IS DISTINCT FROM 'surfeduhub' OR surfeduhub_endpoint_id IS NOT NULL),
  CHECK (auth_scheme = 'none' OR secret_ref IS NOT NULL),
  CHECK (auth_scheme <> 'api_key_header' OR api_key_header_name IS NOT NULL)
);

CREATE TABLE sync_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  channel            source_channel NOT NULL,
  trigger_kind       text NOT NULL CHECK (trigger_kind IN ('schedule', 'manual', 'upload', 'form')),
  triggered_by       text,
  schema_version     text NOT NULL,                 -- 'oeapi-5.0', 'csv-1.0', 'form-1'
  upload_object_key  text,
  status             sync_run_status NOT NULL DEFAULT 'queued',
  is_complete        boolean NOT NULL DEFAULT false,
  started_at         timestamptz,
  finished_at        timestamptz,
  n_created          integer NOT NULL DEFAULT 0,
  n_updated          integer NOT NULL DEFAULT 0,
  n_unchanged        integer NOT NULL DEFAULT 0,
  n_rejected         integer NOT NULL DEFAULT 0,
  n_withdrawn        integer NOT NULL DEFAULT 0,
  error_summary      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (finished_at IS NULL OR (started_at IS NOT NULL AND finished_at >= started_at))
);
CREATE INDEX sync_runs_org_recent ON sync_runs (organization_id, created_at DESC);

CREATE TABLE sync_errors (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sync_run_id   uuid NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  severity      text NOT NULL CHECK (severity IN ('error', 'warning')),
  code          text NOT NULL,
  message       text NOT NULL,
  entity_type   text,
  ext_id        text,
  file          text CHECK (file IN ('courses', 'offerings')),
  row_number    integer CHECK (row_number > 0),
  column_name   text,
  json_pointer  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_errors_run ON sync_errors (sync_run_id);

CREATE TABLE ext_metadata_history (
  id                 bigint GENERATED ALWAYS AS IDENTITY,
  received_at        timestamptz NOT NULL DEFAULT now(),
  sync_run_id        uuid NOT NULL REFERENCES sync_runs(id) ON DELETE RESTRICT,
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  entity_type        text NOT NULL CHECK (entity_type IN
                       ('organization', 'academic_session', 'course', 'course_offering')),
  entity_id          uuid,
  ext_id             text NOT NULL,
  channel            source_channel NOT NULL,
  schema_version     text NOT NULL,
  payload_sha256     bytea NOT NULL CHECK (octet_length(payload_sha256) = 32),
  validation_result  text NOT NULL CHECK (validation_result IN ('accepted', 'rejected')),
  raw_payload        jsonb NOT NULL,
  PRIMARY KEY (id, received_at)
) PARTITION BY RANGE (received_at);
CREATE INDEX ext_history_lookup ON ext_metadata_history (organization_id, entity_type, ext_id, received_at DESC);
CREATE TABLE ext_metadata_history_default PARTITION OF ext_metadata_history DEFAULT;
CREATE TABLE ext_metadata_history_2026_11 PARTITION OF ext_metadata_history
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE admin_invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  role             text NOT NULL CHECK (role IN ('partner_admin', 'alliance_admin')),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  token_sha256     bytea NOT NULL UNIQUE CHECK (octet_length(token_sha256) = 32),
  invited_by       text NOT NULL,
  expires_at       timestamptz NOT NULL,
  accepted_at      timestamptz,
  accepted_sub     text,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_sub     text NOT NULL,                      -- JWT sub or 'system:<job>'
  actor_org_id  uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     uuid,
  changes       jsonb
);
CREATE INDEX audit_log_entity ON audit_log (entity_type, entity_id, occurred_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations', 'academic_sessions', 'courses', 'course_texts',
                           'course_offerings', 'partner_integrations', 'secrets'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   t || '_set_updated_at', t);
  END LOOP;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('oecp_en', 'english', 'english_stem'), ('oecp_de', 'german', 'german_stem'),
      ('oecp_nl', 'dutch', 'dutch_stem'),     ('oecp_it', 'italian', 'italian_stem'),
      ('oecp_fr', 'french', 'french_stem'),   ('oecp_da', 'danish', 'danish_stem'),
      ('oecp_es', 'spanish', 'spanish_stem'), ('oecp_ca', 'catalan', 'catalan_stem'),
      ('oecp_simple', 'simple', 'simple')) AS v(cfg, base, dict) LOOP
    EXECUTE format('CREATE TEXT SEARCH CONFIGURATION %I (COPY = pg_catalog.%I)', r.cfg, r.base);
    EXECUTE format('ALTER TEXT SEARCH CONFIGURATION %I ALTER MAPPING FOR hword, hword_part, word WITH unaccent, %I',
                   r.cfg, r.dict);
  END LOOP;
END $$;

CREATE FUNCTION oecp_ts_config(lang text) RETURNS regconfig LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (CASE split_part(lower(lang), '-', 1)
    WHEN 'en' THEN 'oecp_en' WHEN 'de' THEN 'oecp_de' WHEN 'nl' THEN 'oecp_nl' WHEN 'it' THEN 'oecp_it'
    WHEN 'fr' THEN 'oecp_fr' WHEN 'da' THEN 'oecp_da' WHEN 'es' THEN 'oecp_es' WHEN 'ca' THEN 'oecp_ca'
    ELSE 'oecp_simple' END)::regconfig
$$;

CREATE FUNCTION oecp_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;

CREATE FUNCTION oecp_course_tsv(lang text, title text, keywords text[], abstract text, body text)
RETURNS tsvector LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE cfg regconfig := oecp_ts_config(lang);
BEGIN
  RETURN setweight(to_tsvector(cfg, coalesce(title, '')), 'A')
      || setweight(to_tsvector(cfg, coalesce(array_to_string(keywords, ' '), '')), 'A')
      || setweight(to_tsvector(cfg, coalesce(abstract, '')), 'B')
      || setweight(to_tsvector(cfg, coalesce(body, '')), 'C');
END $$;

ALTER TABLE course_texts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS
  (oecp_course_tsv(lang, title, keywords, abstract,
                   coalesce(description, '') || ' ' || coalesce(learning_outcomes, ''))) STORED;

CREATE INDEX course_texts_fts        ON course_texts USING gin (search_vector);
CREATE INDEX course_texts_title_trgm ON course_texts USING gin (lower(oecp_unaccent(title)) gin_trgm_ops);
CREATE INDEX courses_org_status      ON courses (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX offerings_course_dates  ON course_offerings (course_id, start_date) WHERE deleted_at IS NULL;
CREATE INDEX offerings_languages     ON course_offerings USING gin (teaching_languages);
CREATE INDEX isced_broad             ON course_isced_codes (broad_code);
CREATE INDEX offering_modes_code     ON course_offering_delivery_modes (mode_code);
```

**0002_seed_reference** (ISCED-F 2013 broad fields; organizations are seeded by the CLI):

```sql
INSERT INTO isced_broad_fields (code, label) VALUES
  ('00', '{"en": "Generic programmes and qualifications"}'),
  ('01', '{"en": "Education"}'),
  ('02', '{"en": "Arts and humanities"}'),
  ('03', '{"en": "Social sciences, journalism and information"}'),
  ('04', '{"en": "Business, administration and law"}'),
  ('05', '{"en": "Natural sciences, mathematics and statistics"}'),
  ('06', '{"en": "Information and Communication Technologies (ICTs)"}'),
  ('07', '{"en": "Engineering, manufacturing and construction"}'),
  ('08', '{"en": "Agriculture, forestry, fisheries and veterinary"}'),
  ('09', '{"en": "Health and welfare"}'),
  ('10', '{"en": "Services"}'),
  ('99', '{"en": "Field unknown"}')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label;
```

**0003_partner_base_url_http** (http allowed in the database; the API and harvester enforce `https:443` unless `OECP_ALLOW_INSECURE_PARTNER_HTTP=true`):

```sql
ALTER TABLE partner_integrations DROP CONSTRAINT IF EXISTS partner_integrations_base_url_check;
ALTER TABLE partner_integrations ADD CONSTRAINT partner_integrations_base_url_check
  CHECK (base_url ~ '^https?://[^/?#@]+(/[^?#]*)?$');
```

**0004_search** (Catalan stemmer assertion, explicit `cs`/`is` mapping, reweighted search vector, folded-title trigram index, partial indexes for published rows):

```sql
DO $$
BEGIN
  PERFORM 'pg_catalog.catalan'::regconfig;
  PERFORM 'pg_catalog.catalan_stem'::regdictionary;
EXCEPTION WHEN undefined_object THEN
  RAISE EXCEPTION 'Snowball text search configuration "catalan" is missing (PostgreSQL 14+ required)';
END $$;

CREATE OR REPLACE FUNCTION oecp_ts_config(lang text) RETURNS regconfig
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (CASE split_part(lower(lang), '-', 1)
    WHEN 'en' THEN 'oecp_en' WHEN 'de' THEN 'oecp_de' WHEN 'nl' THEN 'oecp_nl' WHEN 'it' THEN 'oecp_it'
    WHEN 'fr' THEN 'oecp_fr' WHEN 'da' THEN 'oecp_da' WHEN 'es' THEN 'oecp_es' WHEN 'ca' THEN 'oecp_ca'
    WHEN 'cs' THEN 'oecp_simple' WHEN 'is' THEN 'oecp_simple'
    ELSE 'oecp_simple' END)::regconfig
$$;

CREATE FUNCTION oecp_search_fold(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1))
$$;

CREATE FUNCTION oecp_course_search_vector(
  lang text, title text, keywords text[], abstract text,
  description text, learning_outcomes text, prerequisites text, assessment text)
RETURNS tsvector LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE cfg regconfig := oecp_ts_config(lang);
BEGIN
  RETURN setweight(to_tsvector(cfg, coalesce(title, '')), 'A')
      || setweight(to_tsvector(cfg, coalesce(array_to_string(keywords, ' '), '') || ' '
                                    || coalesce(abstract, '')), 'B')
      || setweight(to_tsvector(cfg, concat_ws(' ', description, learning_outcomes,
                                              prerequisites, assessment)), 'C');
END $$;

-- PostgreSQL 16 cannot change a generation expression in place: drop and re-add
-- (the column's GIN index goes with it and is recreated below).
ALTER TABLE course_texts DROP COLUMN search_vector;
ALTER TABLE course_texts ADD COLUMN search_vector tsvector GENERATED ALWAYS AS
  (oecp_course_search_vector(lang, title, keywords, abstract, description,
                             learning_outcomes, prerequisites, assessment)) STORED;
CREATE INDEX course_texts_fts ON course_texts USING gin (search_vector);

DROP INDEX course_texts_title_trgm;
CREATE INDEX course_texts_title_trgm ON course_texts USING gin (oecp_search_fold(title) gin_trgm_ops);

CREATE INDEX courses_published ON courses (organization_id)
  WHERE status = 'published' AND deleted_at IS NULL;
CREATE INDEX offerings_course_visible ON course_offerings (course_id, start_date, end_date)
  WHERE status IN ('published', 'cancelled') AND deleted_at IS NULL;

DROP FUNCTION oecp_course_tsv(text, text, text[], text, text);
```

**0005_alliance_attributes** [DL 18] (course kind, multi-valued levels, alliance attributes, application instructions, attribute definitions; the backfill keeps `updated_at`):

```sql
CREATE FUNCTION oecp_valid_attributes(a jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT jsonb_typeof(a) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(a) AS e(key, value)
    WHERE e.key !~ '^[a-z][a-z0-9_]{1,39}$'
       OR NOT (
         jsonb_typeof(e.value) IN ('string', 'boolean')
         OR (jsonb_typeof(e.value) = 'array'
             AND jsonb_array_length(e.value) > 0
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(e.value) AS v(item)
                             WHERE jsonb_typeof(v.item) <> 'string'))))
$$;

CREATE FUNCTION oecp_valid_language_texts(m jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT jsonb_typeof(m) = 'object' AND NOT EXISTS (
    SELECT 1 FROM jsonb_each(m) AS e(key, value)
    WHERE e.key !~ '^[a-z]{2,3}$' OR jsonb_typeof(e.value) <> 'string' OR e.value = '""'::jsonb)
$$;

CREATE FUNCTION oecp_valid_attribute_options(o jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT jsonb_typeof(o) = 'array' AND jsonb_array_length(o) > 0 AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(o) AS e(item)
    WHERE jsonb_typeof(e.item) <> 'object'
       OR jsonb_typeof(e.item -> 'value') IS DISTINCT FROM 'string'
       OR (e.item ->> 'value') !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
       OR jsonb_typeof(e.item -> 'label') IS DISTINCT FROM 'object'
       OR NOT ((e.item -> 'label') ? 'en'))
  AND (SELECT count(DISTINCT e.item ->> 'value') FROM jsonb_array_elements(o) AS e(item))
      = jsonb_array_length(o)
$$;

ALTER TABLE courses
  ADD COLUMN kind text NOT NULL DEFAULT 'course'
    CONSTRAINT courses_kind_check CHECK (kind IN ('course', 'bip', 'lecture_series', 'other')),
  ADD COLUMN levels text[] NOT NULL DEFAULT '{}'
    CONSTRAINT courses_levels_check CHECK (
      levels <@ ARRAY['short_cycle', 'bachelor', 'master', 'doctoral', 'other']::text[]
      AND cardinality(levels) <= 5),
  ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT courses_attributes_check CHECK (oecp_valid_attributes(attributes));

SET CONSTRAINTS courses_publishable IMMEDIATE;
ALTER TABLE courses DISABLE TRIGGER courses_set_updated_at;
UPDATE courses SET levels = ARRAY[level] WHERE level IS NOT NULL;
ALTER TABLE courses ENABLE TRIGGER courses_set_updated_at;
SET CONSTRAINTS courses_publishable DEFERRED;

CREATE INDEX courses_attributes ON courses USING gin (attributes jsonb_path_ops);

ALTER TABLE course_offerings
  ADD COLUMN application_instructions jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT course_offerings_application_instructions_check
    CHECK (oecp_valid_language_texts(application_instructions));

CREATE TABLE attribute_definitions (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  value_type   text NOT NULL CHECK (value_type IN ('enum', 'multi_enum', 'boolean', 'text')),
  label        jsonb NOT NULL CHECK (jsonb_typeof(label) = 'object' AND label ? 'en'),
  description  jsonb CHECK (description IS NULL
                            OR (jsonb_typeof(description) = 'object' AND description ? 'en')),
  options      jsonb CHECK (options IS NULL OR oecp_valid_attribute_options(options)),
  filterable   boolean NOT NULL DEFAULT false,
  show_as_tag  boolean NOT NULL DEFAULT true,
  sort_order   smallint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- options are required for enum/multi_enum and meaningless otherwise.
  CHECK ((value_type IN ('enum', 'multi_enum')) = (options IS NOT NULL))
);
CREATE TRIGGER attribute_definitions_set_updated_at BEFORE UPDATE ON attribute_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### 5.2 Rules the database does not enforce

- **`level` and `levels`** [DL 18 d]: `levels` holds every study cycle, primary first; `CanonicalWriter` keeps `level = levels[1]` (SQL 1-based) on every write, without a trigger. **Note for the owner:** `level` survives only because the OEAPI v5 read API can express one level; a manual SQL update of `levels` alone leaves `level` stale.
- **Attributes** [DL 18 a]: the writer checks values against `attribute_definitions`: unknown key → `oecp.content.unknown_attribute`; wrong type → `oecp.content.invalid_attribute_value`; value outside the options → `oecp.content.unknown_attribute_option`. Types: `boolean`, `enum`, `multi_enum` (unique list in option order), `text` (≤ 500 characters); ≤ 200 options per definition.
- **Aurora definitions** (`apps/api/db/seed/attribute-definitions.aurora.json`): `educational_hub` (multi_enum, 6 hubs), `sdg` (multi_enum, 17), `competence_framework` (enum `louis`/`none`), `micro_credential`, `free_course`, `enrolled_only`, `open_to_alliance` (boolean), `target_audience` (multi_enum `students`/`phd_candidates`/`staff`) [Partial: backlog "Confirm the Aurora attribute definitions"]. **Note for the owner:** the default seed `attribute-definitions.json` is the same Aurora list, so another alliance inherits it unless it passes `--file`.

### 5.3 Overrides [DL 12] [Implemented]

Manual values over harvested data live in the `overrides` jsonb of `courses`, `course_texts` and `course_offerings`:

```json
{ "<field>": { "value": <json>, "by": "<JWT sub>", "at": "<ISO 8601>", "source": <json|null> } }
```

Columns hold the **effective** value. `source` is the value the source last delivered, refreshed on every changed payload, so clearing an override restores it at once (a legacy entry without `source` resets `content_hash` for the next harvest to rewrite). `content_hash` is computed **before** overrides, so overrides survive every harvest. A language that exists only through overrides keeps its `title` as an override and goes when that is cleared. A `status` override wins over the harvested status and over withdrawal by absence.

### 5.4 History and search

**History.** `ext_metadata_history` stores a payload (accepted or rejected) only when its RFC 8785 SHA-256 differs from the latest of the same `(organization_id, entity_type, ext_id)`; offerings use `<course code>#<offering code>`. [Partial]: only the partitions `_default` and `_2026_11` exist; the monthly partition job and 12-month purge [Deferred: not in backlog]. **Note for the owner:** from December 2026 every row lands in the default partition until that job exists.

**Search** [Implemented]: weights A title; B keywords, abstract; C description, outcomes, prerequisites, assessment; `unaccent` throughout; `pg_trgm` on `oecp_search_fold(title)`. Catalan uses Snowball `catalan` (asserted by migration 0004 and the Compose init script); Czech and Icelandic use `oecp_simple`. The §10 performance target has not been measured.

## 6. Ingestion (anti-corruption layer)

### 6.1 Common pipeline [Implemented]

Adapter → source validation → canonical DTO (`packages/schemas/src/canonical.ts`) → canonical Zod schema → SHA-256 of the RFC 8785 serialisation → `CanonicalWriter` (natural key, override merge, `levels`/`level`, attribute check, status audit) → `ext_metadata_history`, `sync_errors`. The hash covers every canonical member, `kind`, `levels`, `attributes` and `application_instructions` included, except an offering's `seats_updated_at`. An equal hash only refreshes `last_seen_at` and `absent_count` (and an overridden status), so every channel is idempotent. Each harvest, upload or form save is one `sync_runs` row (`schema_version` `oeapi-5.0`, `csv-1.1`, `form-1`).

### 6.2 Channel A: scheduled OEAPI harvester [Implemented, mock-verified]

**6.2.1 Scheduling.** Pull only [DL 3]. A partner is scheduled only when `enabled`, `oeapi`-authoritative, not deleted and without blocker (access mode, endpoint id, SURFeduhub credential, `https:443`, `approved_host` = host of `base_url`); default `0 3 * * *` `Europe/Brussels`. "Sync now" also works with `enabled = false`. A run lasts at most 2 h (`oecp.oeapi.run_timeout`); `running` rows older than 2 h 10 min are failed before a new run starts.

**6.2.2 Access modes** [DL 14]:

- `direct`: `base_url` (path prefix allowed), `auth_scheme` `none`, `basic` (`username:password`), `bearer` or `api_key_header`, secret by `secret_ref`.
- `surfeduhub` (fallback): `SURFEDUHUB_GATEWAY_URL` with `X-Route: endpoint={surfeduhub_endpoint_id}` and the alliance Basic credential `SURFEDUHUB_SECRET_REF` (unset → 422 `oecp.integration.surfeduhub_unavailable`).

Secrets are `db:<uuid>` rows of `secrets`: AES-256-GCM, 12-byte nonce, AAD bound to id, purpose and key version 1; master key = base64 of 32 bytes in `OECP_MASTER_KEY_FILE`. `openbao:` references pass the CHECK but have no provider [Deferred to v1].

**6.2.3 Requests.** OEAPI **v5.0** only (v6 in v1). `Accept: application/json`; every request carries `consumer={consumer_profile}` (default `eduxchange`, kept across redirects); no `alliances.name` [RP]. Order:

1. `GET /organizations?organizationType=root`: the first root is matched to the partner, never created; if `organizations.ext_id` is set, the root's `primaryCode.code` or `organizationId` must equal it, else the run fails (`oecp.oeapi.root_not_matched`).
2. `GET /courses`; courses repeated across pages are skipped.
3. Per course: `GET /courses/{courseId}/offerings?since={today − 365 days}`; offerings starting earlier never count as absent.
4. Per offering: `GET /offerings/{offeringId}?expand=academicSession`; on failure the listing item is used (`oecp.oeapi.detail_unavailable`).

Paging: `pageSize` = `page_size` (10–250, default 100), `pageNumber` 1, 2, … until `hasNextPage = false` (`totalPages` ignored), cap 1,000 pages.

**6.2.4 Mapping v5 → canonical** (`oeapi-v5.adapter.ts`):

| OEAPI v5 | Canonical | Rule |
|---|---|---|
| course `primaryCode.code` | `ext_id` | required (`oecp.oeapi.missing_primary_code`), ≤ 200 |
| offering `primaryCode.code`, else `offeringId` | `ext_offering_id` | ≤ 200 |
| `courseId`, `offeringId` | `source_ref` | |
| `name`; `abstract`, `description`, `admissionRequirements`, `assessment`; `learningOutcomes[][]` | `course_texts` `title`; `abstract`, `description`, `prerequisites`, `assessment`; `learning_outcomes` (joined by blank lines) | per language with a name (others dropped with a warning); first variant wins; titles cut to 500 |
| `studyLoad` | `ects` | unit `ects`, 0 < value ≤ 120, else rejected |
| `fieldsOfStudy` | ISCED codes, first = primary | invalid or unknown broad field → warning |
| `level` | `levels`, `level`, `eqf_level` | bachelor/master/doctoral 1:1 (EQF 6–8), `associate degree` → `short_cycle` (EQF 5), other → `other`, absent → none |
| `link` | `info_url` (course), `application_url` (offering) | https only, else dropped with a warning |
| `startDate`, `endDate`, `enrollStartDate`, `enrollEndDate` | `start_date`, `end_date`, `enrol_start_date`, `application_deadline` | |
| expanded `academicSession` | `academic_sessions` | `ext_id = academicSessionId`; unknown type → `period`; invalid → warning, no session |
| `teachingLanguage` | `teaching_languages` (one value) | offering, else course |
| `modeOfDelivery` | delivery modes | offering, else course; `online`, `distance-learning` → `online`; `on campus`, `situated` → `presential`; `hybrid`; none mappable → rejected |
| `maxNumberStudents`, `enrolledNumberStudents`, `pendingNumberStudents` | `max_students`, `seats_available = max(0, max − enrolled − pending)`, `seats_updated_at` = fetch time | seats only with max > 0 and enrolled [DL 8] |
| `ext.oecp.applicationInstructions` (optional extension) | `application_instructions` | `[{language, value}]` or `{lang: text}`; else ignored with a warning |
| — | `timezone`, `contact_email` | organization defaults; no person data, `coordinators` never expanded |
| — | `status` | course `published` with an English title, else `draft` + warning `oecp.content.english_missing`; offering `published` |
| — | `kind`, `attributes`, `teaching_hours`, `campus`, `alliance_seats`, teaching unit | `course`, `{}`, null |

**Languages.** ISO 639-2 B and T codes normalise to ISO 639-1 where one exists (`ger`/`deu` → `de`, `ice`/`isl` → `is`, `dut`/`nld` → `nl`, `cze`/`ces` → `cs`); others stay three-letter; `mul`, `und`, `zxx`, `mis` are dropped with a warning; text tags reduce to the primary subtag.

**Note for the owner:** an offering with no usable teaching language on offering or course (`mul`, `und`, missing, invalid) is **rejected** (`oecp.oeapi.missing_teaching_language`), not published with a fallback (backlog "Decide: offering with no usable teaching language").

**Note for the owner:** the harvester always sends `kind: "course"` and `attributes: {}`; OEAPI partners cannot deliver alliance attributes or BIP/lecture-series kinds. Administrators add them as overrides, which survive every harvest.

**6.2.5 Withdrawal by absence.** A run is complete when every listing page answered 2xx, nothing fatal happened and at least one course came back; only complete runs count absence. If ≥ 30% of the partner's published courses are missing, nothing is counted (`oecp.oeapi.mass_absence`; no notification is sent [Deferred: not in backlog]). Otherwise absent `draft`/`published` courses and offerings (offerings with `start_date ≥ since`) get `absent_count + 1` and, at `withdraw_after_absences` (default 3), become `withdrawn` unless a `status` override exists (audit actor `system:harvester`, reason `absence`). A seen entity resets `absent_count`; a published source republishes an entity withdrawn by absence (audit `*.republish`, reason `seen_again`). A failed, empty or incomplete run never withdraws [DL 3].

**Note for the owner:** v4.0 said seen entities "even rejected ones" are republished. As built, a rejected entity only resets `absent_count` and `last_seen_at` and stays withdrawn until a valid payload arrives.

**6.2.6 Failures and outbound security.** A rejection writes `sync_errors` (JSON Pointer into the harvested document) and a `rejected` history row, and processing continues; offerings of a rejected course are rejected without detail requests; duplicate natural keys in one run are rejected. Run status: `failed` (fatal error before anything was processed), `succeeded` (complete, no rejections), else `partial`. `unauthorized`, `host_not_approved`, `address_refused`, `insecure_url`, `unreachable` and `run_timeout` abort the run.

HTTP: 30 s per request; up to 5 retries on 429, 5xx, timeouts and network errors (exponential backoff with jitter, 60 s cap; `Retry-After` honoured up to 300 s); token bucket at `max_requests_per_second`; bodies ≤ 20 MB. SSRF: only `approved_host` (direct) or the gateway host; `https` on 443; every DNS answer must be public unicast (loopback, RFC 1918, CGNAT, ULA, link-local, multicast, documentation and reserved ranges refused, also when embedded in IPv6) and the connection is pinned to the checked address; redirects only to the same scheme and host, at most 3. Changing the host of `base_url` clears the approval. **`OECP_ALLOW_INSECURE_PARTNER_HTTP=true`** (development only, warned at worker start) admits `http`, any port, loopback, private, CGNAT and ULA addresses.

### 6.3 Channel B: CSV upload [Implemented]

**Format, template 1.1** (`packages/schemas/src/csv.ts`). `courses.csv` and/or `offerings.csv` (courses first); strict UTF-8, BOM stripped; RFC 4180; comma, or semicolon when the header has no comma; exact header names in any order; real calendar dates `YYYY-MM-DD`; decimal point; multi-values separated by `|`; language columns suffixed `_<lang>`. The header is row 1. An empty cell clears the field; a column absent from the header leaves it untouched; a language whose cells are all empty is deleted (warning; never `en`). Omission never withdraws: set `status`.

| File | Required columns | Optional columns |
|---|---|---|
| `courses.csv` | `template_version` (`1.0`/`1.1`), `course_code` (`^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$`), `status`, `ects` (≤ 3 digits, ≤ 2 decimals, 0 < x ≤ 120), `isced_codes` (`\|`-separated, first primary, no duplicates), `title_en` (≤ 500) | `kind`¹, `levels`¹ (`\|`-separated, primary first), `level` (not together with `levels`: `oecp.csv.conflicting_columns`), `eqf_level` (1–8), `teaching_hours`, `teaching_unit_code`, `info_url` (https), `contact_email`; per language `title_`, `abstract_`, `description_`, `learning_outcomes_`, `prerequisites_`, `assessment_`, `keywords_` (`\|`-separated); `attr_<key>`¹ per attribute definition |
| `offerings.csv` | `template_version`, `course_code` (in the catalogue or in the same upload), `offering_code`, `status`, `start_date`, `end_date`, `teaching_languages` (BCP 47, `\|`), `delivery_modes` (active codes, `\|`) | `academic_session_code`, `enrol_start_date`, `application_deadline`, `timezone` (IANA; default the organization's), `campus` (≤ 200), `max_students`, `alliance_seats`, `seats_available` (sets `seats_updated_at` to upload time), `application_url` (https); `application_instructions_<lang>`¹ |

¹ Template 1.1 only: a row declaring `1.0` in a file with any 1.1 column fails (`oecp.csv.invalid_template_version`); 1.0 files stay valid. A non-English language needs `title_<lang>`. `attr_<key>` cells: booleans `true/false/yes/no/1/0`, `enum` one option, `multi_enum` `\|`-separated options, `text` ≤ 500; empty removes the attribute. An unknown `academic_session_code` creates a minimal session (type `period`, name = code, dates spanning its offerings).

**Templates** (any administrator): `GET /api/admin/v1/csv-template/courses.csv` (one `attr_<key>` column per definition), `…/offerings.csv`, `…/schema.json` (JSON Schema 2020-12 generated from the Zod row schemas; accepts 1.0) [Partial: no `$ref` to the canonical schema, backlog "CSV JSON Schema should $ref…"].

**Upload contract.** `POST /api/admin/v1/organizations/{orgId}/uploads`, `multipart/form-data`, file fields `courses` and/or `offerings`, one each, no other parts, ≤ 5 MiB per file. Limits: 5,000 rows per file, 300 columns, 20,000 characters per cell, 10 uploads per hour per organization. Files go to `{OECP_UPLOADS_DIR}/{orgId}/{uploadId}/`; a `sync_runs` row (`csv`/`upload`) and an `upload.create` audit row (names, sizes, SHA-256) are written first.

| Outcome | HTTP | Body |
|---|---|---|
| ≤ 500 data rows, processed in the request, succeeded | 201 | `{sync_run_id, status, processed_inline: true, run, warnings[]}` |
| > 500 rows, queued for the worker | 202 | `{sync_run_id, status: "queued", processed_inline: false}` |
| Inline run failed (nothing written) | 422 | problem+json, `errors[]` (≤ 1,000) plus `sync_run_id`, `run_status`, `processed_inline`, `error_count`, `warning_count` |
| No file / unexpected part | 400 | `oecp.csv.no_files` / `oecp.csv.unexpected_file` |
| Authoritative channel `oeapi` | 409 | `oecp.sync.channel_disabled` |
| File > 5 MiB | 413 | `oecp.csv.file_too_large` |
| Rate limit | 429 | `oecp.csv.rate_limited`, `Retry-After` |
| Queue unavailable | 503 | `oecp.internal` (run cancelled) |

Every response carries `Location: /api/admin/v1/sync-runs/{id}`.

**Validation.** One validator (`packages/schemas/src/csv-validate.ts`: decode, RFC 4180 parse, header, row, cross-row and reference checks) runs in the browser (Web Worker) and on the server, which always revalidates against the database. **All-or-nothing:** any error fails the run and writes only `sync_errors`; otherwise sessions, courses and offerings are written in one transaction; warnings pass. **CSV injection:** values are stored verbatim; every CSV OECP generates prefixes cells starting with `=`, `+`, `-`, `@`, TAB or CR with `'`.

**Retention** [Implemented]: a daily job deletes upload files older than 90 days (the run row stays, `upload_object_key` NULL, audit `upload.purge`), removes orphan directories and fails CSV runs stuck in `running`.

**Note for the owner:** the browser cannot check `offerings.csv` course codes against the catalogue (the admin reference has no course codes); only the server does (backlog "API: … reference with … course codes").

### 6.4 Channel C: web form [Implemented]

The course wizard posts canonical JSON (≤ 1 MB) to the admin courses API (§8.2). Each save is one transaction: a `sync_runs` row (`form`, `form-1`), the write and an audit row; a refused save writes nothing. Zod validation in browser and server, then database references (ISCED broad field, teaching unit, active modes, attributes) as 422 with JSON Pointers. Form languages: a fixed list of 29 EU/EEA primary subtags.

### 6.5 Rules between channels [DL 12]

One `authoritative_channel` per organization (no `partner_integrations` row means `form`).

| Authoritative channel | Harvester | CSV | Form (`form_mode`) |
|---|---|---|---|
| `oeapi` | runs | refused (409) | `overrides`: `PATCH …/overrides` and `POST …/status` only; create, replace and delete give 409 `oecp.sync.channel_disabled` |
| `csv` or `form` | not scheduled; "Sync now" 409 | writes | `write`: create, replace, status, delete; `PATCH …/overrides` gives 409 `oecp.content.override_not_allowed` |

CSV and form write the same records; `source_channel` records the last writer. A form save in `write` mode drops overrides left from an `oeapi` period. Switching keeps every `ext_id`; the first harvest after switching to `oeapi` matches by `(organization_id, ext_id)`.

**Note for the owner:** CSV uploads do **not** drop leftover overrides, so after switching from `oeapi` to `csv` an old override keeps masking the uploaded value until the record is saved in the form.

### 6.6 Error contract [Implemented]

RFC 9457 `application/problem+json` for `/api/public/v1` and `/api/admin/v1`: `type` (`about:blank` or `/problems/validation-failed`), `title`, `status`, `instance`, `detail?`, `errors[]` of `{code, severity, message, file?, row?, column?, pointer?, ext_id?}`. Codes are stable, defined in `error-codes.ts` and generated into `errors.json` (Appendix A). Request shape: 400; content: 422. `/oeapi/v5` uses the v5 `Problem` (`status` as a string).

```json
{ "type": "/problems/validation-failed", "title": "Upload validation failed", "status": 422,
  "instance": "/api/admin/v1/sync-runs/2f6c0c1e-6a3d-4c55-9a43-0f3d3c2b9a10",
  "errors": [ { "code": "oecp.csv.invalid_date", "severity": "error", "message": "Expected YYYY-MM-DD",
                "file": "offerings", "row": 14, "column": "start_date" } ],
  "sync_run_id": "2f6c0c1e-6a3d-4c55-9a43-0f3d3c2b9a10", "run_status": "failed",
  "processed_inline": true, "error_count": 1, "warning_count": 0 }
```

## 7. Public portal

### 7.1 Routes and API

| Item | As built | Status |
|---|---|---|
| Pages (Nuxt SSR, `/{locale}` prefix) | `/{locale}/` (home; answers 200 even when the API is down), `/{locale}/courses`, `/{locale}/courses/{id}` (`?text_lang=` picks the text language) | [Implemented] |
| `/{locale}/partners/{slug}`, `/accessibility`, `/privacy` | — | [Deferred: not in backlog; statement text in backlog "Docs: GDPR set…"] |
| `GET /api/public/v1/courses` · `/courses/{id}` | search with facets · course page (404 for malformed, unknown, unpublished or deleted ids) | [Implemented] |
| `GET /api/public/v1/suggest?q&limit&locale` | `q` 2–100 characters, `limit` ≤ 10 | [Implemented] |
| `GET /api/public/v1/reference` | organizations, active modes with `schema_org`, ISCED broad fields, teaching languages in use, levels, kinds, attribute definitions | [Implemented] |
| `GET /api/public/v1/sitemap.xml` | proxied as `/sitemap.xml` | [Implemented] |

**Search parameters:** `q` (≤ 200); repeatable `partner`, `mode`, `lang` (**teaching language**), `isced` (broad field), `level` (any of `levels`), `kind`, `attr_<key>` (≤ 20 keys; booleans `true`/`false`; unknown keys ignored); `ectsMin`/`ectsMax` (aliases `ects_min`/`ects_max`); `upcoming` (default `true`; `includeUnscheduled=true` is the old spelling of `false`); `sort` = `relevance` (default with `q`), `title`, `start_date` (default otherwise), `deadline` (next open application deadline first, none last); `page` (≤ 500); `pageSize`/`page_size` (≤ 50, default 20); `locale` (**display language**, English fallback). OR within a filter, AND across; facets (`partner`, `mode`, `lang`, `isced`, `level`, `kind`, one per `filterable` attribute) are disjunctive.

**Visibility and ranking.** Published, non-deleted courses; with `upcoming` a published offering must end today or later (UTC date). Text matching ORs one branch per text-search configuration so the GIN index applies; one word also matches as a prefix and, from 3 characters, by trigram similarity. Rank = `ts_rank_cd` + 0.3 × title trigram similarity.

**Shapes.** Search `{items, page, page_size, total, facets}`; cards carry resolved title and abstract (≤ 300 characters) with their languages, `levels`, tag attributes, current modes and languages and `next_offering`. The course page has every text language, attribute and published offering (past included), cancelled offerings not yet started, and the contact (course, else organization). Absent values are `null`.

**Caching** [Implemented]: `public, max-age=60` (search, suggest), `public, max-age=300` (course, reference, sitemap), only on success; weak `ETag`/304. No `Set-Cookie`.

### 7.2 Display rules

**URL state** [Implemented]: the page query uses the API parameter names, non-default values only, stable order; `locale` is sent only for non-English UIs.

**Seats** [DL 8] [Implemented]: "Seats available: N (as of date)" only when both `seats_available` and `seats_updated_at` are set; "Alliance seats: N" when `alliance_seats` is set; both, one or nothing. Remaining alliance seats are never computed.

**How to apply** [Implemented]: the partner's `application_instructions` (text language, English fallback), then "Apply at {partner} ({host})" opening `application_url` in a new tab, else a "contact the partner" line. Cancelled offerings stay listed with a badge until `start_date`, without seats or apply; passed deadlines are flagged.

**UI language** [Partial]: English only [DL 5]; `@nuxtjs/i18n` prefix strategy, `/` redirects by `Accept-Language` without cookie, `hreflang` from `NUXT_PUBLIC_I18N_BASE_URL`; partner UI languages in v1.

**JSON-LD** [Implemented]: `schema.org/Course` with `name`, `description`, `courseCode`, `url`, `sameAs`, `inLanguage`, `provider` (`CollegeOrUniversity`), `numberOfCredits` (ECTS), `educationalLevel`, `about`, `teaches`, `coursePrerequisites`, `keywords`, `hasCourseInstance[]` for non-cancelled offerings (`courseMode` from `delivery_modes.schema_org`, dates, languages, campus, application URL).

**Robots and sitemap** [Implemented]: `/robots.txt` disallows `/admin`, `/*/admin`, `/api/admin` and names the absolute sitemap; `/sitemap.xml` lists published courses as `{OECP_PUBLIC_BASE_URL}/en/courses/{id}` with `lastmod` (≤ 50,000 URLs, built on request).

**Privacy and headers**: no cookies, auth or analytics [Implemented]. Portal CSP [Deferred: backlog "CSP (nonce-based)…"]; `/api` and `/oeapi` get `default-src 'none'; frame-ancestors 'none'` from Traefik.

## 8. Admin dashboard and admin API

### 8.1 Dashboard (`/{locale}/admin`, client-rendered)

The dashboard shows the account and the modules of the selected organization: the token's `org_id`, or for an `alliance_admin` one chosen from `/api/public/v1/reference` (kept in `?org=`).

| Module | As built | Status |
|---|---|---|
| Courses | Filtered list (state in the URL); course page with wizard, status actions, delete, offerings, history | [Implemented] |
| Course wizard | basics → texts (English to publish) → attributes → review; offerings on their own pages; in `overrides` mode each field has an override toggle showing the source value, unticking reverts | [Implemented] |
| CSV console | Templates, drag-and-drop, Web Worker validation, error table and report, server result | [Implemented] |
| Sync monitor | Latest 50 runs of every channel; run page with errors by severity | [Implemented]; pending withdrawals and payload viewer [Deferred: not in backlog] |
| Integration settings | Read-only placeholder; no form, "Test connection" or "Sync now" buttons (the API exists) | [Partial: not in backlog] |
| Organizations, administrators, network status | Placeholder for organizations only | [Deferred: not in backlog] |

### 8.2 Admin API (`/api/admin/v1`) [Implemented]

Bearer-only (§4). P = `partner_admin` (own scope), A = `alliance_admin`. Repeated list parameters accept `k=a&k=b` or `k[]=a`.

| Method and path | Roles | Notes |
|---|---|---|
| `GET /me` · `POST /invitations/accept` | role-less allowed | §2.1 |
| `POST /invitations` (201) · `DELETE /invitations/{id}` (204) · `GET /invitations` | A · A · P, A | §2.1 |
| `GET`, `PUT /organizations/{orgId}/integration` | P, A | 404 `oecp.integration.not_configured` before the first `PUT` |
| `POST …/integration/approve-host` | A | approves the host of the current `base_url` (direct only) |
| `POST …/integration/test-connection` | P, A | `GET /` and `GET /courses?pageSize=1`; remote failures are 200 `{ok: false, error}`; blockers 409 |
| `POST …/integration/sync-now` | P, A | 202 `{sync_run_id, status: "queued"}`; 409 channel disabled, blocker or already running; 429 `oecp.sync.rate_limited` + `Retry-After` (15 min after the last manual run) |
| `GET /organizations/{orgId}/sync-runs?limit` · `GET /sync-runs/{id}?page&page_size&severity` | P, A | limit ≤ 100; errors ≤ 500 per page |
| `POST /organizations/{orgId}/uploads` · `GET /csv-template/…` | P, A | §6.3 |
| `GET /organizations/{orgId}/reference` | P, A | time zone, levels, kinds, modes, ISCED, form languages, attribute definitions, sessions, teaching units, `authoritative_channel`, `form_mode` |
| `GET`, `POST /organizations/{orgId}/courses` | P, A | list: `q`, `status`, `kind`, `source_channel`, `page`, `page_size` ≤ 100; create 201 + `Location` |
| `GET`, `PUT`, `DELETE /courses/{id}` · `PATCH …/overrides` · `POST …/status` · `GET …/history?limit` | P, A | history ≤ 200 entries: ingest rows (no payload) and audit rows with a one-line summary |
| `POST /courses/{id}/offerings` · `GET`, `PUT`, `DELETE /offerings/{id}` · `PATCH …/overrides` · `POST …/status` | P, A | as for courses |

**Integration settings** (`PUT`, full document, defaults in brackets): `authoritative_channel` [`form`], `access_mode` [null; required for `oeapi`], `oeapi_version` [`"5"`, the only value], `consumer_profile` [`eduxchange`], `base_url`, `auth_scheme` [`none`], `api_key_header_name`, `secret` (write-only: omitted keeps, `null` deletes, a string replaces; stored as `db:<uuid>`), `surfeduhub_endpoint_id`, `schedule_cron` [`0 3 * * *`], `schedule_timezone` [`Europe/Brussels`], `page_size` [100], `max_requests_per_second` [2], `withdraw_after_absences` [3], `enabled` [false; only with `oeapi`]. Responses never return the credential (`secret_configured`, `host_approved`, `last_run`). Every change is audited with from/to values.

**Course and offering writes.** Create defaults to `draft` (`published` needs `texts.en`); `withdrawn`/`cancelled` only through `…/status`. `PUT` is a full replace: omitted languages are deleted except English; codes are immutable (409 `oecp.content.ext_id_immutable`). Re-creating a soft-deleted code revives it without old overrides; an existing code gives 409 `oecp.content.duplicate_ext_id`. Delete is soft and refused for harvested records, courses with published offerings and published offerings (409). Offerings default `timezone` to the organization's; `seats_available` stamps `seats_updated_at`. Responses carry effective values plus `overrides`, `override_meta` (`{by, at}`) and `source_values`.

### 8.3 Overrides API

`PATCH …/overrides` `{set: {key: value}, clear: [key]}`: at least one change, ≤ 100 keys each, no key in both. Course keys: `status`, `kind`, `levels`, `ects`, `teaching_hours`, `info_url`, `contact_email`, `attributes`, `isced_codes`, `texts.<lang>.<field>` (`title`, `abstract`, `description`, `learning_outcomes`, `prerequisites`, `assessment`, `keywords`; a new language needs its title). Offering keys: `status`, the four dates, `timezone`, `teaching_languages`, `delivery_modes`, `campus`, `max_students`, `alliance_seats`, `seats_available`, `application_url`, `application_instructions`. Values have the shape of the create body; the effective record is validated before storing. In `overrides` mode `POST …/status` stores a `status` override.

## 9. Public read API (OEAPI v5-compatible) [Implemented]

Anonymous, read-only: `GET /oeapi/v5/`, `/organizations[/{id}[/courses]]` (the alliance root lists every course), `/academic-sessions[/{id}]`, `/courses[/{id}[/offerings]]`, `/offerings/{id}`; contract-tested against the v5.0 OpenAPI.

- **Scope.** Published courses, published or cancelled offerings, non-deleted organizations and sessions. IDs are OECP UUIDs; `primaryCode`: `identifier` = `ext_id` (courses, sessions), `offeringCode` (offerings), `schacHome` or slug (organizations; `x-erasmusCode`, `x-pic` in `otherCodes`).
- **`consumer`** [DL 19]: absent or `oecp` returns the catalogue; any other value (e.g. `eduxchange`) returns an empty page. Courses and offerings list `consumers: [{consumerKey: "oecp", alliances: [{name: <alliance slug>}]}]`. Reversible in one condition of `OeapiService.foreignConsumer()`. **Note for the owner:** v4.0 §9 presented this API as harvestable "by eduXchange included"; with [DL 19] eduXchange, which always sends `consumer=eduxchange`, receives nothing, by design.
- **Paging and filters.** `pageSize` 1–250 (default 10), `pageNumber`. Courses: `teachingLanguage` (ISO 639-2), `level`, `modeOfDelivery`, `q`, `sort`, `expand=organization`. Offerings: v5 `since` (default today), `until`, `sort`, `expand=academicSession,course`. Organizations and sessions: type, `q`/`parent`, `sort`, `expand`.
- **Mapping out.** Alliance → `root`, institution → `institute`, campus → `branch`. Modes: `presential` → `on campus`; `online`, `coil` → `online`; others → `hybrid`. `teachingLanguage`: ISO 639-2/T of a representative offering's first language. `level`: `short_cycle` → `associate degree`, `other`/none → `undefined`. `fieldsOfStudy`: primary ISCED code, four digits.
- **`ext.oecp`.** Course: `kind`, `level`, `levels`, `eqfLevel`, `teachingHours`, `iscedCodes`, `abstract`, `keywords`, `teachingUnit`, `contactEmail`, `attributes`, `updatedAt`. Offering: `status`, `timezone`, `teachingLanguages`, `deliveryModes`, `campus`, `allianceSeats`, `seatsAvailable`, `seatsUpdatedAt`, `applicationInstructions`. Organization: `slug`, `orgType`, `isPartner`. Session: `organizationId`. Service document: `alliance`, `portal`, `publicApi` (`contactEmail` = alliance contact, else `SMTP_FROM`).
- **Caching and errors.** `Cache-Control: public, max-age=300`, weak `ETag`; errors as v5 `Problem`. `/oeapi/v6` [Deferred to v1].

## 10. Non-functional requirements

| Requirement | As built | Status |
|---|---|---|
| GDPR roles | Aurora Foundation controller, URV processor [DL 2] | art. 28 contract, RoPA, DPIA [Deferred: backlog "Docs: GDPR set"] |
| Availability, RPO/RTO, search p95 < 300 ms at 50 req/s | not measured | [Deferred: not in backlog] |
| Deliverables [DL 10] | `deploy/compose`: traefik, postgres, valkey, keycloak, keycloak-config, api, worker, web; profiles `dev`, `observability` | [Implemented]; Helm (README only) [Deferred to v1] |
| Backups | volumes only | pgBackRest PITR [Deferred: backlog "pgBackRest…"] |
| Observability | profile `observability` (OTel Collector, Prometheus, Loki, Grafana); Traefik metrics; pino JSON logs | [Partial]: no OTel SDK in the apps (`OTEL_*` passed but unused), no alerts |
| Headers, TLS | HSTS, frame deny, referrer and permissions policies, API CSP; ACME prepared but commented out | [Partial]: portal CSP (§7.2) |
| Rate limits per IP (Traefik) | search 20 r/s (burst 40), suggest 10, `/oeapi/v5` 10, admin 30 | [Implemented] |
| Secrets | AES-256-GCM `secrets` table; Docker secrets for every password | [Implemented]; rotation tooling, OpenBao [v1] |
| Supply chain | CI: lint, format, type check, tests, `reuse lint`, DCO, `docker compose config`, Trivy; Dependabot | [Partial]: SBOM, Semgrep, cosign [Deferred: not in backlog] |
| Accessibility | WCAG 2.1 AA target; contrast unit test; `lang` on fallback texts | [Partial]: audit and statement [Deferred: backlog "Docs: GDPR set…"] |
| Retention | uploads 90 days, Keycloak events 90 days | other periods of v4.0 §10 [Deferred: not in backlog] |
| Testing | Vitest unit tests; API integration tests on a throwaway PostgreSQL | [Partial]: no Playwright, axe or k6 |

**Note for the owner:** CI runs the migrations on its PostgreSQL service but does not set `DATABASE_URL_TEST`, so every API integration suite is **skipped in CI**; they run only on developer machines.

**eduXchange data reuse** (unchanged): access agreements MUST record partner consent to republish eduXchange-tagged data through `/oeapi/v5` [RP].

## 11. Project and governance

```
apps/api  apps/web  packages/schemas  identity/keycloak  deploy/compose  deploy/helm
tools/oeapi-mock  tools/e2e-identity  docs/adr  docs/research  docs/review
```

- **Licence:** EUPL-1.2, released by Lluís Alfons Ariño [DL 2, DL 16]; REUSE metadata, `reuse lint` in CI.
- **Contributions:** DCO, inbound = outbound, no CLA [DL 11]; Contributor Covenant 2.1; `SECURITY.md`, `GOVERNANCE.md`, `publiccode.yml`; English.
- **Tooling:** pnpm, Node 22, Vitest, ESLint, Prettier, node-pg-migrate, Kysely (ADR-0006).
- **ADRs:** 0001–0005 as in v4.0, 0006 tooling; ADR-0007 onwards record decisions taken while building (`docs/adr/`).
- **Guides:** onboarding [DL 17] and data-provider guides follow the first tagged version (backlog).

## 12. Delivery phases

| Phase | Scope | Status on 2026-10-14 |
|---|---|---|
| **MVP** | as v4.0 §12 | Built: portal, read API, three channels, sync monitor, local-account identity with MFA, Compose. Open before go-live: real partner harvest, SAML login, integration/organizations/admins/network UIs, revocation, backups, observability SDK, CSP, accessibility audit, GDPR documents, maintenance jobs (§5.4) |
| **v1**, **v2** | as v4.0 §12 | Not started |

## 13. Glossary

| Term | Meaning |
|---|---|
| OEAPI | Open Education API (SURF); v5.0 stable, v6 unsettled |
| SURFeduhub | SURF gateway relaying consumer requests to institutional OEAPI endpoints [RP] |
| Canonical DTO | Channel-independent record handed to `CanonicalWriter` |
| Override | Manual value over a harvested field, kept with its source value (§5.3) |
| Authoritative channel | The one channel writing an organization's records (§6.5) |
| BIP | Erasmus+ Blended Intensive Programme |
| LoA / ACR | Level of authentication; `acr=mfa` = LoA 2 |

## Appendix A. Error codes

Generated from `packages/schemas/errors.json` (identical to `ERROR_CODES` in `error-codes.ts`): 122 codes, grouped by prefix; the text is the default English message. *(W)* marks a warning by default, all others are errors; a channel may downgrade an error to a warning (the harvester reports `oecp.content.english_missing` as a warning and stores the course as `draft`).

**Request and internal**

- `oecp.request.validation_failed`: Request validation failed
- `oecp.request.not_found`: Resource not found
- `oecp.request.not_implemented`: Not implemented
- `oecp.internal`: Internal error

**Authentication and authorization (`/api/admin`)**

- `oecp.auth.missing_token`: Bearer token required
- `oecp.auth.invalid_token`: Token is invalid or expired
- `oecp.auth.insufficient_acr`: Multi-factor authentication required
- `oecp.auth.no_role`: No OECP role assigned
- `oecp.auth.unknown_organization`: Organization does not exist
- `oecp.auth.idp_mismatch`: Identity provider does not match the organization
- `oecp.auth.forbidden_organization`: Organization outside your scope
- `oecp.auth.forbidden_role`: Your role does not permit this operation

**Invitations**

- `oecp.invitation.invalid`: Invitation is invalid or already used
- `oecp.invitation.expired`: Invitation has expired
- `oecp.invitation.mismatch`: Signed-in identity does not match the invitation

**Identity service, mail and secrets**

- `oecp.identity.unavailable`: Identity service request failed
- `oecp.identity.conflict`: Conflicting account in the identity service
- `oecp.mail.unavailable`: E-mail could not be sent
- `oecp.secrets.unavailable`: Secret storage is unavailable (master key missing or invalid)

**Partner integrations (Channel A settings)**

- `oecp.integration.not_configured`: No integration is configured for this organization
- `oecp.integration.access_mode_required`: access_mode is required when the authoritative channel is oeapi
- `oecp.integration.base_url_required`: base_url is required in direct access mode
- `oecp.integration.endpoint_id_required`: surfeduhub_endpoint_id is required in surfeduhub access mode
- `oecp.integration.header_name_required`: api_key_header_name is required for api_key_header authentication
- `oecp.integration.basic_secret_format`: A basic credential must be username:password
- `oecp.integration.secret_required`: A credential is required for this authentication scheme
- `oecp.integration.secret_not_expected`: auth_scheme none takes no credential
- `oecp.integration.insecure_url`: base_url must be an https URL on port 443
- `oecp.integration.surfeduhub_unavailable`: SURFeduhub access is not configured in this deployment (SURFEDUHUB_SECRET_REF)

**Sync runs**

- `oecp.sync.already_running`: A run for this organization is in progress
- `oecp.sync.rate_limited`: Sync now is limited to once per 15 minutes
- `oecp.sync.channel_disabled`: Channel is not authoritative for this organization

**Harvester (Channel A)**

- `oecp.oeapi.mass_absence` *(W)*: 30% or more of published courses missing; absences not counted
- `oecp.oeapi.unauthorized`: Partner endpoint rejected the credentials
- `oecp.oeapi.unreachable`: Partner endpoint unreachable
- `oecp.oeapi.http_error`: Unexpected HTTP status from partner endpoint
- `oecp.oeapi.host_not_approved`: Harvest host not approved
- `oecp.oeapi.address_refused`: Resolved address is not public
- `oecp.oeapi.body_too_large`: Response body exceeds 20 MB
- `oecp.oeapi.page_cap_reached` *(W)*: Listing stopped at 1,000 pages
- `oecp.oeapi.invalid_payload`: Payload does not match OEAPI v5
- `oecp.oeapi.missing_primary_code`: Course has no primaryCode
- `oecp.oeapi.study_load_unit`: studyLoad must be in ECTS and greater than 0
- `oecp.oeapi.invalid_isced` *(W)*: fieldsOfStudy is not a valid ISCED-F code
- `oecp.oeapi.language_dropped` *(W)*: Language code mul/und/zxx/mis dropped
- `oecp.oeapi.unmappable_delivery_mode`: No mappable modeOfDelivery
- `oecp.oeapi.parent_rejected`: Offering rejected because its course was rejected
- `oecp.oeapi.root_not_matched`: Root organization does not match the partner
- `oecp.oeapi.insecure_url`: Partner endpoint must use https on port 443
- `oecp.oeapi.redirect_refused`: Redirect to another host, another scheme or more than 3 hops refused
- `oecp.oeapi.timeout`: Partner endpoint did not answer in 30 s
- `oecp.oeapi.run_timeout`: Harvest exceeded 2 hours
- `oecp.oeapi.listing_failed`: A listing page failed; the harvest is incomplete
- `oecp.oeapi.empty_listing` *(W)*: The course listing returned no courses
- `oecp.oeapi.detail_unavailable` *(W)*: Offering detail unavailable; the listing item was used
- `oecp.oeapi.duplicate_entity` *(W)*: Natural key already harvested in this run; duplicate ignored
- `oecp.oeapi.insecure_link` *(W)*: Link is not an https URL and was dropped
- `oecp.oeapi.invalid_language` *(W)*: Language code is not valid and was ignored
- `oecp.oeapi.missing_teaching_language`: No usable teachingLanguage on the offering or its course
- `oecp.oeapi.text_without_title` *(W)*: Texts in a language without a name in that language were ignored
- `oecp.oeapi.value_truncated` *(W)*: Value truncated to the maximum length
- `oecp.oeapi.invalid_student_counts` *(W)*: Student numbers ignored (maxNumberStudents must be greater than 0)
- `oecp.oeapi.invalid_extension` *(W)*: An ext.oecp member has an invalid shape and was ignored
- `oecp.oeapi.write_failed`: The canonical record could not be written
- `oecp.oeapi.secret_unavailable`: The partner credential could not be read

**CSV upload (Channel B)**

- `oecp.csv.missing_column`: Required column is missing
- `oecp.csv.unknown_column`: Unknown column
- `oecp.csv.missing_value`: Required value is empty
- `oecp.csv.invalid_template_version`: Expected template_version 1.0 or 1.1 (1.1 for kind, levels, attr_* and application_instructions_* columns)
- `oecp.csv.conflicting_columns`: Use either level or levels, not both
- `oecp.csv.invalid_code`: Invalid course or offering code
- `oecp.csv.invalid_status`: Expected draft, published, withdrawn or cancelled
- `oecp.csv.invalid_date`: Expected YYYY-MM-DD
- `oecp.csv.invalid_number`: Invalid number
- `oecp.csv.invalid_url`: Expected an https:// URL
- `oecp.csv.invalid_email`: Invalid email address
- `oecp.csv.invalid_language`: Invalid BCP 47 language tag
- `oecp.csv.invalid_isced`: Invalid ISCED-F code
- `oecp.csv.invalid_delivery_mode`: Invalid delivery mode code
- `oecp.csv.invalid_level`: Invalid level
- `oecp.csv.invalid_kind`: Expected course, bip, lecture_series or other
- `oecp.csv.invalid_timezone`: Invalid IANA time zone
- `oecp.csv.cell_too_long`: Cell exceeds 20,000 characters
- `oecp.csv.duplicate_row`: Duplicate natural key in file
- `oecp.csv.file_too_large`: File exceeds 5 MB
- `oecp.csv.too_many_rows`: File exceeds 5,000 rows
- `oecp.csv.too_many_columns`: File exceeds 300 columns
- `oecp.csv.encoding`: File is not valid UTF-8
- `oecp.csv.malformed`: File is not valid RFC 4180 CSV
- `oecp.csv.rate_limited`: Upload limit reached (10 per hour)
- `oecp.csv.english_delete`: English texts cannot be deleted
- `oecp.csv.duplicate_column`: Column appears more than once in the header
- `oecp.csv.field_count`: Row has a different number of cells than the header
- `oecp.csv.empty_file`: File has no header row
- `oecp.csv.text_without_title`: Texts in a language need the title in that language
- `oecp.csv.language_deleted` *(W)*: Every text of this language is empty; the language will be deleted
- `oecp.csv.no_data_rows` *(W)*: File has a header but no rows
- `oecp.csv.no_files`: Upload a courses file, an offerings file or both
- `oecp.csv.unexpected_file`: Only the multipart fields courses and offerings (one file each) are accepted
- `oecp.csv.write_failed`: The upload could not be written; nothing was saved

**Canonical content (all channels)**

- `oecp.content.english_missing`: English title is required to publish
- `oecp.content.invalid_value`: Invalid value
- `oecp.content.date_order`: Dates are out of order
- `oecp.content.seats_exceed_capacity`: Seats exceed max_students
- `oecp.content.seats_without_timestamp`: seats_available requires seats_updated_at
- `oecp.content.duplicate_isced`: Duplicate ISCED code
- `oecp.content.unknown_isced_field`: Unknown ISCED broad field
- `oecp.content.unknown_delivery_mode`: Unknown delivery mode
- `oecp.content.unknown_teaching_unit`: Unknown teaching unit
- `oecp.content.unknown_session`: Unknown academic session
- `oecp.content.unknown_course`: Unknown course code
- `oecp.content.unknown_attribute`: Unknown attribute (not defined by the alliance)
- `oecp.content.invalid_attribute_value`: Attribute value does not match its definition
- `oecp.content.unknown_attribute_option`: Attribute value is not one of the defined options
- `oecp.content.invalid_code`: Codes start with a letter or digit and use letters, digits, . _ / - (≤ 200)
- `oecp.content.unsupported_language`: Language is not in the list of supported languages
- `oecp.content.duplicate_ext_id`: A record with this code already exists
- `oecp.content.ext_id_immutable`: The code of an existing record cannot be changed
- `oecp.content.override_not_allowed`: Overrides apply only to harvested records (organizations whose authoritative channel is oeapi)
- `oecp.content.has_published_offerings`: The course has published offerings; withdraw or cancel them first
- `oecp.content.published_not_deletable`: A published record cannot be deleted; withdraw or cancel it instead
- `oecp.content.harvested_not_deletable`: Harvested records cannot be deleted; withdraw them with a status override


## Appendix B. Environment variables

**api and worker** (`apps/api/src/config/env.ts`, validated with Zod at start; an invalid value stops the process). Required: `DATABASE_URL` (`postgres(ql):`), `VALKEY_URL` (`redis(s):`/`valkey(s):`), `KEYCLOAK_ISSUER` (exact `iss`), `KEYCLOAK_JWKS_URL`, `OECP_MASTER_KEY_FILE` (base64 of 32 bytes), `OECP_PUBLIC_BASE_URL` (portal origin for links, sitemap, service document), `KEYCLOAK_ADMIN_URL` (Admin API base), `KEYCLOAK_ADMIN_CLIENT_SECRET_FILE`. With defaults:

- `NODE_ENV` = `development` (`test`, `production`); `PORT` = `3000`; `LOG_LEVEL` = `info`.
- `KEYCLOAK_REALM` = `oecp`; `KEYCLOAK_ADMIN_CLIENT_ID` = `oecp-backend`.
- `SMTP_HOST` = empty (mails only logged); `SMTP_PORT` = `25` (465 = implicit TLS); `SMTP_FROM` = `no-reply@example.org` (also the `/oeapi/v5/` contact fallback).
- `SURFEDUHUB_GATEWAY_URL` = `https://gateway.surfeduhub.nl`; `SURFEDUHUB_SECRET_REF` = unset (disables `surfeduhub` mode).
- `OECP_UPLOADS_DIR` = `/data/uploads` (shared by api and worker).
- `OECP_ALLOW_INSECURE_PARTNER_HTTP` = `false`; **development only**.
- `DATABASE_PASSWORD_FILE` (not in `env.ts`): read by the image entrypoint and injected into `DATABASE_URL`.

**web** (Nuxt runtime config): `NUXT_PUBLIC_API_BASE` (origin of `/api` and `/oeapi`), `NUXT_API_INTERNAL_BASE` (SSR origin, `http://api:3000` in Compose), `NUXT_PUBLIC_OIDC_AUTHORITY`, `NUXT_PUBLIC_OIDC_CLIENT_ID` (`oecp-admin`), `NUXT_PUBLIC_I18N_BASE_URL`, `NUXT_PUBLIC_ALLIANCE_NAME`; redirect paths `/en/admin/callback`, `/en`, `/en/admin` are build-time defaults matching the realm.

**Compose `.env`** (`deploy/compose/.env.example`): `OECP_PORTAL_HOST` and `OECP_AUTH_HOST` (required), ports and log levels, `ACME_EMAIL`, `OECP_IMAGE_TAG`, `KEYCLOAK_ADMIN_USER`, `KEYCLOAK_ADMIN_ALLOWLIST` (CIDRs of the Keycloak console), `OECP_REALM_DISPLAY_NAME`, `OECP_SMTP_HOST`/`PORT`/`FROM`/`STARTTLS` (api and realm), `OECP_ALLIANCE_NAME`, `OECP_ALLOW_INSECURE_PARTNER_HTTP`, `OTEL_SDK_DISABLED`, `OEAPI_MOCK_*` (Appendix D), `EXAMPLE_PARTNER_IDP_*`, `COMPOSE_PROFILES`. Docker secrets (`deploy/compose/secrets/`): `postgres_superuser_password`, `oecp_db_password`, `keycloak_db_password`, `keycloak_admin_password`, `oecp_backend_client_secret`, `oecp_master_key`, `grafana_admin_password`.

**Development-only flags:** `OECP_ALLOW_INSECURE_PARTNER_HTTP=true`; profile `dev` (Mailpit, OEAPI mock); Traefik `--api.insecure` dashboard on 127.0.0.1 and the self-signed default certificate; `KC_BOOTSTRAP_ADMIN_*` temporary master admin. The Compose README's production checklist lists what to change.

## Appendix C. CLI

`node dist/cli.js <command>` inside the `api` container (`docker compose run --rm api node dist/cli.js …`). Logs go to stderr; stdout carries only the command's result.

| Command | Effect |
|---|---|
| `seed-organizations [--file <path>] [--dry-run]` | Upsert organizations by `slug` (default `db/seed/organizations.json`: alliance `aurora` and nine partners); never touches `id`, `parent_id` |
| `seed-attribute-definitions [--file <path>] [--dry-run]` | Upsert attribute definitions by key (default `attribute-definitions.json`); definitions missing from the file are kept |
| `bootstrap-alliance-admin --email <e> --org <slug> [--ttl-hours 1–168, default 24]` | First `alliance_admin` invitation; prints the link; refused while an `alliance_admin` exists or one is invited |
| `store-secret --purpose <label>` | Encrypts stdin into `secrets` and prints `db:<uuid>` (e.g. `SURFEDUHUB_SECRET_REF`; Basic as `username:password`) |

Exit codes: `0` success; `1` runtime failure (database, Keycloak, invalid seed file); `2` refused by a precondition; `64` invalid command line (`EX_USAGE`, also with no arguments). Database schema: `pnpm db:migrate` (`node-pg-migrate up --check-order`), `db:migrate:down`, `db:migrate:create`.

## Appendix D. Developer tooling

**OEAPI mock partner** (`tools/oeapi-mock`, Compose profile `dev`, `http://oeapi-mock:8090`, host `127.0.0.1:8090`): Node 22 server for OEAPI v5.0 (`eduxchange` profile) with a synthetic UIBK slice (25 courses, 20 tagged for eduXchange, 40 offerings, edge cases); `uibk-next-run.json` removes 2 courses and changes 1. Variables: `OEAPI_MOCK_AUTH` (`none`, `basic:u:p`, `bearer:t`, `apikey:header:value`; Compose `basic:oecp:oecp-mock-secret`), `OEAPI_MOCK_DATASET`, `OEAPI_MOCK_LATENCY_MS`, `OEAPI_MOCK_FAIL_RATE` (random 503), `OEAPI_MOCK_RATE_LIMIT_PER_SEC` (429), `OEAPI_MOCK_TODAY`. Validated against the bundled v5.0 OpenAPI (`scripts/validate.mjs`, `smoke.sh`). To harvest it: `direct`, `base_url http://oeapi-mock:8090`, `basic` secret `oecp:oecp-mock-secret`, approve the host, and run api and worker with `OECP_ALLOW_INSECURE_PARTNER_HTTP=true`. Verified 2026-10-14: create, change, withdraw by absence, republish.

**Identity E2E scripts** (`tools/e2e-identity`, Playwright Chromium, manual, not CI): `setup-account.js` completes the Keycloak execute-actions mail found in Mailpit (password and TOTP, stored in git-ignored `deploy/compose/secrets/dev_alliance_admin_*`), `accept-flow.js "<link>"` drives invitation → OIDC (PKCE, `acr=mfa`) → acceptance → sign-out, `relogin.js` signs in again and shows `/me`. Covers the local-account path only.

**Test database.** API integration tests (`apps/api/test/integration`) create one throwaway database per test file on the server named by `DATABASE_URL_TEST` (user needs `CREATE DATABASE`), migrate it with `db/migrations`, and drop it; without the variable they are skipped. Unit tests use fakes (Kysely, OEAPI, local JWKS).
