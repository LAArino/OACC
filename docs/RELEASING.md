<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Releasing OACC

This document defines how OACC versions are numbered, what "closing a
version" means, the exact steps to tag a release, what a release publishes,
and which contracts a release must keep. Releases are managed by the
maintainers ([GOVERNANCE.md](../GOVERNANCE.md)).

## Versioning

OACC follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
The monorepo has **one version**: the root `package.json`, every workspace
package, the container images, `publiccode.yml` and the git tag `vX.Y.Z` all
carry the same number.

Until 1.0.0 the `0.x` rules apply:

| Change | Bump | Example |
|---|---|---|
| New features, new migrations, new contract members | minor | 0.1.0 → 0.2.0 |
| Bug fixes and documentation only, no new migration | patch | 0.2.0 → 0.2.1 |
| Breaking change (contract, configuration, deployment) | minor, with a `BREAKING` note in the CHANGELOG | 0.2.1 → 0.3.0 |

Breaking changes are allowed before 1.0, but every one is listed in the
CHANGELOG entry of the release under **Changed** or **Removed**, prefixed with
`BREAKING:`, together with what operators and partners must do. Commits that
introduce them use the Conventional Commits `!` marker (see
[CONTRIBUTING.md](../CONTRIBUTING.md)).

Version **1.0.0** is tagged when a first alliance runs OACC in production with
partner data and the contracts below are declared stable. From then on,
breaking changes need a major version.

## Contracts and how each is versioned

