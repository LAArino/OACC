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
that uses them). Five of the ten courses have an image, see [Images](#images); the other five have none, so the portal shows their partner logo line.

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

## Images

Five courses come with an illustration, so you can see both the image and the
logo fallback. The pictures are abstract and contain no text, logos, people or
flags. Each is drawn by [`images/generate.py`](images/generate.py) from
geometry, gradients and seeded noise (Python with Pillow and NumPy): no
photograph, font, third-party artwork or AI image service is involved, so no
third party holds rights over them. The script is deterministic: running it
again rewrites the same files.

| University (slug) | Course code | Theme |
|---|---|---|
| `northvale` | `EXA-NOR-DATA-ETHICS` | node graph on a dot grid |
| `northvale` | `EXA-NOR-NORTHERN-ECOSYSTEMS` | forest ridges, lake and moon rings |
| `southmere` | `EXA-SOU-HERITAGE-IDENTITIES` | nested arches and mosaic tiles |
| `eastbrook` | `EXA-EAS-SMART-MANUFACTURING` | gears, robot arm and circuit traces |
| `westmark` | `EXA-WES-URBAN-MOBILITY` | transit lines and stations |

Course codes are unique per organization, so there is one folder per university,
`images/<slug>/`, each with its own `images.csv` (`course_code,file,alt_en,decorative,credit`)
and the JPEGs it lists. Load a folder with the CLI command `import-course-images`
([hosting operator guide](../../onboarding/hosting-operator.md#26-database-schema-and-seeds),
*Course images*) once the courses exist, i.e. after the CSV uploads, one run per
organization; do a `--dry-run` first. From `deploy/compose`, for Northvale:

```sh
docker compose run --rm -T -v "$PWD/../../docs/data/example-alliance-2026-27/images/northvale:/seed/images:ro" \
  api node dist/cli.js import-course-images --org northvale --dir /seed/images --dry-run
```

Drop `--dry-run` for the real run and repeat with `southmere`, `eastbrook` and
`westmark` (mount that university's folder).

The CSV route is exercised as well: `EXA-WES-URBAN-MOBILITY` also carries
`image_url`, `image_alt_en` and `image_credit` in `westmark/courses.csv`, a
`raw.githubusercontent.com` URL of its picture, which the worker fetches after
the upload ([CSV authoring guide](../../guides/csv-authoring.md#course-image-image_url)).
That fetch needs the repository to be public and the file to be on the `main`
branch; until then the upload still succeeds and only reports the warning
`oecp.media.fetch_failed`. Loading the folder afterwards replaces the fetched
image by the same one and is harmless.

To change a picture or add one for another course, edit the theme table and
`EXAMPLE` in `images/generate.py` and add a line to the matching `images.csv`.
