<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Going public: GitHub checklist

The repository `LAArino/OACC` is private. This checklist is what the owner applies **by hand, in the GitHub web UI**, to make it public, in this order. Nothing here is automated: changing the visibility, the features, the security settings and the ruleset is the owner's decision. Tick the boxes in a copy (an issue or a local note), not in this file.

## (a) Before changing the visibility

- [ ] **Secret scan of the whole history.** Scan of 2026-10-17 with gitleaks 8.21.2 (release binary, SHA-256 checked against the release's checksums file): `gitleaks git --redact` over **51 commits** (all refs, `main` at `73f9799`), **16 findings, no real secret**. Re-run it if commits are added before the switch.

  | Findings | File (commit) | Rule | Classification |
  |---|---|---|---|
  | 8 | `apps/api/test/unit/*.test.ts`, `apps/api/test/integration/course-images.int.test.ts`, `apps/web/test/helpers/adminCourses.ts`, `packages/schemas/test/media.test.ts` (`85df3ae`) | `generic-api-key` | False positive: `image_key`/`KEY` values such as `0123456789abcdef` are placeholder storage keys of course images in tests, not credentials |
  | 3 | `deploy/compose/test-saml-idp/users.json` (`c8b68b4`) | `generic-api-key` | Test fixture: passwords of the fictional users of the dev-only test SAML IdP (profile `dev`) |
  | 1 | `deploy/compose/test-saml-idp/cert/idp.urv.test.key` (`c8b68b4`) | `private-key` | Test fixture: signing key of the dev-only test IdP, `CN=idp.urv.test, O=OECP development test IdP (not a real URV key)`, committed on purpose ([identity/keycloak/README.md](../../identity/keycloak/README.md)); the realm's `urv` entry that trusts it stays disabled unless `OECP_DEV_IDP_ENABLED=true` (dev `.env` only) |
  | 3 | `deploy/compose/README.md`, `tools/oeapi-mock/scripts/smoke.sh` (`3b98b44`) | `curl-auth-user` | Test fixture: `oecp:oecp-mock-secret` is the documented credential of the development OEAPI mock; `oecp:wrong` is a deliberately wrong password in the smoke test |
  | 1 | `docs/onboarding/partner-with-oeapi.md` (`1029d78`) | `curl-auth-user` | False positive: the placeholder `oecp:<password>` |

  Once the repository is public, the test IdP key is known to everyone: production must never set `OECP_DEV_IDP_ENABLED=true` (the default is `false`). The real development credentials stay in `deploy/compose/secrets/`, which is git-ignored and has never been committed.
- [x] **Aurora Foundation consent: done.** The course data of the first alliance (13 courses transcribed from the public Aurora Virtual Campus website on 2026-10-15) was moved to the private deployment repository on 2026-10-22 and removed from this repository; a fictional example dataset ([docs/data/example-alliance-2026-27](../data/example-alliance-2026-27/README.md)) replaces it. The public portal screenshots also show the Aurora logo and header images from the deployment branding.
- [ ] **Screenshots show development accounts only.** The 44 files in [docs/images](../images/README.md) (`public-*` 4, `admin-*` 14, `ops-*` 2, `api-*` 1, `manual-*` 23) were checked on 2026-10-17. The accounts visible are the development alliance administrator `admin@aurora-universities.eu` (local account), the test SAML IdP user `partner.admin@urv.cat` and the test invitations `test.partner@example.org` and `test.cbs@example.org`; the sign-in forms are empty and no token, one-time code or stored credential is shown. The first two use real domains: confirm that neither mailbox belongs to a real person.
- [ ] **Branding files are not in the repository.** [.gitignore](../../.gitignore) has `deploy/compose/branding/*` with the exception `!deploy/compose/branding/README.md`; only that README is tracked, and no other file under `deploy/compose/branding/` appears anywhere in the history.

## (b) Settings → General → Features

- [ ] **Issues**: on (the templates in `.github/ISSUE_TEMPLATE` apply).
- [ ] **Discussions**: on, with the categories **Q&A** (question/answer format), **Ideas** and **Announcements** (only maintainers can post); delete the other default categories.
- [ ] **Wiki**: off (the documentation lives in `docs/`).
- [ ] **Projects**: off.
- [ ] **Sponsorships**: off.

## (c) Settings → Code security and analysis

- [ ] **Dependency graph**: on (needed by Dependabot).
- [ ] **Dependabot alerts**: on. **Dependabot security updates**: on (version updates are already configured in `.github/dependabot.yml`).
- [ ] **Secret scanning**: on, with **push protection**: on.
- [ ] **Private vulnerability reporting**: on ([SECURITY.md](../../SECURITY.md) names it as the preferred channel).
- [ ] **Code scanning → CodeQL → Default setup** for **JavaScript/TypeScript** (and GitHub Actions if offered). The Trivy filesystem scan stays in CI ([ci.yml](../../.github/workflows/ci.yml)): CodeQL analyses the code, Trivy the dependencies, secrets and misconfiguration.

## (d) Settings → Rules → Rulesets: protect `main`

Create a **branch ruleset** named `main`, enforcement **Active**, target **Default branch**:

- [ ] **Bypass list**: Repository admin (the owner), mode *Always*, so the owner can still push release commits and tags directly.
- [ ] **Restrict deletions** and **Block force pushes**: on.
- [ ] **Require linear history**: on.
- [ ] **Require status checks to pass**, with the check names exactly as the jobs report them:

  | Workflow | Job id | Check name |
  |---|---|---|
  | `CI` | `lint-and-test` | `Lint, type check, test` |
  | `CI` | `reuse` | `REUSE compliance` |
  | `CI` | `dco` | `DCO sign-off` (runs on pull requests only) |
  | `CI` | `compose-config` | `Validate Docker Compose file` (includes shellcheck) |
  | `CI` | `trivy-fs` | `Trivy filesystem scan` |
  | `E2E` | `identity` | `Identity E2E (Compose stack, test SAML IdP)` |

  Caution: `E2E` runs on pull requests only when they touch `apps/`, `packages/`, `identity/`, `deploy/compose/`, `tools/e2e-identity/` or its own workflow file. A required check that never starts blocks the pull request (for example a docs-only one) until the owner bypasses. Either accept that, or drop the `paths` filter of `e2e.yml`, or leave the E2E check out of the required list and keep RELEASING criterion 8.
- [ ] Optionally **Require signed commits**: only if every contributor signs; DCO sign-off is already enforced by the `DCO sign-off` job.

## (e) Settings → General: description, topics, homepage

- [ ] **Description**: `Open Alliance Course Catalogue: course catalogue for European University alliances (OEAPI v5, Keycloak with eduGAIN, EUPL-1.2)`
- [ ] **Topics**: `european-universities`, `course-catalogue`, `oeapi`, `keycloak`, `edugain`, `nestjs`, `nuxt`, `eupl-1-2`, `higher-education`
- [ ] **Homepage**: none until a public deployment exists.
- [ ] Optionally a **social preview image** without alliance branding.

## Changing the visibility

- [ ] Settings → General → Danger Zone → **Change repository visibility** → Public. Read GitHub's warnings and confirm with the repository name. Only after this step do (f).

## (f) After going public

- [ ] **GitHub releases** for the existing tags (RELEASING criterion 10): from a clean `main`, `bash tools/scripts/github-releases.sh --dry-run`, read the notes it prints, then `bash tools/scripts/github-releases.sh`. It creates `v0.1.0` … `v0.11.0` oldest first from the CHANGELOG sections and skips any release that already exists ([script](../../tools/scripts/github-releases.sh)).
- [ ] **Dependabot ran**: *Insights → Dependency graph → Dependabot* shows the ecosystems of `dependabot.yml`; *Security → Dependabot alerts* is populated or empty, not disabled.
- [ ] **CodeQL ran**: *Security → Code scanning* shows a completed CodeQL analysis of `main`; triage any alert.
- [ ] **Secret scanning**: *Security → Secret scanning* has no open alert (the fixtures above are not provider tokens; close any alert on them as *used in tests*).
- [ ] **Ruleset works**: a test pull request shows the required checks; a force push to `main` without bypass is refused.
- [ ] **Announcement**: post the v0.11.0 release in Discussions → Announcements, linking the release page and the README.
- [ ] **publiccode.yml**: `url` is `https://github.com/LAArino/OACC`, which stays valid; there is no `landingURL`. Add one only when a public deployment or project page exists, and re-validate the file.
- [ ] **Badges and links**: links to `github.com/LAArino/OACC` in the README, CHANGELOG and docs now resolve for everyone; spot-check a few while signed out.
