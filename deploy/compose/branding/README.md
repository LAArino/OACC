<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Branding

This directory holds the deploying alliance's own images: the header images of
the public home page and course list, the logo of the site header, the
partner universities' logos and, optionally, the favicon. It also holds the
texts of the two legal pages (privacy notice, accessibility statement), see
[Legal pages](#legal-pages). The alliance holds the
rights to these pictures (the partners to their logos); they are deployment configuration, not part of OECP.
Nothing in this directory except this README is part of the repository (the
root `.gitignore` excludes it), so the images never end up in a commit or in a
container image.

The `web` service mounts the directory read-only at `/data/branding`
(`NUXT_BRANDING_DIR`) and serves its files at `https://{portal-host}/branding/<file>`.
To keep the images elsewhere on the server, set `OECP_BRANDING_DIR` in `.env`
to that directory (default: `./branding`, this directory).

## File names

Only files whose names follow this rule are served; any other request under
`/branding/` answers 404:

- lower-case letters, digits, `.`, `_` and `-`; starting with a letter or a
  digit (no hidden files); at most 100 characters; no `..`;
- one of the extensions `png`, `jpg`, `jpeg`, `webp`, `avif`, `svg`, `ico`;
- or one of the legal-page texts below (`privacy.<lang>.md`,
  `accessibility.<lang>.md`), the only non-image files served.

For example `hero.jpg` or `aurora-logo.svg`, not `Hero.JPG`. Sub-directories
are not served. Files are sent with `cache-control: public, max-age=86400`:
browsers may keep showing an old image for up to a day after a change, so give
a changed image a new file name and update the variable.

`/branding/index.json` lists the files that follow the rule, for example
`{"files": ["hero.jpg", "partner-uice.svg"]}`. The portal reads it to find the
optional files that have no variable (the partner logos). The directory is read
again at most once a minute (`cache-control: public, max-age=60`), so a new file
appears within about a minute; it answers 404 when no branding directory is
configured.

## Recommended sizes

| Image                                          | Format                                                                                                                          | Aspect ratio     | Example size                                       | Weight       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------- | ------------ |
| Home page header (`OECP_HERO_IMAGE`)           | JPEG or WebP (PNG for flat art)                                                                                                 | 3:1              | 1800 × 600                                         | under 400 KB |
| Course list header (`OECP_HERO_IMAGE_COURSES`) | JPEG or WebP (PNG for flat art)                                                                                                 | 12:5 (2.4:1)     | 1800 × 750                                         | under 400 KB |
| Site header logo (`OECP_LOGO_IMAGE`)           | SVG, or PNG with a transparent background                                                                                       | about 4:1        | 40 pixels high                                     | under 100 KB |
| Partner logos (`partner-<slug>.svg`)           | SVG, or PNG with a transparent background, trimmed to the mark (no empty margins: a 2:1 canvas with a small mark renders small) | about 4:1 to 1:1 | 32 pixels high on the cards, 48 on the course page | under 50 KB  |
| Favicon (`OECP_FAVICON_IMAGE`)                 | SVG (or PNG, ICO)                                                                                                               | square           | 32 × 32 or larger                                  | under 10 KB  |

## Header image (home page and course list)

- Home page: at least 1800 × 600 pixels, aspect ratio 3:1 (it is cropped to 3:1
  on wide screens and to 2:1 on phones, keeping the centre), under 400 KB.
- Course list (optional own image): at least 1800 × 750 pixels, aspect ratio
  12:5 (2.4:1; cropped to 12:5 on wide screens and to 2:1 on phones). Without
  an own image, the course list shows the home image at 3:1.
- PNG, JPEG or WebP (JPEG or WebP for photographs).
- Enable it in `.env`:

  ```sh
  OECP_HERO_IMAGE=/branding/hero.jpg
  OECP_HERO_IMAGE_ALT=
  OECP_HERO_IMAGE_COURSES=        # optional: a different image for the course list
  OECP_HERO_IMAGE_COURSES_ALT=    # its text alternative (empty = decorative)
  ```

  Leave `OECP_HERO_IMAGE_ALT` empty when the image is decorative (the default:
  it is rendered with `alt=""`); describe the picture there only when it
  carries information the page does not already give. `OECP_HERO_IMAGE` may also
  be an absolute `https://` URL. The image is also used as the link preview
  image (`og:image`).

## Logo (site header)

- SVG, or PNG with a transparent background; about 4:1 (shown 40 pixels high,
  at most 14rem wide); under 100 KB.
- Enable it in `.env`:

  ```sh
  OECP_LOGO_IMAGE=/branding/logo.svg
  ```

  The logo replaces the text brand in the header and links to the home page;
  its text alternative is the alliance name (`OECP_ALLIANCE_NAME`).

## Partner logos (course list and course page)

- One file per partner university, named after the organization's slug (as in
  the admin dashboard and the API): `partner-<slug>.svg`, or `.png`, or `.webp`
  (the first present in that order is used). For example `partner-uice.svg`
  for the organization `uice`.
