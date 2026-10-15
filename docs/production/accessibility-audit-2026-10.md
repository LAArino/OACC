<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Accessibility audit, October 2026 (release 0.6.0 and unreleased work)

Audit of the public portal and the administration panel of OECP (`apps/web`) against **WCAG 2.1 level AA**, the web requirements of EN 301 549 V3.2.1 referenced by Directive (EU) 2016/2102. Carried out on 2026-10-15 on the development stack (`deploy/compose`, profile `dev`) with the 31 published courses of the development data (University of Iceland, Duisburg-Essen, Amsterdam, Créteil, Olomouc, the simulated Innsbruck, one alliance course). It feeds the [accessibility statement](accessibility-statement.md).

**What this audit is and is not.** It combines automated checks of complete rendered pages in a browser, scripted keyboard checks, an accessibility-tree review and reflow and zoom checks. **No screen reader was run**: VoiceOver and NVDA could not be driven in this environment, so the screen-reader part is a review of the accessibility tree (roles, names, states, live regions, `lang`), not a listening test. A session with assistive technology (section 7) and the Keycloak sign-in pages (a separate application) remain to be done before "fully compliant" can be considered.

## 1. Method and tools

| Tool | Version | Use |
|---|---|---|
| Chromium (Playwright headless shell) | 147.0.7727.15 | Rendering, keyboard and layout checks |
| Playwright | 1.59.0 (same as `tools/e2e-identity`) | Page driving, `keyboard.press`, `document.activeElement` inspection, viewport emulation |
| axe-core / `@axe-core/playwright` | 4.14.0 / 4.14.0 | Automated rules, tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `best-practice`, run on each page state after network idle |
| Vitest, `@nuxt/test-utils`, axe-core in jsdom | 5.0.4, axe-core 4.14.0 | The existing unit tests (`axeViolations` helper on mounted components, `test/contrast.test.ts` on the colour tokens) and the tests added by this audit |
| Application under test | OECP 0.6.0 + unreleased (`main` at 0176d7c), Nuxt 4.6.1, Vue 3.5.44, vue-router 5.4.0, `@nuxtjs/i18n` 10.6.0 | Image `oecp/web:dev`, rebuilt from the working tree to re-test after the fixes |

The scripts (not part of the repository) signed in once as the alliance administrator `admin@aurora-universities.eu` (password and TOTP read from the development secrets, the same way as `tools/e2e-identity/relogin.js`) and reused the Keycloak session through the panel's silent restore. No data was created, changed or deleted: forms were opened, typed into and submitted only where the client-side validation stops the submission; the confirmation dialog was opened and dismissed with Escape; only *Refresh* buttons were run.

Per page state the scripts recorded: axe violations and incomplete results; the heading outline, landmarks, live regions, `lang` attributes and links with the same name and different targets; `document.documentElement.scrollWidth` against the viewport at 1280, 375 and 320 CSS px and at 640 × 450 (the 1280 px desktop at 200 % zoom); a full-page screenshot. The keyboard script tabbed through each page recording every focus stop, whether a focus indicator (outline of at least 2 px or a box shadow) is drawn, whether the focused element is in the viewport and not covered, and detected traps.

## 2. Scope

| Page | States | Viewports |
|---|---|---|
| Home `/en` | default | 1280 × 900, 375 × 812, 320, 640 (200 %) |
| Catalogue `/en/courses` | page 1, page 2 (`?page=2`), filters and query (`?q=sustain&mode=online&partner=uice`, 1 result; `?q=sustain&mode=online`, 2 results), filter applied by keyboard, chip removed, sort changed, search suggestions open | same |
| Course `/en/courses/b6ad677e-…` (*Sustainable Tourism in Alpine Regions*, Innsbruck, two offerings, texts in English and German) | English texts, German texts (`?text_lang=de`), language tabs by keyboard | same |
| Not found `/en/courses/00000000-0000-4000-8000-000000000000` | 404 error page | same |
| Admin sign-in prompt `/en/admin` | before sign-in (after the 3 s restore grace) | same |
| Accept `/en/admin/accept` | without token (error state) | same |
| Admin dashboard `/en/admin` | without and with `?org=` | same |
| Invitations `/en/admin/invitations` | default, empty submit (field error) | same |
| Organizations `/en/admin/organizations` | list | same |
| Organization `/en/admin/organizations/{uice}` | default, *Delete organization* confirmation dialog open (dismissed) | same |
| New organization `/en/admin/organizations/new` | empty, submitted empty (error summary) | same |
| Courses `/en/admin/courses?org={uice}` | list (the page takes the organization from `?org=`, else from `/me`; the alliance administrator picks it with the organization picker) | same |
| Course editor `/en/admin/courses/{id}?org=…` (*Sustainability Education and Learning*) | each of the 4 steps, review step included | same |
| New course wizard `/en/admin/courses/new?org=…` | step 1 empty, step 1 with errors, steps 2, 3 and 4 (review) reached with valid values, never saved | same |
| Offering `/en/admin/courses/{id}/offerings/{offeringId}` and `/offerings/new` | edit, new, new submitted empty | same |
| CSV console `/en/admin/csv?org=…` | default (no file) | same |
| Sync history `/en/admin/sync-runs?org=…` and one run `/en/admin/sync-runs/{id}` | list, run with 5 issues | same |
| Maintenance `/en/admin/maintenance` | runs list, run details expanded | same |
| Network `/en/admin/network` | default, after *Refresh* | same |
| Integration `/en/admin/integration?org=…` | default | same |

