-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
-- SPDX-License-Identifier: EUPL-1.2
--
-- First-run initialisation of the PostgreSQL 16 cluster (spec §3: Keycloak uses
-- a separate database in the same cluster). Executed by the official image's
-- entrypoint with psql, as the superuser, only when the data directory is empty.
-- Re-running it requires deleting the `postgres_data` volume.
--
-- Passwords are read from Docker secrets with psql backtick expansion, so they
-- never appear in this file, the environment or the process list.

\set ON_ERROR_STOP on

\set oecp_password `cat /run/secrets/oecp_db_password`
\set keycloak_password `cat /run/secrets/keycloak_db_password`

-- Application database: owner `oecp`, used by api, worker and migrations.
CREATE ROLE oecp LOGIN PASSWORD :'oecp_password';
CREATE DATABASE oecp OWNER oecp ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE oecp FROM PUBLIC;

-- Keycloak database: owner `keycloak`, used only by Keycloak.
CREATE ROLE keycloak LOGIN PASSWORD :'keycloak_password';
CREATE DATABASE keycloak OWNER keycloak ENCODING 'UTF8' TEMPLATE template0;
REVOKE ALL ON DATABASE keycloak FROM PUBLIC;

\unset oecp_password
\unset keycloak_password

-- The search DDL of spec §5 uses the Snowball `catalan` configuration and the
-- `unaccent` and `pg_trgm` extensions. Fail initialisation early if the image
-- lacks them (spec §5: "the image build MUST check SELECT 'catalan'::regconfig").
\connect oecp
SELECT 'catalan'::regconfig;
-- Both extensions are "trusted" since PostgreSQL 13, so the migrations can also
-- create them as the database owner; creating them here makes that a no-op.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- PostgreSQL 15+ no longer grants CREATE on schema public to every role.
ALTER SCHEMA public OWNER TO oecp;
