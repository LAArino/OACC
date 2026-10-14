# Open European Campus Portal (OECP) — Specification v4.0

Status: implementation baseline · Date: 2026-10-14 · Supersedes `docs/spec-v3.0-original.md` · Licence: EUPL-1.2

**Sources.** [R00]–[R03] = `docs/review/00…03-*.md`; [RP] = `docs/research/partner-oeapi-endpoints.md`; [DL n] = row *n* of `docs/decisions-log.md`, which prevails over the reviews. RFC 2119 keywords apply.

## 1. Purpose and scope

OECP is an EUPL-1.2 web application that publishes the course offer of a European University alliance as one public catalogue and one read API. Partners feed courses through three channels: scheduled harvesting of OEAPI (formerly OOAPI), CSV upload, or a web form. An anti-corruption layer normalises all channels into one canonical model before publication.

**Alliance-agnostic.** Alliance name, partners, domains, logos, colours and UI languages are configuration (`organizations` table, Keycloak realm, Nuxt runtime config, theme tokens). One deployment serves one alliance.

**First deployment: Aurora** [DL 2, DL 4, DL 13]:

| Channel at launch | Partners |
|---|---|
| A — OEAPI v5, direct access to each partner's endpoint (the same data eduXchange consumes) [RP; DL 14] | UIBK, UICE, VUA, UDE |
| B/C — CSV or web form | URV, UNINA, UP, CBS, UPEC, Aurora Foundation |

**Out of scope for the MVP:** wallet login (OID4VP, EUDI Wallet) → v2; push ingestion of data (not planned) and the "harvest now" notification endpoint → v1; OEAPI v4 → v2 only if a partner requires it; EWP Courses API → v2; analytics dashboard → v2; ELM/LOQ export → v2. OECP never handles applications or enrolment and stores no student data.

## 2. Actors and roles

| Actor | Auth | Permissions |
|---|---|---|
| Anonymous visitor | none, no cookies | Public catalogue, read API (§9) |
| `partner_admin` | Keycloak + MFA | CRUD and status changes on courses, offerings, sessions, integration settings, uploads, sync runs of the organization in claim `org_id` and its sub-units |
| `alliance_admin` | Keycloak + MFA | All of the above for every organization, plus organizations, admin invitations/revocations, network status |

Roles are assigned in OECP, never derived from federated attributes: no credential proves "admin of University X" [R01 §2]. The v3.0 per-university roles are replaced by two roles plus an organization claim [DL 9].

### 2.1 Onboarding

1. `alliance_admin` creates the partner organization (§8.2), including `schac_home_organization` and Keycloak IdP alias.
2. `alliance_admin` invites by email, role and organization. The API stores the SHA-256 of a random 256-bit token (valid 7 days) and emails a link carrying it in the URL fragment (`/admin/accept#token=…`), so it never reaches server logs.
3. The SPA starts OIDC login with `kc_idp_hint={alias}`. Keycloak's first-broker-login creates a role-less user (linking by email disabled [R01 §2]) and forces MFA enrolment.
4. The SPA posts the token to `POST /api/admin/v1/invitations/accept`, the only endpoint accepting a role-less token. The API requires a valid unused token, `email` claim = invited address, `idp` claim = organization alias and asserted `schacHomeOrganization` = organization value; it then sets the realm role and attribute `oecp_org_id` via the Keycloak Admin API and audits.

Organizations without an eduGAIN IdP (e.g. Aurora Foundation; `keycloak_idp_alias IS NULL`) get Keycloak local users, created at invitation via Keycloak's execute-actions email (password ≥ 12 characters, TOTP); acceptance uses `idp = "local"`; no self-registration.

**Bootstrap.** `oecp bootstrap-alliance-admin --email <e> --org <alliance-slug>`, run in the `api` container after `oecp seed-organizations`, works only while no `alliance_admin` exists and prints a 24-hour invitation link to stdout.

### 2.2 MFA, sessions, logout, revocation

- **MFA:** every admin login passes a Keycloak second factor regardless of the IdP; WebAuthn (preferred) and TOTP are both offered. Success yields ACR `mfa`.
- **Lifetimes:** access token 5 min; rotating single-use refresh tokens; SSO idle 30 min; SSO max 8 h; no offline tokens; no remember-me.
- **Logout:** RP-initiated; Keycloak sends SAML SLO when the IdP declares `SingleLogoutService`, else the page asks the user to close the browser.
- **Revocation:** remove role and attribute, then `POST /admin/realms/oecp/users/{id}/logout`; effective within 5 min.
- **Dormancy:** roles removed after 180 days without login; annual recertification by `alliance_admin`s.