Excluded: `robots.txt`, `sitemap.xml`, the OIDC callback pages (no content), the Keycloak sign-in, OTP and account pages (separate application with its own theme), and states that need data changes (invitation revoke dialog with a pending invitation, CSV upload report after a real upload). The confirmation dialog was audited through *Delete organization*, which uses the same `AdminConfirm` component as *Revoke*.

## 3. Automated results

39 page states × 2 viewports (78 runs after the fixes; 76 before, the *delete* dialog state being added afterwards).

| Impact | Before (nodes) | After (nodes) |
|---|---|---|
| critical | 0 | 0 |
| serious | 4 | 0 |
| moderate | 0 | 0 |
| minor | 0 | 0 |

Before, by rule: `html-has-lang` (serious, the 404 page, both viewports) and `color-contrast` (serious, *Delete organization* on the organization page, both viewports). The *before* run could not reach steps 3 and 4 of the new-course wizard (script error, a required level was not ticked); the *after* run covers them, with the same components as the course editor's steps 3 and 4, which both runs covered.

Reflow (not an axe rule), before: horizontal page scrolling at 320 px on the course page, the admin course list, the course review step, the CSV console and the maintenance page; at 375 px (mobile) on the admin course list, the review step and the maintenance page; at 640 px (200 % zoom) on the admin course list and the maintenance page. After: none at any width.

**Incomplete (needs a human)**: only `color-contrast`, 311 nodes after (313 before), for three reasons: text inside table cells that overflow their scroll region ("partially obscured"), cells too short to judge (numbers), and icon-only characters (`↗`, `›`, hidden from assistive technology). All of them use the colour tokens whose pairs are checked by `apps/web/test/contrast.test.ts` (text ≥ 4.5:1, borders and focus ≥ 3:1); the one hard-coded colour (`#d3e2f2`, chip hover) gives 8.8:1 with the chip text. No action needed.

## 4. Findings

Severity: **blocker** (prevents use), **serious** (major barrier, AA failure), **moderate** (AA failure with a workaround, or significant confusion), **minor** (advisory or small impact).

