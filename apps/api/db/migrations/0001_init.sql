-- SPDX-License-Identifier: EUPL-1.2
-- 0001_init: canonical schema, extracted verbatim from docs/spec-v4.0.md section 5.
-- Do not edit the Up section by hand; change the spec and re-extract.

-- Up Migration
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

-- Down Migration
DROP TABLE IF EXISTS
  audit_log, admin_invitations, ext_metadata_history, sync_errors, sync_runs,
  partner_integrations, secrets, course_offering_delivery_modes, course_offerings,
  course_isced_codes, course_texts, courses, academic_sessions, isced_broad_fields,
  delivery_modes, organizations;
DROP FUNCTION IF EXISTS
  oecp_course_tsv(text, text, text[], text, text), oecp_unaccent(text), oecp_ts_config(text),
  check_course_publishable(), set_updated_at();
DROP TEXT SEARCH CONFIGURATION IF EXISTS oecp_en;
DROP TEXT SEARCH CONFIGURATION IF EXISTS oecp_de;
DROP TEXT SEARCH CONFIGURATION IF EXISTS oecp_nl;
DROP TEXT SEARCH CONFIGURATION IF EXISTS oecp_it;
DROP TEXT SEARCH CONFIGURATION IF EXISTS oecp_fr;
DROP TEXT SEARCH CONFIGURATION IF EXISTS oecp_da;
DROP TEXT SEARCH CONFIGURATION IF EXISTS oecp_es;
DROP TEXT SEARCH CONFIGURATION IF EXISTS oecp_ca;
DROP TEXT SEARCH CONFIGURATION IF EXISTS oecp_simple;
DROP TYPE IF EXISTS sync_run_status, source_channel, lifecycle_status;
DROP DOMAIN IF EXISTS language_tag;
