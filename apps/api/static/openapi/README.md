<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Redoc standalone bundle (third-party, vendored)

The OpenAPI viewer of `/api/public/v1/docs` and `/api/admin/v1/docs`
(`src/openapi/docs.ts`) loads this bundle from `/api/docs-assets/2.5.4/redoc.standalone.js`.
It is served by the api from the portal origin: no CDN, no web fonts, no request
to a third party.

| | |
| --- | --- |
| File | `redoc.standalone.js` |
| Upstream | Redoc, <https://github.com/Redocly/redoc>, npm package `redoc` |
| Version | 2.5.4 (npm, published 2026-09-10), file `bundles/redoc.standalone.js` |
| Tarball | <https://registry.npmjs.org/redoc/-/redoc-2.5.4.tgz>, integrity `sha512-M6jWhG1qoBnH6TFmzJnstyCZ87HmOY/UzDm78mHiYihEdlV/YcS9ogOo1NlElnJMeLsyxHFe2yFc4sNjHTrABQ==` |
| SHA-256 | `dcaf76612bc4a3fbcc923a8966dee2f6146a5f32e5ce1b6f02dd60cbbf89500b` (checked at start-up: `REDOC_SHA256` in `src/openapi/docs.ts`) |
| Licence | Redoc: MIT, `LICENSE` in this directory (copied from the package). The bundle also contains third-party packages whose notices are `redoc.standalone.js.LICENSE.txt` and `d87bcbdbea8f8f5aa26f.worker.js.LICENSE.txt` (search worker, inlined in the bundle), copied verbatim from the package: MIT (React, MobX, styled-components, marked, Prism, lunr and most others), ISC (minimatch), BSD-3-Clause (swagger2openapi, oas-kit, reftools, url-template, hoist-non-react-statics) and DOMPurify, dual-licensed Apache-2.0 OR MPL-2.0 and used here under Apache-2.0. |
| REUSE | declared in the repository `REUSE.toml`; licence texts in `LICENSES/MIT.txt`, `ISC.txt`, `BSD-3-Clause.txt`, `Apache-2.0.txt` |
| Changes | None to the file. At start-up the api replaces, in the served copy only, the URL of the "API docs by Redocly" logo (`https://cdn.redoc.ly/redoc/logo-mini.svg`) with `data:,`, so the page requests nothing from the Redocly CDN; the start-up fails if the URL is not found exactly once. |

## Why vendored and not an npm dependency

`redoc` as a dependency of `@oecp/api` would install about 110 packages (81 MB:
React, styled-components, MobX, core-js, swagger2openapi…) into the production
image only to serve this one prebuilt browser file. The file is copied into the
image with the api sources (`deploy/compose/dockerfiles/api.Dockerfile`, stage
`prod-deps` copies the workspace), and read from `apps/api/static/openapi/`.

## Updating

1. Download the tarball of the new version from the npm registry and check its
   `integrity` against `npm view redoc@<version> dist.integrity`.
2. Copy `package/bundles/redoc.standalone.js`, its `*.LICENSE.txt` files and
   `package/LICENSE` here; update this table, `REDOC_VERSION` and `REDOC_SHA256`
   in `src/openapi/docs.ts` and the `REUSE.toml` comment (the licences of the
   bundled packages: `redoc.standalone.js.map` lists them under `node_modules/`).
3. Check the logo replacement still applies and that the pages render with no
   CSP violation under `security-headers-api-docs`
   (`deploy/compose/traefik/dynamic/middlewares.yaml`).

The asset URL carries the version, so browsers fetch the new bundle at once.