| Contract | Where | Rule |
|---|---|---|
| Database schema | `apps/api/db/migrations/NNNN_*.sql` | Append-only; see [Migrations](#migrations). |
| CSV template | `template_version` column; `packages/schemas/src/csv.ts` (`CSV_TEMPLATE_VERSION`, `CSV_TEMPLATE_VERSIONS`); `packages/schemas/json/csv/oecp-csv-<version>.schema.json` | Any change visible to CSV authors bumps the template version (1.0 → 1.1 for additive columns). A published template version stays accepted for at least one release after its successor, and its JSON Schema file is never edited. Current: 1.3; accepted: 1.0, 1.1, 1.2, 1.3. |
| OEAPI read API | `/oeapi/v5` | Follows the OEAPI **v5.0** standard; OACC-only values go in `ext.oecp` and are additive. A v6 surface will be a new path, `/oeapi/v6` (spec §9, §12). |
| Public catalogue API | `/api/public/v1` | **Additive only**: new endpoints, optional parameters and response members may be added; nothing is removed, renamed or given a new meaning. A breaking change means `/api/public/v2`, served alongside v1 for at least one minor release. |
| Admin API | `/api/admin/v1` | Consumed by the admin dashboard of the same release. Changes are recorded in the CHANGELOG; external clients are not supported before 1.0. |
| Error codes | `packages/schemas/errors.json` | Codes are **never renamed, reused or repurposed**. New codes may be added; messages may be reworded. |
| Canonical JSON Schema | `packages/schemas/json/canonical/oecp-canonical-1.schema.json` (`urn:oecp:schema:canonical:1`) | Breaking changes need an ADR and a new schema version (CONTRIBUTING, "Changing the canonical model"). |
| Configuration | Environment variables, Docker secrets, `deploy/compose` | Renamed or removed variables and secrets are `BREAKING` and listed with their replacement. |

## Migrations

Migrations are SQL files run by node-pg-migrate (`pnpm db:migrate`, with
`--check-order`) in `apps/api/db/migrations` ([ADR-0006](adr/0006-tooling-pnpm-node-pg-migrate-kysely.md)).

- **Append-only.** Once a migration is part of a tag it is never edited,
  renamed or deleted. Fixes are new migrations with the next number.
- **Down sections.** Every migration has a `-- Down Migration` section that
  restores the previous schema. It is a development aid; in production a
  rollback restores the backup taken before the upgrade.
- **Release notes.** The CHANGELOG entry lists every new migration with:
  what it changes; whether it is **reversible** (down restores the schema
  without data loss), **reversible with data loss** (down drops data the new
  version stored) or **irreversible**; and any long lock or table rewrite.
  It also says when the first harvest or upload after the upgrade will report
  unchanged records as `updated` (the content hash covers new fields).
- **Upgrade order.** Back up the database (pgBackRest, or `pg_dump` in
  development); stop the `worker` so no harvest or CSV job writes during the
  upgrade; run `db:migrate` **with the new image**; then start the new `api`,
  `worker` and `web`:

  ```sh
  cd deploy/compose
  docker compose stop worker
  OECP_IMAGE_TAG=X.Y.Z docker compose build api web keycloak   # until images are published
  OECP_IMAGE_TAG=X.Y.Z docker compose run --rm api pnpm db:migrate
  OECP_IMAGE_TAG=X.Y.Z docker compose up -d --wait
  ```

Version 0.1.0 is a first installation: migrations 0001–0005 run on an empty
database. All five have down sections; the down of 0005 drops `kind`,
`levels`, `attributes`, `application_instructions` and `attribute_definitions`
with their data, and the down of 0004 restores the 0001 search vector.

## Closing a version

A version is closed, and may be tagged, only when all of the following hold:

1. **CI is green** on the release commit: lint, format check, type check,
   OpenAPI documents up to date, tests, `reuse lint`, DCO, `docker compose
   config` for every profile, promtool and amtool checks of the alerting
   configuration, shellcheck of every shell script, and Trivy (`.github/workflows/ci.yml`).
2. **Database suites ran with a database.** The integration suites in
   `apps/api/test/integration` are skipped unless `DATABASE_URL_TEST` is set;
   CI sets it to a PostgreSQL 16 service, so a green CI run covers them. If
   the release commit was not built by CI, run them locally (command below)
   and record the result in the release pull request or commit message.
3. **`docker compose config` is valid** for the reference deployment,
   including the `observability` profile.
4. **The Compose first-run path works** on an empty Docker host: every step of
   the Quick start in [deploy/compose/README.md](../deploy/compose/README.md)
   and its smoke test, from a fresh clone of the release commit.
5. **The CHANGELOG is moved** from `Unreleased` to `## [X.Y.Z] - YYYY-MM-DD`,
   with migration and upgrade notes, and a new empty `Unreleased` section.
6. **Specification and ADRs are in sync** with the code: the current
   `docs/spec-v*.md` describes what is built, every decision taken while
   building has an ADR, and the [ADR index](adr/README.md) is complete.
7. **Versions are bumped** in every `package.json` and in `publiccode.yml`
   (`softwareVersion`, `releaseDate`).
8. **The E2E workflow is green on the release commit**: the `E2E` workflow
   (`.github/workflows/e2e.yml`, identity suite against the Compose stack)
   passed on exactly that commit; start it with *Run workflow* if that commit
   has no run (a push of several commits runs only the last one).
9. **An annotated, signed-off tag** `vX.Y.Z` points at the release commit.
10. **A GitHub release** carries the CHANGELOG section of the version, once the
    repository has a public remote. The releases of v0.1.0 to v0.11.0 are
    created after the switch by `tools/scripts/github-releases.sh`, step (f)
    of the [go-public checklist](production/go-public-checklist.md).

## Release procedure

The commands run from the repository root on a clean `main`. Set the version
once:

```sh
export VERSION=0.1.0
export DATE=$(date +%F)
git switch main && git pull --ff-only && git status --short   # must print nothing
```

### 1. Verify

```sh
corepack enable && pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
uvx reuse@5 lint

# Database suites against a throwaway PostgreSQL 16
docker run -d --rm --name oecp-release-pg -e POSTGRES_PASSWORD=release \
  -p 127.0.0.1:55432:5432 postgres:16.15
DATABASE_URL_TEST=postgres://postgres:release@127.0.0.1:55432/postgres \
  pnpm --filter @oecp/api test
docker stop oecp-release-pg

# Compose file
docker compose --env-file deploy/compose/.env.example \
  -f deploy/compose/compose.yaml --profile observability config --quiet
```

Then follow the Quick start and smoke test of `deploy/compose/README.md` in a
fresh clone on a Docker host without OACC volumes.

### 2. Bump versions

`npm pkg set` reformats some files, so the version line is replaced in place:

```sh
node -e '
const fs = require("node:fs");
for (const f of process.argv.slice(1)) {
  const s = fs.readFileSync(f, "utf8");
  if (!/^  "version": "[^"]*"/m.test(s)) throw new Error(`${f}: no top-level "version" field`);
  fs.writeFileSync(f, s.replace(/^(  "version": )"[^"]*"/m, `$1"${process.env.VERSION}"`));
}' package.json apps/*/package.json packages/*/package.json tools/e2e-identity/package.json
sed -i.bak -e "s/^softwareVersion: .*/softwareVersion: \"$VERSION\"/" \
  -e "s/^releaseDate: .*/releaseDate: \"$DATE\"/" publiccode.yml && rm publiccode.yml.bak
pnpm -r --include-workspace-root exec node -e "console.log(require('./package.json').version)"
pnpm install --frozen-lockfile   # the lockfile does not record workspace versions
```

### 3. Update the CHANGELOG and the documents

- Rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, add an empty
  `## [Unreleased]` above it, add the upgrade notes (migrations, `BREAKING`
  items, new environment variables) and update the link references at the
  bottom (`[Unreleased]: …/compare/vX.Y.Z...HEAD`, `[X.Y.Z]: …/releases/tag/vX.Y.Z`).
- Update the supported-versions table in [SECURITY.md](../SECURITY.md).
- Check that the specification, the ADR index and [docs/README.md](README.md)
  are current.

### 4. Commit, tag and push

```sh
git add -A
git commit -s -m "chore(release): v$VERSION"

cat > /tmp/oecp-tag-message.txt <<MSG
OACC v$VERSION

Release $VERSION ($DATE). Changes: CHANGELOG.md, section [$VERSION].

Signed-off-by: $(git config user.name) <$(git config user.email)>
MSG
git tag -s "v$VERSION" -F /tmp/oecp-tag-message.txt   # GPG/SSH signature (user.signingkey)
# without a signing key: git tag -a "v$VERSION" -F /tmp/oecp-tag-message.txt
git tag -v "v$VERSION" || git show --no-patch "v$VERSION"

git push --follow-tags origin main
```

`--follow-tags` pushes the annotated tag together with the commit it points
to. Tags are never moved or deleted once pushed; a faulty release is fixed
by the next patch version.

### 5. Publish the GitHub release

```sh
awk -v v="$VERSION" 'index($0, "## [" v "]") == 1 {p = 1; next}
  p && (/^## \[/ || /^\[[^]]+\]: /) {exit} p' CHANGELOG.md > /tmp/oecp-release-notes.md
gh release create "v$VERSION" --verify-tag --title "OACC v$VERSION" \
  --notes-file /tmp/oecp-release-notes.md
```

## What a release publishes

| Artefact | Status |
|---|---|
| Annotated git tag `vX.Y.Z` with DCO sign-off | Implemented (this procedure) |
| GitHub release with the CHANGELOG section and source archives | Manual (`gh release create`) |
| Container images `oecp/api` (runs `api` and `worker`), `oecp/web`, `oecp/keycloak`, tagged `X.Y.Z` and `latest` | **Planned in CI.** Today operators build them from the tag with `OECP_IMAGE_TAG=X.Y.Z docker compose build`. `oecp/oeapi-mock` is for development only and is never published. |
| cosign signatures of the images (keyless, GitHub OIDC) | **Planned in CI** (spec §10) |
| SBOM (SPDX or CycloneDX) per image, attached to the release and as an image attestation | **Planned in CI** (spec §10) |
| `publiccode.yml` with `softwareVersion` and `releaseDate` | Implemented (step 2) |

## Support policy

Until 1.0, only the **latest minor version** is supported: fixes, security
fixes included, are released as patch versions of that minor, and operators
are expected to upgrade to each new minor. Older minors get no fixes. The
support window after 1.0 will be set by an ADR. Vulnerability handling
follows [SECURITY.md](../SECURITY.md).

## Release checklist

Copy this list into the release pull request or issue.

```markdown
- [ ] `main` is clean and up to date; `VERSION` and `DATE` set
- [ ] CI green on the release commit (lint, format, typecheck, OpenAPI check, test, REUSE, DCO, compose config, promtool/amtool, shellcheck, Trivy)
- [ ] `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test` pass locally
- [ ] API integration suites pass with `DATABASE_URL_TEST` (result recorded)
- [ ] `uvx reuse@5 lint` passes
- [ ] `docker compose … --profile observability config --quiet` passes
- [ ] Compose Quick start and smoke test pass from a fresh clone on an empty Docker host
- [ ] Every new migration listed in the CHANGELOG with reversibility and lock/rewrite notes
- [ ] No released migration edited (`git diff vPREVIOUS -- apps/api/db/migrations` shows only new files)
- [ ] No error code in `errors.json` renamed or removed; `/api/public/v1` changes are additive
- [ ] CSV template version bumped if CSV authors see a change; previous version still accepted
- [ ] After bumping the package versions, run `pnpm openapi:generate` and commit `docs/api/*.openapi.json` (`info.version` follows the root package.json; CI runs `pnpm openapi:check` and fails on drift)
- [ ] `BREAKING:` items and new environment variables or secrets documented
- [ ] CHANGELOG: `Unreleased` moved to `[X.Y.Z] - YYYY-MM-DD`, new empty `Unreleased`, links updated
- [ ] Specification, ADR index and `docs/README.md` in sync with the code
- [ ] SECURITY.md supported versions updated
- [ ] Versions bumped: every `package.json`, `publiccode.yml` (`softwareVersion`, `releaseDate`)
- [ ] Release commit signed off (`git commit -s`)
- [ ] Annotated, signed-off tag `vX.Y.Z` created and verified
- [ ] `git push --follow-tags origin main`
- [ ] GitHub release created from the CHANGELOG section
- [ ] Images built (and, once CI does it, published, signed and with SBOM)
```
