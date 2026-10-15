<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0002: Vue 3 + Nuxt with a server-rendered catalogue

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [R03] `docs/review/03-architecture-stack-licences.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

Specification v3.0 left the front end open ("Vue/React") for both the public
search portal and the private dashboard [R03 §1]. The public catalogue must be
indexable by search engines, accessible to WCAG 2.1 AA (EN 301 549, Directive
(EU) 2016/2102) with 2.2 AA as target, cookie-free, and designed from day one
for per-partner UI languages with English fallback [R03 §3; DL 5]. The admin
dashboard is used by a few authenticated staff per partner.

Which front-end framework and rendering strategy should OECP use?

## Decision drivers

- Search-engine visibility of course pages (SEO, JSON-LD, sitemap) [R03 §3].
- Accessibility obligations and a tested accessible component library [R03 §1, §3].
- Low entry barrier for occasional contributors from university IT teams [R03 §1].
- Official, maintained solutions for routing, state and i18n [R03 §1].
- TypeScript shared with the backend ([ADR-0001](0001-modular-monolith-on-nestjs.md)).
- Permissive licences (MIT) [R03 §1].

## Considered options

1. Vue 3 + Nuxt, server-side rendering for the public catalogue, client-rendered admin.
2. React + Next.js.
3. Single-page application without SSR (Vue or React).

## Decision outcome

Chosen option: **Vue 3 + Nuxt**, because Nuxt provides the server-side
rendering the catalogue needs for SEO, Vue has a lower entry curve for
occasional contributors, and router, state (Pinia) and i18n are official
packages, all under MIT [R03 §1; DL 10].

Rendering split (spec §7, §8):

- **Public catalogue:** Nuxt 4 SSR under `/{locale}/…`, state in the URL,
  `@nuxtjs/i18n` with locale prefix, English fallback marked `lang="en"`,
  `hreflang`, schema.org/Course JSON-LD, `/sitemap.xml`. No cookies, no
  authentication, no analytics in the MVP; public responses must not carry
  `Set-Cookie`.
- **Admin dashboard:** client-rendered under `/{locale}/admin` (`ssr: false`),
  Reka UI components, OIDC Authorization Code + PKCE with tokens in memory.

### Consequences

- Good, because course pages are rendered on the server and indexable, with
  structured data and per-locale URLs (spec §7).
- Good, because one Nuxt application serves both the public portal and the
  admin, while keeping the public side free of OIDC code and cookies.
- Good, because UI strings live in catalogues from the start, so adding a
  partner language later needs translations, not code (spec §7; DL 5).
- Bad, because SSR adds a Node.js server process to operate and secure (CSP
  nonces, rate limits) compared with static hosting.
- Bad, because accessibility depends on the component library choice; Reka UI
  must be verified with axe and a manual audit (spec §10).

### Confirmation

Playwright end-to-end tests assert server-rendered course pages, the absence
of `Set-Cookie` on public responses, and zero serious @axe-core/playwright
violations (spec §10).

## Pros and cons of the options

### Vue 3 + Nuxt

- Good, because of SSR for SEO and a low entry curve [R03 §1].
- Good, because routing, Pinia and i18n are official [R03 §1].
- Neutral, because accessibility depends on a proven component library such
  as Reka UI [R03 §1].

### React + Next.js

- Good, because of the largest ecosystem and SSR support.
- Bad, because of a steeper curve for occasional contributors, and routing,
  state and i18n are a choice among third-party options.

### SPA without SSR

- Good, because it is simplest to host.
- Bad, because catalogue pages would depend on client-side rendering for
  indexing and first paint, against the SEO goal [R03 §3].

## More information

- Specification §7 (public portal), §8 (admin dashboard), §10 (accessibility).
- Revisit if Nuxt's SSR model conflicts with the no-cookie or CSP requirements.