## 3. Architecture

A **modular monolith** [R03 §0]: one NestJS codebase, one image, two processes — `api` (HTTP) and `worker` (BullMQ processors and schedules). Modules: `catalogue`, `oeapi-read`, `admin`, `ingestion` (harvester, CSV, form; shared `CanonicalWriter`), `organizations`, `identity`, `audit`, `storage`, `mail`.

```
 Internet ──> Traefik v3 (TLS/ACME, routing, rate limits, headers)
   portal-host:  /            -> Nuxt (SSR catalogue; client-side /admin)
                 /api/public  -> api (anonymous)
                 /oeapi/v5    -> api (anonymous)
                 /api/admin   -> api (Bearer JWT)
   auth-host:    /realms/oecp -> Keycloak <── SAML ──> partner IdPs (eduGAIN)
 api, worker ──> PostgreSQL 16 | Valkey (BullMQ) | uploads volume
 worker ──HTTPS (allowlisted hosts)──> partner OEAPI endpoints (optionally SURFeduhub gateway)
```

| Component | Licence | Role |
|---|---|---|
| Traefik Proxy v3 | MIT | Edge proxy; Kong rejected (no OSS images since 3.10) [R03 §1] |
| Nuxt 4 / Vue 3 | MIT | Public SSR catalogue, client-rendered admin |
| NestJS 12 | MIT | `api`, `worker` |
| PostgreSQL 16 | PostgreSQL | Canonical data, FTS; Keycloak uses a separate database in the same cluster |
| Keycloak 26.x | Apache-2.0 | Admin authentication only |
| Valkey 8 + BullMQ 5 | BSD-3 / MIT | Job queue and scheduler |
| Local volume `/data/uploads` | — | CSV uploads (S3-compatible in v1) |
| Host institution SMTP relay | — | Invitations, alerts |

**BullMQ on Valkey** (over pg-boss): TypeScript-native (`@nestjs/bullmq`), repeatable jobs with time zones, backoff retries, rate limiting and `jobId = harvest-{organization_id}` deduplication (BullMQ forbids `:` in job ids), so a partner is never harvested twice in parallel. Valkey is BSD-licensed, unlike current Redis [R03 §2]; its state is rebuildable because the worker re-registers schedules at start.

**The public portal never touches Keycloak:** no OIDC code, no redirects, no cookies; Keycloak runs on a separate host. Its admin console is IP-allowlisted at Traefik.

**Machine-to-machine:** none external in the MVP (pull-only [DL 3]). Internally, `api` uses confidential client `oecp-backend` (`manage-users`, `view-users`) for invitations and revocation.

## 4. Identity (MVP)

**Realm.** One realm `oecp` per deployment, configured as code in `identity/keycloak/` (keycloak-config-cli); themes are EUPL-1.2 [R03 §2]. Keycloak is the only identity component: no simpleSAMLphp, no wallet [DL 1; R01 §3 option A].

**One SAML IdP per partner,** alias = partner `slug`, from its eduGAIN `EntityDescriptor`. Keycloak cannot consume aggregates [R01 §1], so the daily job `idp-metadata-refresh` verifies the eduGAIN aggregate (pinned certificate, `validUntil`) and updates configured IdPs' certificates and endpoints via the Admin API, keeping the last good configuration on failure. For hub-and-spoke federations (SURFconext for VUA, WAYF for CBS) the IdP is the hub, the SP is also connected in that federation, and the `schacHomeOrganization` check binds admins to their partner.

**Stable identifier.** Keycloak "Principal type = Attribute [Name]", in order: `urn:oasis:names:tc:SAML:attribute:subject-id`; `…:pairwise-id`; ePPN (`urn:oid:1.3.6.1.4.1.5923.1.1.1.6`) only if neither is released and the partner confirms in writing that ePPN is never reassigned [R01 §2]. Never email or transient NameID. The backend identifies users only by Keycloak `sub`.

**Required attributes:** subject-id/pairwise-id; `mail` (`urn:oid:0.9.2342.19200300.100.1.3`); `schacHomeOrganization` (`urn:oid:1.3.6.1.4.1.25178.1.2.9`); `displayName` or `givenName`+`sn`. `eduPersonScopedAffiliation` is optional and never used for authorization. A missing required attribute stops login with an error naming it.

