<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Example alliance 2026–27: fictional courses for demonstrations and tests

A complete, **fictional** dataset to try OACC with realistic data: the *Example
European Universities Alliance* with four invented universities and ten
invented courses, written in CSV template 1.3
([guide](../../guides/csv-authoring.md)), one `courses.csv` and one
`offerings.csv` per university, ready for the CSV console or
`POST /api/admin/v1/organizations/{orgId}/uploads`.

All names, courses, texts and domains are made up. Every address and URL is
under `.example`, a reserved top-level domain that never resolves (RFC 2606),
so no link or e-mail address works. **Any resemblance to real institutions,
places or persons is unintended.** Instructors are role descriptions, not
names. The files are examples and tests, not a maintained dataset.

| Directory | University (slug) | Country | Courses |
|---|---|---|---|
| `northvale/` | Northvale University (`northvale`) | Finland | 3: a course, a hybrid field course, a BIP |
| `southmere/` | Southmere University (`southmere`) | Portugal | 3: two courses, a lecture series |
| `eastbrook/` | Eastbrook University (`eastbrook`) | Poland | 2: a laboratory course, a COIL course |
| `westmark/` | Westmark University (`westmark`) | Netherlands | 2: a hybrid course, a jointly delivered course |

The ten courses use the kinds `course`, `bip` and `lecture_series`, all six
delivery modes, several teaching languages, ISCED-F broad fields 02 to 07
and 09 and the course attributes of the default file
`apps/api/db/seed/attribute-definitions.json` (`educational_hub`, `sdg`,
`competence_framework`, `micro_credential`, `free_course`, `enrolled_only`,
`open_to_alliance`, `target_audience`). Every course has an English title,
abstract, description, learning outcomes, prerequisites and assessment, a
contact, instructors and one published offering with application start and
deadline, so none of them triggers the handbook warning
`oecp.content.handbook_incomplete`. The offerings fall in the academic
sessions `EXA-2026-27-S1` and `EXA-2026-27-S2` (created by the first upload
that uses them). `image_url` is empty: add images you may publish yourself.

## How to use it

1. **Seed the organizations.** Copy the example seed and run the seed command
   (Guide A [step 4](../../onboarding/alliance.md#4-seed-the-organizations)),
   `--dry-run` first, from `deploy/compose`:

   ```sh
   cp ../../apps/api/db/seed/organizations.example.json organizations.alliance.json
   docker compose run --rm -T -v "$PWD/organizations.alliance.json:/seed/orgs.json:ro" \
     api node dist/cli.js seed-organizations --file /seed/orgs.json --dry-run
   docker compose run --rm -T -v "$PWD/organizations.alliance.json:/seed/orgs.json:ro" \
     api node dist/cli.js seed-organizations --file /seed/orgs.json
   ```

   `keycloak_idp_alias` is `null` for all four universities: they use local
   OACC accounts and need no identity provider. The default attribute
   definitions are the ones the CSV columns refer to; seed them as in Guide A
   [step 5](../../onboarding/alliance.md#5-define-the-course-attributes) if
   you have not.
2. **Create the first alliance administrator** for `example-alliance`
   (Guide A [step 6](../../onboarding/alliance.md#6-bootstrap-the-first-alliance-admin)).
3. **Upload each pair through the CSV console.** Signed in as alliance
   administrator, choose the university, open **CSV upload**
   (`/en/admin/csv`) and drop its `courses.csv` and `offerings.csv` together;
   the check report shows no errors and no warnings; choose **Upload**.
   Repeat for the four directories. The courses appear in the portal as soon
   as the uploads have succeeded. Alternatively invite a partner
   administrator for each university and let them upload their own pair.

Uploading a pair twice is harmless: the second run counts every row as
unchanged.