| # | WCAG 2.1 | Severity | Pages | Description | Fix |
|---|---|---|---|---|---|
| 1 | 1.4.3 Contrast (Minimum) | serious | Organization page (*Delete organization*), and the same class on *Remove* (administrators), *Revoke* (invitations), *Delete course*, *Delete offering* | `button.button` outranks `.button--secondary`, so the danger-text secondary button kept the primary background: dark red text on dark blue, 1.05:1, practically invisible | **Fixed**: `button.button.button--danger-text` sets its own background (white; hover the danger background; disabled state styled) in `assets/css/admin.css` |
| 2 | 3.1.1 Language of Page | serious | Every error page (404, 503, 500) | Nuxt renders `error.vue` instead of `app.vue`, which sets `<html lang>`: the error page had no `lang` | **Fixed**: `error.vue` sets `lang` and `dir` from `useLocaleHead` |
| 3 | 2.4.1 Bypass Blocks | moderate | Every error page | Same cause: no "Skip to main content" link; the first Tab went to the logo link | **Fixed**: new `SkipLink.vue` used by `app.vue` and `error.vue`; its styles moved to `main.css` so they load with the error page |
| 4 | 1.4.10 Reflow | serious | Admin course list, maintenance, course review step, CSV console; course page at 320 px | (a) Visually hidden texts inside table cells are absolutely positioned against the page, not the table's scroll area, so the whole page scrolled sideways (932 px at 320 px); (b) the facts lists (`dl.facts`) kept their terms at full width and long values (URLs) could not wrap; (c) the *Apply at …* button and the file input did not shrink | **Fixed**: `.admin-table-wrap { position: relative }`; `.facts` columns `fit-content(50%) minmax(0, 1fr)`; offering list `minmax(0, 1fr)`; apply button wraps; `input[type=file] { max-width: 100% }`. Data tables still scroll inside their own focusable region (two-dimensional content, allowed by 1.4.10) |
| 5 | 1.3.1 Info and Relationships, 4.1.2 Name, Role, Value | moderate | Catalogue: pagination links, filter chips, *Clear all*, empty-state links | The router marks every link to `/en/courses` as `aria-current="page"` whatever its query, so screen readers announced "current page" on *Page 1*, *Page 2*, *Next* and every *Remove filter* link | **Fixed**: these links override `aria-current`; only the current page (a `span`) carries it. The main navigation keeps *Courses* as current |
| 6 | 2.4.3 Focus Order (and 2.1.1) | moderate | Network, Organizations, Maintenance runs, Invitations list | *Refresh* was `disabled` while loading; disabling the focused button sends the keyboard focus to the start of the document | **Fixed**: `aria-disabled` while loading (clicks ignored), focus stays on the button; the status message is still announced |
| 7 | 2.4.7 Focus Visible | minor | Offering form date fields | When focus reaches the calendar button inside a date field, the author outline disappeared (only Chromium's own ring remained) | **Fixed**: the outline is drawn with `:focus-within` on the whole field |
| 8 | 2.4.5 Multiple Ways | moderate | Administration panel | The admin pages have no navigation of their own: the header only says "Administration", each module is reached from the dashboard's module list (and some cross-links); there is no second way to locate a module page | **Open**: needs an admin navigation (header menu or module list on every page), a design decision beyond a local fix |
| 9 | 2.4.4 Link Purpose (In Context) | minor | Course page with several offerings; Network table | *Apply at University of Innsbruck (host)* repeats per offering, and the last-run links read as a date ("Oct 15, 2026, 12:17 PM"). Purpose is clear from the offering heading and the row header, so AA is met; out of context (links list) they are ambiguous (2.4.9, AAA). The *Sync history* links are fine: `aria-label` "Sync history of {organization}" | **Open** (advisory): add `aria-describedby` to the offering heading and to the organization row header |
| 10 | 2.4.2 Page Titled | minor | All pages | Titles are descriptive but carry neither the site nor the alliance name, and the admin list "Courses" has the same title as the public catalogue | **Open** (advisory): a title template ("… – Administration – {alliance}") |
| 11 | 3.3.1 Error Identification, 1.3.1 | minor | Course wizard (*Levels*, *ISCED-F fields*) | Group errors are tied to the `fieldset` through `aria-describedby`; screen readers differ in announcing descriptions of groups | **Open**: verify in the assistive-technology session; if not announced, also describe the first control of the group |
| 12 | 3.2.2 On Input | minor | Organization picker (courses, CSV, sync, integration, wizard) | The picker loads the chosen organization on `change`; on Windows each arrow key in a closed `select` fires `change`, so arrowing through the list reloads the module for each organization. Focus stays on the picker and the page does not change context, so AA is met | **Open** (advisory): apply on a button or on blur |
| 13 | — (design) | minor | Administration panel, catalogue *Retry* | `<button class="button button--secondary">` renders as a primary button (same specificity cause as finding 1); contrast is fine, only the visual hierarchy is lost | **Open**: a visible design change across the panel, for the owner to decide |
| 14 | 2.5.8 Target Size (WCAG 2.2, not required by 2.1) | note | Filters and admin forms | Checkboxes and radio buttons are 20 × 20 px (their labels are clickable and enlarge the target); some table links are 18 px high | Note for a 2.2 claim |

No blocker was found. Not found anywhere: missing form labels, missing table headers, colour-only status (every badge has text), images without an appropriate alternative (header banners `alt=""`, logo alt = alliance name, as intended), keyboard traps, focus hidden by sticky elements (there are none), animations (none; `prefers-reduced-motion` is honoured globally in `main.css`).

## 5. Manual checks performed

**Keyboard** (Chromium, Tab / Shift+Tab / Enter / Space / arrows / Escape):

- *Skip link*: first Tab on the home, catalogue, course, error (after fix 3) and admin pages lands on "Skip to main content", visible at the top; Enter moves focus to `main#main`.
- *Order and reachability*: every interactive element reached in DOM order, which follows the visual order; no trap on any page (the walk returns to the start). Admin pages tabbed: dashboard, organization, courses, course editor, CSV, maintenance, network, integration, offering.
- *Focus visible*: every stop draws the 3 px `--c-focus` outline (after fix 7); none is covered or off-screen.
- *Confirmation dialog* (`AdminConfirm`, *Delete organization*): native modal `<dialog>`, labelled by its title and described by its message; focus starts on *Go back* (the safe choice); Tab cycles between the two buttons and the browser chrome, nothing outside the dialog is focusable; Escape closes it and returns focus to *Delete organization*. Not confirmed.
- *Catalogue*: toggling a filter checkbox with Space applies the filter in place, keeps focus on the checkbox and announces "17 courses found" in the polite status region; removing a filter chip with Enter moves focus to the results heading (`h2#results-heading`, `tabindex=-1`) and announces the count; the pagination link to page 2 does the same, as `pages/(public)/courses/index.vue` intends (`focusResults`, `announcement`). Changing the sort with the keyboard keeps focus on the select.
- *Search suggestions* (`CourseSearchBox`): combobox with `aria-autocomplete="list"`, `aria-expanded`, `aria-activedescendant` moved by the arrow keys, a status message "2 suggestions available…", Escape collapses.
- *Course language tabs* (`LanguageTabs`, after hydration): tabs pattern with automatic activation; only the selected tab is in the Tab order; Right arrow selects and focuses *German*, updates `?text_lang=de` and the panel's `lang="de"`; the panel itself is the next Tab stop (`tabindex=0`). Without JavaScript the tabs are plain links with `aria-current`.
- *Admin language tabs* (`AdminLanguageTabs`): buttons with `role="tab"`, arrow keys and Home/End, roving `tabindex`; the inputs of each language carry `lang`.
- *Course wizard* (`AdminWizardSteps`): steps are buttons in an ordered list inside a labelled `nav`, current step `aria-current="step"`, unreachable steps disabled; selecting a step moves focus to the step heading "Step 2 of 4: Texts".
- *Error summaries* (`AdminErrorSummary`): on *Next* with empty fields (wizard), on submit (new organization, new offering) focus moves to the alert listing the problems; each link moves focus to its field, which has `aria-invalid="true"`, `aria-required="true"` and `aria-describedby` with its hint and "Error: …". The invitation form, with one field, focuses the invalid field directly.
- *Organization picker*: labelled select; after a change the page keeps focus on it and announces the new result count.
- *Refresh* (network): focus stays on the button (after fix 6) and "Network status updated, as of …" is announced.
- *Maintenance run details*: the toggle has `aria-expanded` and `aria-controls`, focus stays on it.

**Structure and semantics** (accessibility tree and DOM, every state): exactly one `h1` per page and no skipped heading levels; landmarks `banner`, `navigation` labelled "Main" (public), "Breadcrumb", "Result pages", "Course wizard steps", "Sections of this page", `main`, `contentinfo` (public), `search` (catalogue, admin filters); every form control has a label; tables have a caption, `scope="col"` headers and row headers, inside a focusable labelled scroll region; status badges (`AdminStatusBadge`, `AdminHealthBadge`, `AdminLifecycleBadge`) show text; decorative characters are `aria-hidden`; "(opens in a new tab)" is given in visually hidden text; `<html lang>` on every page (after fix 2); course texts in another language than the page carry `lang` (course page panel, card titles and abstracts in fallback language, application instructions, admin text inputs); live regions where results change (catalogue count, suggestions, admin lists, network, maintenance, sync run issues).

**Visual**: contrast by axe on every state plus the token test; reflow at 320 px and 200 % zoom (640 px) without horizontal page scrolling (after fix 4); no `transition` or `animation` in the code, and a global `prefers-reduced-motion` rule; no sticky or fixed headers, so focus cannot be obscured; mobile target sizes measured (finding 14).

**Unit tests added or changed** (`apps/web/test`): `a11y-css.test.ts` (skip-link, facts grid, table scroll area, danger-text button rules); `catalogue-components.test.ts` (only the current page and no remove link carry `aria-current` on the list path, with the router's `RouterLink` standing in for `NuxtLink`, which the test router never marks active); `catalogue-pages.test.ts` (the error page starts with the skip link); `admin-alliance-pages.test.ts` (*Refresh* stays focusable while loading).

## 6. Files changed by the fixes

`apps/web/app/components/SkipLink.vue` (new), `app.vue`, `error.vue`, `assets/css/main.css`, `assets/css/admin.css`, `components/CataloguePagination.vue`, `components/FilterChips.vue`, `components/OfferingDetails.vue`, `pages/(public)/courses/index.vue`, `pages/(public)/courses/[id].vue`, `pages/(admin)/admin/network.vue`, `pages/(admin)/admin/organizations/index.vue`, `pages/(admin)/admin/maintenance.vue`, `components/AdminInvitationsPanel.vue`. No route, API, or i18n key changed.

## 7. What remains for a human: assistive-technology session

To be run by someone fluent with a screen reader, on the development or staging stack, before the statement is published. Recommended pairs: **NVDA 2025.x + Firefox** and **JAWS or NVDA + Chrome** on Windows, **VoiceOver + Safari** on macOS and iOS. Record per step: what was heard, whether it matched, and the WCAG criterion if not.

1. **Home** `/en`: press Tab once (hear "Skip to main content, link"), Enter; read the page with the heading list (H): one level-1 "Find a course", two level-2 sections; the logo is announced as "Aurora European Universities Alliance, link"; the banner image is not announced.
2. **Search with suggestions**: type "sust" in the search field; hear "2 suggestions available…"; arrow down and hear each suggestion (title and university); Escape closes; Enter on a suggestion opens the course.
3. **Catalogue filters**: in `/en/courses`, tick *University of Innsbruck* with Space; hear "17 courses found" without losing your place; open the landmarks list (search, filters, results, "Result pages").
4. **Filter chips and pagination**: activate *Remove filter University: …*; focus lands on "31 courses found …" and it is read; go to page 2; check that only the current page is announced as "current page".
5. **Course page** (*Sustainable Tourism in Alpine Regions*): breadcrumb; facts list read as term and value; language tabs ("tab, 1 of 2, selected"); Right arrow to *German* and check the text is read with German pronunciation; the two *Apply* links: are they distinguishable with the offering heading (finding 9)?
6. **Error page** `/en/courses/00000000-0000-4000-8000-000000000000`: page language announced as English, skip link present, "Page not found" heading.
7. **Admin sign-in and dashboard**: sign-in prompt, then the Keycloak pages (username, password, one-time code: labels, errors, timing — WCAG 2.2.1, 3.3.1; 3.3.8 if WCAG 2.2 is claimed); after sign-in, the dashboard's account summary and module list; how a screen-reader user moves between modules (finding 8).
8. **Course wizard** (*New course*, never save): press *Next* with empty fields; hear the alert "There are problems with 4 fields" and the list; follow a link to the field and hear its label, "required", "invalid" and the error; check the *Levels* group error is announced (finding 11); move between steps and language tabs.
9. **Confirmation dialog**: on an organization page activate *Delete organization*; hear the dialog title and message, focus on *Go back*; Escape closes it and returns to the button. Do not confirm.
10. **Tables and live updates**: on *Network status* use table navigation (row and column headers announced), activate *Refresh* and hear "Network status updated…" while focus stays on the button; on *Maintenance* expand a run's details and hear "expanded".

Also: 400 % zoom on a desktop browser (1280 px → 320 px) and text-spacing override (WCAG 1.4.12) with a bookmarklet on the catalogue, course page and course wizard; Windows high-contrast mode (`forced-colors`) on buttons, chips and badges.

## 8. Known limitations for the accessibility statement

To carry into section *Non-accessible content* of the [statement](accessibility-statement.md) until fixed:

- The administration panel has no navigation of its own: modules are reached from the dashboard only (finding 8, WCAG 2.4.5).
- Several links share a name out of context: *Apply at {university}* per offering on a course page, last-run dates in the network table (finding 9; meets 2.4.4 AA, not 2.4.9 AAA).
- The organization picker reloads the module on each change, which arrow-key users on Windows may find disorienting (finding 12; meets 3.2.2).
- Not yet verified with screen readers (section 7) or by users with disabilities; the Keycloak sign-in and one-time-code pages have not been audited; TOTP is the only second factor (WCAG 2.2 3.3.8, if 2.2 is claimed).
- Course descriptions and application instructions are plain text written by the partner universities; their quality (headings, plain language, link texts inside them) is outside OECP's control.