**SP registration.** EntityID `https://{auth-host}/realms/oecp`, registered with eduGAIN export in the hosting institution's federation (SIR/RedIRIS for the URV-hosted MVP) with REFEDS Personalized Access, REFEDS CoCo v2 and Sirtfi; no R&S [R01 §2]. Keycloak has one ACS per alias [R01 §3], so `identity/keycloak/scripts/sp-metadata` generates one metadata document listing every ACS with an index, resubmitted when a partner is added. Assertions MUST be signed and encrypted.

**Roles and JWT contract.** Realm roles `partner_admin`, `alliance_admin`; user attribute `oecp_org_id` (admin-editable only). Public client `oecp-admin` (Authorization Code + PKCE, oidc-client-ts, tokens in memory) with minimum ACR `mfa` (realm ACR-to-LoA map `{"mfa": 2}`). The backend consumes exactly:

| Claim | Content | Check |
|---|---|---|
| `iss` | `https://{auth-host}/realms/oecp` | exact |
| `aud` | contains `oecp-api` | required |
| `azp` | `oecp-admin` | exact |
| `sub` | Keycloak user UUID | audit actor |
| `exp`, `iat`, `auth_time`, `sid` | standard | 30 s leeway |
| `acr` | `mfa` | required |
| `roles` | flat array of OECP realm roles | non-empty except at `/invitations/accept` |
| `org_id` | `organizations.id` | exists, not deleted |
| `idp` | broker alias or `local` (session note `identity_provider`) | equals organization alias (`local` if NULL) |
| `email`, `name` | IdP attributes | display, invitation match |

Signatures: cached realm JWKS, RS256/ES256. `partner_admin` writes only rows of `org_id` and its descendants; `alliance_admin` writes all (NestJS guard plus scoped repositories).

**Phase-2 hook (v2).** Wallet login (OID4VP) is added as one more Keycloak IdP without changing the JWT contract. Rule for the phase-2 ADR: Keycloak's native verifier (experimental in 26.8 [R01 §1]) if by then non-experimental with SD-JWT VC and DCQL; otherwise simpleSAMLphp with `simplesamlphp-module-oid4vp` as SAML IdP proxy. Roles stay local; wallet identities are linked only explicitly from an active session, never by email. Module prerequisites before production [R00 §5]: (a) issuer key bound to `iss`; (b) holder binding (VP signer = `credentialSubject.id`); (c) no trust-list-less mode outside development; (d) allowlisted `did:web`/Universal Resolver lookups; (e) mandatory VP `exp`, explicit multi-VC handling; plus SD-JWT VC, X.509 client identification, RP registration under Implementing Regulation (EU) 2025/848, and an external audit of this single-maintainer module [R01 §1].

## 5. Canonical data model

**Conventions.** UUID keys; `date` values are local to the offering `timezone` (deadline = 23:59:59 local). No hard deletes: `status` is publication state, `deleted_at` marks records created in error (purged after 12 months). `RESTRICT` between entities, `CASCADE` only for owned children. Short labels are `jsonb` `{bcp47: text}` maps containing `"en"`; long texts live in `course_texts`, one row per language.

**Lifecycle** [DL 6]: `draft` → `published` → `withdrawn` (partner or absence, §6.2.5) or `cancelled`, changeable from any channel. Natural keys: `(organization_id, ext_id)` = partner + course code; `(course_id, ext_offering_id)`.

**Languages** [DL 5]: texts keyed by primary language subtag; English mandatory to publish (deferred constraint trigger); display uses the UI language, else English, marked `lang="en"`. No automatic machine translation; partner-supplied MT is flagged `is_machine_translated`.

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
  base_url                 text CHECK (base_url ~ '^https?://[^/?#@]+(/[^?#]*)?$'), -- migration 0003: http allowed in the DB; https enforced by the API unless OECP_ALLOW_INSECURE_PARTNER_HTTP=true (dev only)
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

**Overrides** [DL 12]. Manual edits over harvested data are stored in `overrides` as `{"<field>": {"value": <json>, "by": "<sub>", "at": "<ISO 8601>"}}`; any field except keys is overridable. Columns hold the effective value (source merged with overrides); `content_hash` is computed before overrides, so overrides survive every harvest. Removing one restores the last harvested value. All changes are audited.

**History.** A monthly job creates the next two partitions of `ext_metadata_history` and drops those older than 12 months. A payload is stored only when its hash differs from the latest for the same `(organization_id, entity_type, ext_id)`.

