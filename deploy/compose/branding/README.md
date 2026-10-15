<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Branding

This directory holds the deploying alliance's own images: the header image of
the public home page and the logo of the site header. The alliance holds the
rights to these pictures; they are deployment configuration, not part of OECP.
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
- one of the extensions `png`, `jpg`, `jpeg`, `webp`, `avif`, `svg`, `ico`.

For example `hero.jpg` or `aurora-logo.svg`, not `Hero.JPG`. Sub-directories
are not served. Files are sent with `cache-control: public, max-age=86400`:
browsers may keep showing an old image for up to a day after a change, so give
a changed image a new file name and update the variable.

## Header image (home page)

- At least 1800 × 600 pixels, aspect ratio 3:1 (it is cropped to 3:1 on wide
  screens and to 2:1 on phones, keeping the centre), under 400 KB.
- PNG, JPEG or WebP (JPEG or WebP for photographs).
- Enable it in `.env`:

  ```sh
  OECP_HERO_IMAGE=/branding/hero.jpg
  OECP_HERO_IMAGE_ALT=
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

## Permissions and security

- The `web` container runs as uid 1000: the directory and its files must be
  readable by it (for example `chmod 755` on the directory and `chmod 644` on
  the files).
- No Content-Security-Policy change is needed for files on the portal origin
  (`img-src 'self' data: https:`); an absolute `https://` URL is allowed too.
- Apply `docker compose up -d web` after changing a variable; adding or
  replacing a file needs no restart.