- SVG, or PNG with a transparent background; about 4:1 to 1:1; under 50 KB.
  Shown 1.5rem (24 pixels) high next to the university name on each course
  card and 2.5rem (40 pixels) high next to it on the course page.
- No variable is needed: the portal finds the file through
  `/branding/index.json`. The logo is decorative (`alt=""`), since the
  university's name is shown as text next to it; without a file, the name alone
  is shown as before.

## Favicon

- The portal has its own favicon (`/favicon.svg`). To use the alliance's
  instead, add a square SVG (or PNG, ICO) and set it in `.env`:

  ```sh
  OECP_FAVICON_IMAGE=/branding/favicon.svg
  ```

  It may also be an absolute `https://` URL; its type is taken from the file
  extension.

## Legal pages

The portal has two public pages whose text is yours, not part of OECP. Each is
a Markdown file in this directory, one per language (`<lang>` is the 2 or 3
letter language code of a portal language, in lower case, for example `en`,
`ca`):

| Page                    | URL                                      | File                      |
| ----------------------- | ---------------------------------------- | ------------------------- |
| Privacy notice          | `https://{portal-host}/en/privacy`       | `privacy.<lang>.md`       |
| Accessibility statement | `https://{portal-host}/en/accessibility` | `accessibility.<lang>.md` |

- **Language:** the page in language `xx` shows `<name>.xx.md` when it exists,
  else the English file `<name>.en.md`. English is therefore the file to write
  first; the other languages are optional. A text shown in another language than
  the page's is marked with its language for screen readers.
- **Not published yet:** until `privacy.en.md` (or `accessibility.en.md`)
  exists, its page answers HTTP 404 with a short "not published yet" message and
  is kept out of search indexes; the footer links ("Privacy notice",
  "Accessibility statement") appear only once the English file exists (within
  about a minute, as for any new file). So do not put the URL into any
  registration before the text is real.
- **Privacy notice:** the controller's own text. For Aurora the controller is the
  Aurora Foundation, so its notice goes here; OECP does not write it for you. This
  is the URL the SAML federation (Data Protection Code of Conduct) asks for: use
  `https://{portal-host}/en/privacy` as the privacy statement URL in the
  SP metadata. The page is rendered on the server, so it works without
  JavaScript and the address stays stable.
- **Accessibility statement:** follows `docs/production/accessibility-statement.md`
  (copy and complete it with the alliance's contact details and the date of the
  last review).
- **Title:** the first `# Heading` of the file is the page title (`<title>`
  and `<h1>`); without one the portal uses "Privacy notice" or
  "Accessibility statement".

The files are plain Markdown, of which only a small subset is interpreted:
headings (`#`, `##`, `###`), paragraphs (separated by a blank line), `**bold**`,
`*italic*`, bullet lists (`- item`), numbered lists (`1. item`), links
`[text](https://example.eu)` (only `http`, `https` and `mailto:` targets) and
horizontal rules (`---`). Raw HTML is never interpreted: it is shown as text.
Tables, images, code and nested lists are not supported. Like images, the files
are sent with `cache-control: public, max-age=86400`, so a changed text may take
up to a day to reach browsers that have it cached.

## Permissions and security

- The `web` container runs as uid 1000: the directory and its files must be
  readable by it (for example `chmod 755` on the directory and `chmod 644` on
  the files).
- No Content-Security-Policy change is needed for files on the portal origin
  (`img-src 'self' data: https:`); an absolute `https://` URL is allowed too.
- Apply `docker compose up -d web` after changing a variable; adding or
  replacing a file needs no restart (a new partner logo shows within a minute).