**Search** [R02 §2]. One `tsvector` per `course_texts` row in its language's configuration, `pg_trgm` for typo-tolerant suggestions, `unaccent` throughout. Queries OR one branch per language (`lang='en' AND search_vector @@ websearch_to_tsquery('oecp_en', $q)`) so the GIN index applies; rank = `ts_rank_cd` + 0.3 × title trigram similarity. **Stemmer gap:** [R02] reports Catalan lacks a built-in stemmer; PostgreSQL 14+ ships Snowball `catalan`, which the DDL uses, and the image build MUST check `SELECT 'catalan'::regconfig`. Icelandic (UICE) and Czech (UP) have no stemmer and fall back to `oecp_simple` (unaccent, no stemming). A dedicated engine is introduced only if the §10 search target is missed.

## 6. Ingestion (anti-corruption layer)

### 6.1 Common pipeline

Adapter → source validation → canonical DTO (`packages/schemas`) → canonical JSON Schema validation → SHA-256 of the RFC 8785 serialisation → `CanonicalWriter.upsert()` (natural key, override merge, status rules, audit) → `ext_metadata_history`, `sync_errors`. A hash equal to `content_hash` counts as `unchanged` and writes nothing, making every channel idempotent.

### 6.2 Channel A — scheduled OEAPI harvester

**6.2.1 Scheduling.** Pull only [DL 3]: daily (`'0 3 * * *'`) plus "Sync now" (at most once per 15 min per organization); one run per partner at a time, maximum 2 h.

**6.2.2 Access modes.** No partner publishes a public OEAPI URL; eduXchange reaches them through the SURFeduhub gateway [RP]. OECP accesses each partner **directly** to avoid dependencies on SURF [DL 14]; `surfeduhub` mode is kept only as a fallback for a partner that cannot grant direct access.

| `access_mode` | Target | Authentication |
|---|---|---|
| `direct` (default) | `base_url` of the partner's own OEAPI endpoint | `auth_scheme` `none`/`basic`/`bearer`/`api_key_header` with per-partner `secret_ref` |
| `surfeduhub` (fallback) | `https://gateway.surfeduhub.nl`, header `X-Route: endpoint={surfeduhub_endpoint_id}`, one endpoint per request | One alliance-level HTTP Basic client credential, referenced by deployment setting `SURFEDUHUB_SECRET_REF` |

Secrets are referenced only (`db:<uuid>` in the MVP, `openbao:<path>` in v1, §10 Security) and entered write-only. Aurora's four OEAPI partners start in `direct` mode: each grants OECP a base URL, a credential and, where applicable, a network allowlist entry under a bilateral access agreement [DL 14]. Schedules are enabled per partner once its "Test connection" succeeds.

**6.2.3 Version and requests.** Target **OEAPI v5.0** with `Accept: application/json`. The v1 adapter for v6 sends `Accept: application/vnd.oeapi+json;version=6` and handles its renames (`organisation`, `teachingLanguages[]`, `startDateTime`, `consumer`); v6 is unsettled (a `v6.0` tag exists while `main` publishes 6.0-rc.3) [RP, R02 §1], so it is enabled per partner only when that partner serves it. Every call carries `consumer={consumer_profile}` (default `eduxchange`); OECP does **not** filter on `alliances.name=aurora`, which is not yet a valid profile value [RP]. Order:

1. `GET /organizations?organizationType=root`
2. `GET /courses?consumer=eduxchange`
3. `GET /courses/{courseId}/offerings?since={today − 365 days}`
4. `GET /offerings/{offeringId}?expand=academicSession`

Pagination: `pageNumber` = 1, 2, … until `hasNextPage = false`, never `totalPages` [RP]; cap 1,000 pages. `since` is explicit because the v5 default returns only future offerings [R02 §1]; offerings starting before the window never count as absent.

**6.2.4 Mapping (v5 → canonical).**

