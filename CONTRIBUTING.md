<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Contributing to OECP

Thank you for your interest in the Open European Campus Portal. This document
explains how to contribute code, documentation and design decisions. By
participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ground rules

- **Language.** English is used throughout: code, identifiers, comments,
  commit messages, issues, pull requests, documentation and ADRs.
- **Original Spanish documents.** The owner's original documents in Spanish
  (specification v3.0 and the decisions log up to row 26) live in
  [docs/archive/](docs/archive/README.md) and are never updated; the English
  documents are authoritative.
- **Licence: inbound = outbound.** Every contribution is accepted under the same
  licence the project is distributed under, the
  [European Union Public Licence v. 1.2](LICENSE) (EUPL-1.2). Trivial
  configuration files covered by the CC0-1.0 annotation in
  [REUSE.toml](REUSE.toml) are the only exception.
- **No CLA.** There is no Contributor Licence Agreement and no copyright
  assignment. You keep the copyright of your contribution.
- **Third-party code.** Do not copy code from other projects unless its
  licence is compatible with EUPL-1.2 and you record its copyright and licence
  with SPDX headers or a `REUSE.toml` annotation. `reuse lint` must pass.

## Development environment

**Prerequisites.** Node.js 22 (`.node-version`; `package.json` requires
`^22.22.3`), pnpm 12 through Corepack (`corepack enable`; the exact version is
`packageManager` in `package.json`), Docker Engine 25+ with Compose v2.24+, and
`openssl`. Then, from the repository root:

```sh
pnpm install
```