| OEAPI v5 | Canonical | Rule |
|---|---|---|
| root organization | partner | matched, never created; sub-units come from CSV/form |
| `primaryCode.code` (course / offering) | `ext_id` / `ext_offering_id` | course required [DL 6]; offering falls back to `offeringId` |
| `courseId`, `offeringId` | `source_ref` | |
| `name`, `abstract`, `description`, `admissionRequirements`, `assessment`, `learningOutcomes` | `course_texts` `title`, `abstract`, `description`, `prerequisites`, `assessment`, `learning_outcomes` | per language tag; outcomes joined by blank lines |
| `studyLoad` | `ects` | unit must be `ects`, value > 0, else reject |
| `fieldsOfStudy` | primary ISCED code | invalid → warning |
| `level` | `level`, `eqf_level` | bachelor/master/doctoral 1:1, `associate degree` → `short_cycle`, else `other`; EQF 5–8 derived |
| `link` | `info_url` (course), `application_url` (offering) | `https` only |
| `startDate`, `endDate`, `enrollStartDate`, `enrollEndDate` | `start_date`, `end_date`, `enrol_start_date`, `application_deadline` | |
| expanded `academicSession` | `academic_sessions` | `ext_id = academicSessionId` |
| `teachingLanguage`, `modeOfDelivery` | `teaching_languages`, delivery modes | offering value, else course value |
| `maxNumberStudents`, `enrolledNumberStudents`, `pendingNumberStudents` | `max_students`; `seats_available` = max(0, max − enrolled − pending), `seats_updated_at` = fetch time | seats only if max and enrolled present [DL 8] |
| — | `timezone`, `status` | organization default; `published` if valid, `draft` + warning `oecp.content.english_missing` without English title |
| v6 `offeringState` | `status` | concept→draft, active→published, inactive→withdrawn, cancelled→cancelled |

`coordinators` are not expanded; no person data is harvested; contact defaults to `organizations.contact_email`.

**Languages.** ISO 639-2 bibliographic/terminology pairs normalise to one form, the ISO 639-1 code (`ger`/`deu` → `de`, `ice`/`isl` → `is`, `dut`/`nld` → `nl`, `cze`/`ces` → `cs`, `fre`/`fra` → `fr`) [RP]; codes without one stay 3-letter; `mul`, `und`, `zxx`, `mis` are dropped with a warning. Text tags (`en-GB`) reduce to the primary subtag; the first variant wins.

**Delivery mode** [DL 7]. v5 `online`, `distance-learning` → `online`; `on campus`, `situated` → `presential`; `hybrid` → `hybrid`. v6 values map 1:1; `x-*` only if added to `delivery_modes`. No mappable mode → offering rejected. Nothing distinguishes synchronous from asynchronous [R02 §1].

**6.2.5 Withdrawal by absence.** A run is complete when every listing page returned HTTP 200 and at least one course came back. Absence is counted only in complete `succeeded`/`partial` runs where under 30% of published courses are missing (otherwise warning `oecp.oeapi.mass_absence`, admins notified). Seen entities, even rejected ones, reset `absent_count` and are republished if previously withdrawn by absence. Absent entities increment it; at `withdraw_after_absences` (default 3) they become `withdrawn` (actor `system:harvester`). A failed, empty or incomplete harvest **never** withdraws [DL 3; R02 §3]; a `status` override always wins.

**6.2.6 Failures and outbound security.** Per-entity processing: rejections go to `sync_errors` with a `json_pointer` and processing continues; offerings of a rejected course are rejected. Run status: `succeeded` (complete, no rejections), `partial` (rejections or incomplete listing), `failed` (auth error, unreachable, nothing processed). HTTP: 30 s timeout; 5 retries on 429/5xx with exponential backoff honouring `Retry-After`; `max_requests_per_second`; bodies ≤ 20 MB. SSRF: the gateway host is allowlisted in deployment config; `direct` hosts need `alliance_admin` approval (`approved_host`, cleared when the host changes); `https`:443 only; DNS pinned per connection; loopback, private, link-local, CGNAT, ULA and multicast addresses refused; redirects only within the same host.

### 6.3 Channel B — CSV upload

**Format, template 1.0.** Files `courses.csv` and/or `offerings.csv` (courses processed first); UTF-8 (BOM stripped); RFC 4180; comma separator, semicolon auto-detected when the header has no comma (Excel in EU locales); exact header names in any order, unknown columns rejected; dates `YYYY-MM-DD`; decimal point `.`; multi-values separated by `|`; language columns suffixed `_<lang>`. A row is the full record (empty cell clears the field); languages absent from the header are untouched; a language with all cells empty is deleted (never `en`). Uploads upsert: omission does **not** withdraw; set `status`.

- **`courses.csv`** — required: `template_version` (`1.0`), `course_code` (`^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$`), `status`, `ects`, `isced_codes` (first is primary), `title_en`. Optional: `level`, `eqf_level`, `teaching_hours`, `teaching_unit_code`, `info_url`, `contact_email`, and per language `abstract_`, `description_`, `learning_outcomes_`, `prerequisites_`, `assessment_`, `keywords_` (plus `title_` for non-English).
- **`offerings.csv`** — required: `template_version`, `course_code` (in DB or same upload), `offering_code`, `status`, `start_date`, `end_date`, `teaching_languages` (BCP 47), `delivery_modes` (codes). Optional: `academic_session_code`, `enrol_start_date`, `application_deadline`, `timezone` (IANA, default organization's), `campus`, `max_students`, `alliance_seats`, `seats_available` (sets `seats_updated_at` to upload time), `application_url`.

Value constraints are those of the DDL.

**Validation.** One JSON Schema (2020-12), `packages/schemas/csv/oecp-csv-1.0.schema.json` (`$defs/courseRow`, `$defs/offeringRow`, field formats `$ref`'d from `canonical/oecp-canonical-1.schema.json`), runs in the browser (Papa Parse + Ajv in a Web Worker) and on the server (Ajv). Reference checks (ISCED, modes, sub-units, sessions, course codes) use `/api/admin/v1/reference` in the browser. **The server always revalidates**; any error writes nothing (run `failed`); warnings pass. Limits: 5 MB and 5,000 rows per file, 300 columns, 20,000 characters per cell, 10 uploads per hour per organization; files kept 90 days. **CSV injection:** values are stored verbatim and never evaluated; every CSV OECP generates prefixes cells starting with `=`, `+`, `-`, `@`, TAB or CR with `'`.

### 6.4 Channel C — web form

The wizard (§8.1) posts canonical JSON to `/api/admin/v1/courses[/{id}/offerings]`, validated with the same canonical schema in browser and server. Each save records a single-entity `sync_runs` row (`trigger_kind = 'form'`).

### 6.5 Rules between channels [DL 12]

One `authoritative_channel` per organization. `oeapi`: CSV disabled; the form only creates overrides on harvested records. `csv`/`form`: both write the same records (`source_channel` = last writer); harvester off. Switching keeps every `ext_id` [R02 §3]; the first harvest after switching to `oeapi` matches by `(organization_id, ext_id)`, unmatched records follow §6.2.5, overrides persist.

### 6.6 Error contract

RFC 9457 `application/problem+json` for all admin and ingestion errors; the header is row 1; codes are stable (`packages/schemas/errors.json`).

```json
{ "type": "/problems/validation-failed", "title": "Upload validation failed", "status": 422,
  "instance": "/api/admin/v1/sync-runs/2f6c0c1e-6a3d-4c55-9a43-0f3d3c2b9a10",
  "errors": [ { "code": "oecp.csv.invalid_date", "severity": "error", "file": "offerings",
                "row": 14, "column": "start_date", "message": "Expected YYYY-MM-DD" } ] }
```

## 7. Public portal

**Routes** (Nuxt SSR, state in the URL): `/{locale}/`, `/{locale}/courses/{courseId}`, `/{locale}/partners/{slug}`, `/{locale}/accessibility`, `/{locale}/privacy`. API: `GET /api/public/v1/courses?q&partner&mode&ectsMin&ectsMax&lang&isced&sort&page&includeUnscheduled` (results and facet counts), `GET /api/public/v1/suggest?q` (≥ 2 characters, 8 titles), `GET /api/public/v1/reference`.

**Search.** Published, non-deleted courses with a published offering ending today or later (toggle to include unscheduled courses). Multi-select filters, OR within and AND across: partner, delivery mode, ECTS range, teaching language, ISCED broad field. Sort by relevance (default with `q`), title or next start date; 20 per page.

**Course page.** Title, partner and logo, teaching unit, ECTS, level/EQF, ISCED labels, abstract, description, learning outcomes, prerequisites, assessment, teaching hours, keywords, contact, information link, last update. Per offering: dates, enrolment start, application deadline with time zone, delivery modes, languages, campus, seats, Apply. Cancelled offerings stay visible, labelled, until `start_date`.

**Seats** [DL 8]: if `alliance_seats` is set, "N seats reserved for {alliance} students"; if `seats_available` is set, also "N seats available (as of {date})". Remaining alliance seats are never computed.

**Apply** opens `application_url` in a new tab (indicated); else `info_url` as "More information"; else nothing.

**UI language.** English only in the MVP [DL 5], designed for per-partner languages from day one: `@nuxtjs/i18n` with locale prefix (`/en/…`), all strings in catalogues, enabled locales = English ∪ partners' `ui_languages`, content in the page locale with English fallback marked `lang="en"`, `hreflang`, `/` redirects by `Accept-Language`, no language cookie.

**JSON-LD** `schema.org/Course`: `name`, `description`, `courseCode`, `url`, `inLanguage`, `provider` (`CollegeOrUniversity`), `numberOfCredits` (`unitText: "ECTS"`), `educationalLevel`, `about`, `teaches`, `coursePrerequisites`, `hasCourseInstance[]` (`courseMode` from `delivery_modes.schema_org`, dates, `location`).

**Sitemap.** `/sitemap.xml` lists every published course per locale with `lastmod`, regenerated on publish; `robots.txt` disallows `/admin` and `/api/admin`.

**No cookies, no auth.** Public responses MUST NOT carry `Set-Cookie` (E2E-tested); self-hosted assets; no analytics in the MVP.

## 8. Admin dashboard

Client-rendered under `/{locale}/admin` (`ssr: false`), Reka UI components.

**`partner_admin`:**

1. **Integration settings:** authoritative channel, access mode (direct by default), base URL and auth scheme or, as fallback, SURFeduhub endpoint id, write-only credentials, version, consumer profile, run time, N; "Test connection" (`GET /`, `GET /courses?pageSize=1`); "Sync now".
2. **CSV console:** template and schema download, drag-and-drop with in-browser validation, row/column error table, injection-safe error report, server result.
3. **Course wizard:** identity → texts (English required) → offerings → review and publish. Harvested fields show the source value; edits become overrides with a badge and "Revert to source".
4. **Sync monitor:** runs with status, counters and duration; errors; pending withdrawals (0 < `absent_count` < N); raw payloads.

**`alliance_admin`:** all partner modules for any organization, plus:

1. **Organizations:** partners and sub-units (slug, names, SCHAC, Erasmus code, PIC, IdP alias, time zone, UI languages, contact); approval of direct harvest hosts; reference labels.
2. **Administrators:** invite, revoke, list with last login, annual recertification.
3. **Network status:** per partner channel, last success, last run, published counts. OEAPI light: green = `succeeded` within 26 h; amber = `partial` or 26–72 h; red = `failed` or > 72 h.
4. **Version lifecycle console: deferred to v1**, when v5 and v6 inputs coexist. Analytics: v2.

## 9. Public read API (OEAPI v5-compatible)

Anonymous and read-only so that others, eduXchange included, can harvest the alliance catalogue [R03 §3]: `GET /oeapi/v5/`, `/organizations`, `/organizations/{organizationId}`, `/organizations/{organizationId}/courses`, `/academic-sessions`, `/academic-sessions/{academicSessionId}`, `/courses`, `/courses/{courseId}`, `/courses/{courseId}/offerings` (v5 `since` semantics), `/offerings/{offeringId}`.

IDs are OECP UUIDs; `primaryCode.code` is the partner `ext_id`; only published courses and published or cancelled offerings. v5 paging (`pageSize` ≤ 250). Reverse modes: `presential` → `on campus`; `online`, `coil` → `online`; others → `hybrid`. `teachingLanguage` is the first language as ISO 639-2/T. Values v5 cannot express go in `ext.oecp`. `ETag` plus `Cache-Control: public, max-age=300`. `/oeapi/v6` follows in v1.

## 10. Non-functional requirements

- **Hosting.** One deployment per alliance [R03 §3]. Aurora MVP in URV's EU data centre: Aurora Foundation is **controller**, URV **processor**, under an art. 28 GDPR contract signed before go-live [DL 2]. Targets: availability 99.5% (portal) and 99% (admin) per month; RPO 5 min; RTO 4 h; search p95 < 300 ms at 50 req/s over 20,000 courses.
- **Deliverables.** Docker Compose (`deploy/compose`, MVP: traefik, web, api, worker, postgres, valkey, keycloak, optional observability) and Helm chart (`deploy/helm`, v1) [DL 10].
- **Backups.** pgBackRest for both databases: continuous WAL archiving (PITR) to a second URV site, weekly full and daily differential, 35-day retention, quarterly restore drill. Uploads backed up daily.
- **Observability.** OpenTelemetry SDK in api, worker and Nuxt → Collector → Prometheus and Loki, Grafana dashboards (AGPL, unmodified [R03 §2]). Alerts: 2 consecutive failed harvests, backup older than 26 h, disk > 80%, metadata-refresh failure, 5xx > 1%.
- **Security.** OWASP ASVS 4.0 L2; TLS 1.2+, HSTS, nonce-based CSP. Per-IP rate limits at Traefik: search 20 req/s, suggest and `/oeapi/v5` 10 req/s, admin 30 req/s. Secrets: MVP table `secrets`, AES-256-GCM in the application, master key as Docker secret, rotation via `key_version`; v1 adds an OpenBao provider behind the same `secret_ref` interface [R03 §2]. Admin API is bearer-only. SBOM, Renovate, Semgrep, Trivy, cosign-signed images.
- **Accessibility.** EN 301 549 → WCAG 2.1 AA (Directive (EU) 2016/2102), target 2.2 AA [R03 §3]; accessibility statement; manual audit before launch.
- **GDPR.** Personal data: admin identities, invitations, audit log, course contact emails (functional mailboxes recommended), raw payloads, access logs; no student data. Controller keeps the RoPA (art. 30); DPIA before go-live [R01 §2]. Retention: raw payloads and sync errors 12 months; sync runs 24 months; audit log 3 years; Keycloak events and application logs 90 days; access logs 30 days; uploads 90 days; admin accounts 12 months after role removal.
- **eduXchange data reuse.** The access agreement MUST record partner and SURF consent to reuse data tagged for eduXchange and to republish it through `/oeapi/v5` [RP]. The Aurora catalogue on eduXchange is not yet live, so initial harvests may be sparse; §6.2.5 prevents spurious withdrawals.
- **Testing.** Unit tests for every transformer (≥ 90% lines in `ingestion`); contract tests of harvester fixtures and `/oeapi/v5` against the OEAPI v5 OpenAPI; CSV schema corpora; cross-organization authorization tests; Playwright E2E (search, course page, no `Set-Cookie`, CSV upload, wizard, invitation via a test SAML IdP); @axe-core/playwright with zero serious violations; k6 load tests.

## 11. Project and governance

```
apps/api  apps/web  packages/schemas  identity/keycloak  deploy/compose  deploy/helm  docs/adr
```

- **Licence:** EUPL-1.2, released by its author Lluís Alfons Ariño [DL 2]; its network clause obliges operators of modified versions to publish their source [R03 §2]. The owner has confirmed that the Erasmus+ grant terms permit this [DL 2].
- **Contributions:** DCO, inbound = outbound EUPL-1.2, no CLA [DL 11]; Contributor Covenant 2.1; `SECURITY.md`; `GOVERNANCE.md`; `publiccode.yml`; REUSE with `reuse lint` in CI. English throughout [DL 11]. `simplesamlphp-module-oid4vp` stays in its own repository.
- **ADRs (MADR):** 0001 Modular monolith on NestJS · 0002 Vue 3 + Nuxt with SSR catalogue · 0003 Traefik as edge proxy · 0004 Keycloak-only identity, one SAML IdP per partner · 0005 Pull-only OEAPI harvesting into a canonical model.

## 12. Delivery phases

The harvester moves from the review's v1 [R00 §3] into the MVP because four partners already expose OEAPI [DL 3, DL 4].

| Phase | Scope | Deferred because |
|---|---|---|
| **MVP** | Public portal, `/oeapi/v5`, Channels A (v5), B, C, sync monitor, organizations and admins, network status, Keycloak SAML + MFA, Compose, PITR, metrics, WCAG 2.1 AA, English UI | — |
| **v1** | OEAPI v6 in and out, version console, Helm, OpenBao, S3 uploads, partner UI languages, "harvest now" notification, search engine only if needed | v6 unsettled; translators needed |
| **v2** | Wallet login (OID4VP) as extra IdP, EWP Courses API, OEAPI v4 on demand, analytics, ELM/LOQ export | Little value for staff with institutional IdPs; module fixes first [R00 §3] |

## 13. Glossary

| Term | Meaning |
|---|---|
| OEAPI | Open Education API (SURF); v5.0 stable, v6 unsettled |
| SURFeduhub | SURF gateway relaying consumer requests to institutional OEAPI endpoints [RP] |
| ECTS | European credit system; 1 credit ≈ 25–30 hours |
| ISCED-F | UNESCO fields of education (2/3/4-digit levels) |
| ESI | European Student Identifier; students only (unused) |
| eduGAIN | Interfederation of national academic identity federations |
| REFEDS | Body publishing federation entity categories |
| CoCo | REFEDS Data Protection Code of Conduct v2 |
| Sirtfi | Security incident response framework for federations |
| SD-JWT VC | IETF selective-disclosure credential format used by EUDI wallets |
| OID4VP | OpenID for Verifiable Presentations |
| EWP | Erasmus Without Paper network, incl. a Courses API |
| ELM / LOQ | European Learning Model and its Learning Opportunities and Qualifications profile |