**Development stack.** Follow the "Quick start" of
[deploy/compose/README.md](deploy/compose/README.md#quick-start-local-development)
once: it creates `.env` with the `dev` block enabled, generates the secrets,
migrates the database and bootstraps the first alliance admin. Afterwards:

```sh
cd deploy/compose
docker compose --profile dev up -d --build --wait   # COMPOSE_PROFILES=dev in .env makes the flag optional
docker compose run --rm api pnpm db:migrate          # after pulling new migrations
```

The portal is `https://oecp.localhost/en`, the admin console
`https://oecp.localhost/en/admin`, Keycloak `https://auth.oecp.localhost`
(self-signed TLS: accept the certificate, `curl -k`). The `dev` profile adds
Mailpit (`http://127.0.0.1:8025`, every e-mail), the OEAPI v5 mock partner
`oeapi-mock` ([tools/oeapi-mock](tools/oeapi-mock/README.md)) and the test SAML
IdP `test-saml-idp`, used by the realm only with `OECP_DEV_IDP_ENABLED=true`
in `.env` ([Compose README](deploy/compose/README.md#test-saml-idp-test-saml-idp)).

**Checks before a pull request** (what the CI job "Lint, type check, test"
runs):

```sh
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
pnpm openapi:check      # fails if docs/api/*.json are out of date; fix with pnpm openapi:generate
```

The API integration suites (`apps/api/test/integration`) are skipped unless
`DATABASE_URL_TEST` names a PostgreSQL server where the user may create
databases (each suite creates and drops its own). CI points it at the
`postgres` database of a `postgres:16.15` service; locally:

```sh
docker run -d --rm --name oecp-test-pg -e POSTGRES_PASSWORD=oecp-test \
  -p 127.0.0.1:55432:5432 postgres:16.15
DATABASE_URL_TEST=postgres://postgres:oecp-test@127.0.0.1:55432/postgres \
  pnpm --filter @oecp/api test
docker stop oecp-test-pg
```

**Browser end-to-end checks.** [tools/e2e-identity](tools/e2e-identity/README.md)
drives Chromium (Playwright) through the administrator onboarding against the
running `dev` stack: `setup-account.js`, `accept-flow.js` and `relogin.js` for
local accounts, `brokered-accept.js` and `brokered-negative.js` for the
brokered path through the test SAML IdP. They are developer tools, not CI
tests; install them with `npm install && npx playwright install chromium
--only-shell` inside that directory.

**Compose and alerting checks** (CI job "Validate Docker Compose file"), from
the repository root:

```sh
for profiles in "" "--profile dev" "--profile backup" "--profile observability" \
  "--profile dev --profile backup --profile observability"; do
  eval docker compose --env-file deploy/compose/.env.example \
    -f deploy/compose/compose.yaml "$profiles" config --quiet
done
docker run --rm -v "$PWD/deploy/compose/observability:/obs:ro" \
  --entrypoint promtool prom/prometheus:v3.15.0 check rules /obs/alert-rules.yml
docker run --rm -v "$PWD/deploy/compose/observability:/obs:ro" \
  --entrypoint promtool prom/prometheus:v3.15.0 test rules /obs/alert-rules.test.yml
docker run --rm \
  -v "$PWD/deploy/compose/observability/alertmanager:/etc/alertmanager/oecp:ro" \
  --entrypoint sh prom/alertmanager:v0.34.1 -c \
  'sh /etc/alertmanager/oecp/entrypoint.sh --render-only /tmp/am.yml && amtool check-config /tmp/am.yml'
docker run --rm -v "$PWD:/repo:ro" -w /repo koalaman/shellcheck:v0.11.0 -S style \
  $(find deploy tools -type f \( -name '*.sh' -o -path 'deploy/compose/postgres/bin/*' \) -not -path '*/node_modules/*')
```

**Licensing.** `uvx reuse@5 lint` (or any `reuse` 5.x) must pass; CI runs it
in the job "REUSE compliance".

**Credentials.** Development secrets live in `deploy/compose/secrets/` and the
configuration in `deploy/compose/.env`; both are git-ignored, as are the test
administrators' password and TOTP files the E2E scripts write there. Never
commit them, paste them into issues, pull requests or logs, or reuse them
outside the development stack.

## Developer Certificate of Origin (DCO)

Instead of a CLA, OECP uses the [Developer Certificate of Origin 1.1](DCO).
Every commit must carry a `Signed-off-by` trailer whose name and email match
the commit author. The sign-off certifies that you wrote the change, or
otherwise have the right to submit it under EUPL-1.2, as stated in the DCO.

Sign off by committing with `-s`:

```sh
git commit -s -m "feat(ingestion): map OEAPI v5 studyLoad to ECTS"
```

This appends a line such as:

```
Signed-off-by: Jane Doe <jane.doe@example.org>
```

To fix the last commit, run `git commit --amend -s --no-edit`; for a whole
branch, `git rebase --signoff main`. Pull requests with unsigned commits
cannot be merged. Use your real name; anonymous or pseudonymous sign-offs are
not accepted.

## Commits and pull requests

Commit messages follow [Conventional Commits 1.0](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<optional scope>): <summary in the imperative, lower case>

<optional body: what and why>

Signed-off-by: Name <email>
```

- **Types:** `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`,
  `chore`, `revert`.
- **Scopes** (suggested): `api`, `worker`, `web`, `schemas`, `ingestion`,
  `catalogue`, `oeapi`, `identity`, `deploy`, `docs`, `adr`.
- Breaking changes add `!` after the type or scope and a `BREAKING CHANGE:`
  footer.

Pull requests should:

1. Address one concern and reference the related issue.
2. Pass CI (lint, type check, tests, `reuse lint`).
3. Add or update tests; ingestion transformers require unit tests.
4. Update documentation and add an entry under `Unreleased` in
   [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
5. Start every new source file with SPDX headers, for example
   <!-- REUSE-IgnoreStart -->
   `// SPDX-License-Identifier: EUPL-1.2` in TypeScript or
   `<!-- SPDX-License-Identifier: EUPL-1.2 -->` in Markdown.
   <!-- REUSE-IgnoreEnd -->

## Architecture decision records (ADRs)

Significant decisions are recorded as ADRs in [docs/adr/](docs/adr/) using the
[MADR](https://adr.github.io/madr/) template. A decision is significant when
it is hard to reverse or affects several modules, deployments or partners:
architecture, dependencies, data model, public API contracts, security,
identity, licensing or governance.

1. Copy the template from [docs/adr/README.md](docs/adr/README.md) into
   `docs/adr/NNNN-short-title.md`, using the next free number.
2. Set the status to `Proposed`, fill in context, options, decision and
   consequences, and cite the sources you rely on.
3. Open a pull request containing only the ADR (or the ADR plus a small proof
   of concept). Discussion happens on the pull request.
4. The ADR is accepted under the lazy-consensus rule in
   [GOVERNANCE.md](GOVERNANCE.md), its status changes to `Accepted` and it is
   merged.
5. Accepted ADRs are immutable. To change a decision, write a new ADR that
   supersedes the old one and update the old one's status to
   `Superseded by ADR-NNNN`.

## Changing the canonical model or the schemas

The canonical model ([docs/spec-v4.1.md](docs/spec-v4.1.md) §5) and the
schemas in `packages/schemas` (canonical JSON Schema, CSV template, OEAPI
mappings, error codes) are contracts shared by every partner and every
deployment. Changes follow a stricter path:

1. **Open an issue first** describing the need, the partners or channels
   affected, and an example payload or CSV row.
2. **Write an ADR** if the change is breaking or alters semantics: removing or
   renaming a field, tightening a constraint, changing a vocabulary such as
   delivery modes, lifecycle states or natural keys, or changing the meaning
   of an error code. Purely additive, optional fields can skip the ADR but
   still need the issue.
3. **Update everything in one pull request:**
   - a new forward-only SQL migration (never edit a migration that has been
     released);
   - the canonical JSON Schema and any generated types;
   - the CSV template and its JSON Schema, bumping `template_version` for any
     change visible to CSV users;
   - the OEAPI v5 mapping and the `/oeapi/v5` read API, including values that
     can only be carried in `ext.oecp`;
   - `packages/schemas/errors.json` (codes are stable: add new codes, never
     reuse or repurpose old ones);
   - the specification section concerned and the changelog.
4. **Keep partners working.** Where feasible, a CSV template version should
   remain accepted for at least one release after its successor is
   published; the change and the migration path for partners are described
   in the changelog.

## Releases

OECP uses Semantic Versioning with `0.x` rules until 1.0 and one version for
the whole monorepo. Versioning, the contract and migration policies, the
release procedure and the release checklist are in
[docs/RELEASING.md](docs/RELEASING.md). Contributors only add `Unreleased`
entries to the changelog; maintainers cut releases.

## Reporting bugs and requesting features

Open an issue with steps to reproduce, expected and actual behaviour, and the
version or commit. Do not report security vulnerabilities in public issues:
follow [SECURITY.md](SECURITY.md).
