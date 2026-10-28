<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Acceptance test plan: OACC 0.11.0 for the Aurora pilot

Run by people in the real roles, on the real server, with their own accounts, and signed at the end. Companion to the [go-live checklist of Guide A](../onboarding/alliance.md#go-live-checklist) and the [runbook](runbook.md). Screens and labels are those of the [alliance administrator manual](../manuals/alliance-admin.md) and the [partner administrator manual](../manuals/partner-admin.md); where a label is not in those or in the admin interface texts, the plan says *(check the exact label)* and the executor writes down what the screen shows.

## 1. Purpose, scope and out of scope

**Purpose.** To show that release 0.11.0, deployed at `https://lspurv.urv.cat` (sign-in service `https://auth.lspurv.urv.cat`), does what the alliance needs for the pilot: the people who will run it can do their work with the screens as built, the public catalogue shows what they publish, and the hosting operator can keep it alive.

**Validated means:** scenarios A to D and F to H passed in full, scenario I passed except the screen-reader session (which may stay *pending* with a written acceptance by the Foundation), and the defect log has no open *blocker* or *major* defect. Scenario E is *deferred*. The signed plan is evidence for the go-live checklist, not a legal opinion.

**Deployment under test.** Local-account mode: no identity provider is connected and all ten organizations have an empty `keycloak_idp_alias` (*OACC accounts* in the organizations list). The alliance administrator is, for now, the person named by the Foundation; the hosting operator (URV) supports. The 13 courses of the Aurora Virtual Campus 2026-27 are already loaded by CSV for `uice`, `ude`, `upec`, `vua` and `up` (the alliance's CSV files, kept in its private deployment material; the fictional [example dataset](../data/example-alliance-2026-27/README.md) has the same structure). `OECP_PUBLISH_RULE` is `warn`.

**Out of scope, with reasons**

| Item | Why it is not tested |
|---|---|
| Federated sign-in (*Sign in through your university*, eduGAIN) | No partner identity provider is connected; the service provider registration with SIR2 is pending ([identity paths](../onboarding/identity-paths.md)) |
| OEAPI harvest, host approval, *Test connection*, *Sync now* | No partner has an OEAPI endpoint ready; the harvester has only been verified against the mock endpoint |
| Overrides on harvested records | They need a harvested record: see scenario E (deferred) |
| Course images and complete course data for the 13 loaded courses | The Foundation still has to supply them; the loaded courses are expected to carry `oecp.content.handbook_incomplete` warnings (instructors, some prerequisites, assessment) |
| Dormancy and account clean-up taking effect | They stay in dry run during the pilot ([decision 26](../decisions-log.md)); only their reports are checked (H) |
| Legal pages `/en/privacy` and `/en/accessibility` | Served from the branding directory since 0.11.0; checked with the privacy notice, not here |
| Load, security testing, penetration tests | Separate activities |

## 2. Participants, preconditions and recording

### 2.1 Participants

| Code | Role | Who (name, organization) | Used in |
|---|---|---|---|
| AA1 | Alliance administrator (Aurora Foundation) | | A, B, C (observer), G, H (observer) |
| AA2 | Second alliance administrator (a colleague of the alliance office) | | A |
| PA | Partner administrator of the chosen university (volunteer; may be URV itself) | | B, C, D, G, I |
| PA2 | A second person at the same university, for the pending set-up checks | | G |
| OP | Hosting operator (URV IT) | | H, and mail checks |
| OBS | An anonymous visitor (no account, private window) | | F |

University chosen for the partner scenarios: `____` (slug). It must have no OEAPI harvest enabled. If it is one of the five universities with loaded courses, the test records use the codes below anyway and are withdrawn at the end ([section 3.10](#310-closing-the-test-data)); URV is preferable because its catalogue is still empty.

### 2.2 Preconditions (OP confirms before the first scenario, and signs here)

- [ ] Server runs release 0.11.0 (`git describe --tags` in the deployment directory prints `v0.11.0`); `docker compose ps` shows every service healthy, the worker included; no `dev` profile.
- [ ] The smoke test of H.7 passed on the final configuration.
- [ ] The mail relay delivers: `OECP_MAIL_LOG_LINKS=false`, so every e-mail below must really arrive.
- [ ] Mailboxes the testers can read: AA2, PA, PA2 and the alert mailbox (`OECP_ALERT_EMAIL_TO`). One authenticator app (phone) per person who signs in: AA1, AA2, PA, PA2.
- [ ] The first alliance administrator (AA1) exists ([Guide A, step 6](../onboarding/alliance.md#6-bootstrap-the-first-alliance-admin)) and has finished the set-up.
- [ ] Ten organizations are loaded: the alliance (`aurora`) and nine universities (`uibk`, `uice`, `vua`, `ude`, `urv`, `unina`, `up`, `cbs`, `upec`).
- [ ] The chosen university's logo `partner-<slug>.svg` (or `.png`, `.webp`) is in the branding directory (`curl -s https://lspurv.urv.cat/branding/index.json` lists it). If not, logo checks are marked *n/a*.
- [ ] The test files for scenario C are ready ([section 3.3](#33-c-channel-b-csv-upload)); a laptop browser with a private window; an SSH tunnel for the operator to Grafana and Alertmanager (H).
- [ ] The evidence folder `acceptance-0.11.0/` exists in a place with restricted access. Screenshots show e-mail addresses of staff: keep the folder as long as the plan is needed, then delete it.

### 2.3 How results are recorded

- Every step has an id (A.1, A.2, ...). The executor ticks it in their own copy of this plan or writes the id in the result table.
- Each scenario ends with a **result table**. Write one row per run (a failed scenario is repeated after the fix; keep both rows). *Result* is `pass`, `fail`, `pending` or `n/a`; any `fail` points to a defect id in section 4.
- **Evidence to keep** is named `<scenario>-<step>-<what>.png` (screenshots of the whole window including the address bar) or `.eml` (the e-mail with headers). Never record passwords, one-time codes or invitation links; blank them in screenshots.
- A step is *pass* only when the whole **Expected result** is true. Anything unexpected, even if harmless, goes into *Notes*.

Severity of a defect: **blocker** (a role cannot do its job or data is wrong or exposed), **major** (a workaround exists but the pilot would suffer), **minor** (text, layout, small friction), **cosmetic**.

## 3. Scenarios

Test data use the prefix `ACC-` in course codes so that they are recognisable and withdrawn at the end. Dates of offerings are in the future (start 2027-03-01, end 2027-06-30, application start 2026-11-01, deadline 2027-02-01).

### 3.1 A. Alliance administration

**Role:** AA1, then AA2. **Preconditions:** 2.2 complete. AA2's mailbox and authenticator app ready.

1. **A.1 Sign in.** AA1 opens `https://lspurv.urv.cat/en/admin`; the page shows the sign-in prompt (*Sign in with your organization account to open the administration dashboard.*). Choose **Sign in**; enter e-mail and password on the login page, then the one-time code on the second page.
2. **A.2 Dashboard.** Check *Your account*: e-mail, role *Alliance administrator*, *Signed in through* `local`. Below the organization modules, *Alliance administration* shows the tiles **Network status**, **Organizations**, **Maintenance**. The **Organization** list is present.
3. **A.3 Ten organizations.** Open **Organizations** (`/en/admin/organizations`). The list shows ten rows, each with the identity provider alias column reading *OACC accounts*. Open **Network status** (`/en/admin/network`): the caption reads *10 organizations*, with counters *Error*, *Warning*, *Not configured*, *OK*; note the counts and the health of the five universities with loaded courses.
4. **A.4 Edit an organization.** Open the organization of the chosen university (choose its slug in the list). Under *Details*, change the *Website* (or *Contact e-mail*) to a test value, choose **Save changes**; the page confirms *Changes saved.* The *Slug* field is read-only. Reload: the new value is there. Restore the original value and **Save changes** again.
5. **A.5 Invite a second alliance administrator.** Open **Invitations**, choose the organization `aurora`. Under *Invite an administrator* enter AA2's e-mail, *Role* *Alliance administrator*, *Link valid for* **3 days**, choose **Send invitation**. The page shows *Invitation sent to <e-mail>. The link is valid until <date>.* and the list shows the invitation as *Pending*.
6. **A.6 Mails.** AA2 receives two e-mails: the OACC invitation and the set-up e-mail from the login service.
7. **A.7 Acceptance.** AA2 follows the set-up e-mail (authenticator app: scan the QR code and enter a code; password of at least 12 characters), then opens the invitation link: *Accept invitation* with **Sign in**; signs in with the invited address, password and code. The page shows *Invitation accepted*, *Role: Alliance administrator*, *Organization: <alliance name>* and *Your new role takes effect the next time you sign in.* AA2 chooses **Sign out and sign in again**.
8. **A.8 Both see the alliance tiles.** AA2's dashboard shows *Your account* with role *Alliance administrator* and the three *Alliance administration* tiles. AA1 reloads **Invitations**: the invitation is *Accepted*. On **Organizations** > `aurora` > **Administrators**, both AA1 and AA2 are listed, *Account* *Active*, *Signs in with* *OACC account*.

**Expected result:** as in each step. **Evidence:** A.2 and A.8 (AA2 dashboard) screenshots; A.3 network status; A.6 both e-mails; A.7 acceptance page.

| Date | Executor | Result | Notes / defect ids |
|---|---|---|---|
| | | | |

### 3.2 B. Partner administrator onboarding (local mode)

**Role:** AA1 (inviting), PA (accepting). **Preconditions:** A passed; PA's mailbox and authenticator app ready.

1. **B.1 Invite.** AA1 opens **Invitations**, chooses the organization of the chosen university, enters PA's e-mail, *Role* *Partner administrator*, *Link valid for*: the form offers 7, 3 or 1 day, not 48 hours; choose **3 days** (the closest) and record the date shown in *Invitation sent to ... The link is valid until <date>.* **Send invitation**.
2. **B.2 Two e-mails.** PA receives the OACC invitation and the login service's set-up e-mail. Both arrive within a few minutes.
3. **B.3 Set-up.** PA opens the set-up e-mail, scans the QR code with the authenticator app and enters the first code, then sets a password of at least 12 characters. (A shorter password is refused.)
4. **B.4 Acceptance page.** PA opens the invitation link: *Accept invitation*; **Sign in** with the invited address, password and code. The page shows *Invitation accepted*, *Role: Partner administrator* and *Organization:* with the organization (0.11.0 shows the name and slug, earlier releases showed the identifier: record which). PA chooses **Sign out and sign in again**.
5. **B.5 Own organization only.** After signing in again, the dashboard shows *Role* *Partner administrator*, the university name fixed (no organization list), the modules **Courses**, **CSV upload**, **Sync history**, **Integration settings**, **Invitations**, and no *Alliance administration* tiles. PA opens `/en/admin/organizations` by typing the address: the page does not offer the alliance screens (*This module is for alliance administrators.* or an error: record which). **Invitations** shows the invitation sent to PA as *Accepted*, and no buttons to revoke or resend.
6. **B.6 Administrators panel.** AA1 opens **Organizations** > the university > **Administrators**: PA is listed with role *Partner administrator*, *Signs in with* *OACC account*, *Account* *Active* and a *Last sign-in*; **Remove** is offered.

**Expected result:** as in each step. **Evidence:** B.1 confirmation; B.2 both e-mails; B.4 acceptance page; B.5 dashboard; B.6 panel.

| Date | Executor | Result | Notes / defect ids |
|---|---|---|---|
| | | | |

### 3.3 C. Channel B, CSV upload

**Role:** PA (AA1 may watch and then checks the network status). **Preconditions:** B passed. Files prepared by OP or PA: from the portal, **Templates** of the CSV upload page give `courses.csv` and `offerings.csv` (template 1.3). Fill two courses and two offerings:

- `courses.csv`: `ACC-CSV-1` and `ACC-CSV-2`, status `published`, ECTS 5, level `master`, an English title, abstract, `info_url` (https), `isced_codes` such as `0613`; leave `instructors` empty on both and `prerequisites_en` empty on `ACC-CSV-2` (to see the handbook warnings); fill description, learning outcomes and assessment on `ACC-CSV-1` only.
- `offerings.csv`: row 2 for `ACC-CSV-1`, row 3 for `ACC-CSV-2`, offering code `2027S`, status `published`, English, delivery mode `online`.
- `offerings-bad.csv`: a copy of `offerings.csv` with `2027-02-30` as the start date in row 3.

1. **C.1 Templates.** PA opens **CSV upload** (`/en/admin/csv`) and downloads **Download the courses.csv template** and **Download the offerings.csv template**; the courses template has one `attr_<key>` column per Aurora attribute (`attr_educational_hub`, `attr_sdg`, ...).
2. **C.2 Invalid file, browser.** Drop `courses.csv` and `offerings-bad.csv`. The page detects the two types, then the *Check report* shows *1 errors* (check the plural wording), file `offerings`, row 3, column `start_date`, code `oecp.csv.invalid_date`; **Upload** is disabled. **Download report as CSV** saves the list.
3. **C.3 Invalid file, server.** To show the server is all-or-nothing, PA introduces an error the browser cannot see: in a copy of `courses.csv`, a value `sdg18` in `attr_sdg`. The browser accepts it; **Upload**; the page says *The server rejected the upload: 1 errors and N warnings. Nothing was saved.* (code `oecp.content.unknown_attribute_option`). **Sync history** lists the run as *Failed*; the courses are not in the course list.
4. **C.4 Correct upload.** **Start over**, drop the correct `courses.csv` and `offerings.csv`; the report shows no errors and warnings only; **Upload**. The page shows *Upload processed. Status: succeeded* (check the exact wording) and the server warnings: `oecp.content.handbook_incomplete` for both courses, naming the missing fields (instructors for both, prerequisites for `ACC-CSV-2`).
5. **C.5 Sync history.** Open **Sync history**: the newest run has channel *CSV upload*, trigger *Upload*, status *Succeeded*, counters with the created records of both files (check how courses and offerings are counted) and 0 rejected. Open it (choose its start time): the summary shows the two file names `courses.csv` and `offerings.csv` (check where the page shows the file names) and *Errors and warnings* lists the handbook warnings with *File*, *Row* and *Column*. The failed run of C.3 is also listed.
6. **C.6 Courses list.** **Courses**: `ACC-CSV-1` and `ACC-CSV-2`, source *CSV upload*, status *Published*, one offering each; Completeness *1 missing* or more (a badge, not a tick) for both, with `ACC-CSV-1` missing only *Instructors* and the contact if the organization has none.
7. **C.7 Public catalogue.** After at most 5 minutes (cache), an anonymous visitor finds both courses at `https://lspurv.urv.cat/en/courses` by searching their titles; the cards show the university name with its logo (decorative).
8. **C.8 Second upload.** Upload the same two files again. The result is *Upload processed*; the new run shows 0 created, 0 updated, 2 or more *unchanged* (all rows) and the same warnings. The upload counter limit is 10 per hour: do not exceed it.
9. **C.9 Alliance view.** AA1 opens **Network status**: the university's row shows channel *CSV upload* and a *Last run* with counters; and **Sync history** for the university (`?org=`) shows the same runs.

**Expected result:** as in each step. **Evidence:** C.2 and C.3 reports; C.4 result; C.5 run page; C.7 public search result; C.8 counters.

| Date | Executor | Result | Notes / defect ids |
|---|---|---|---|
| | | | |

### 3.4 D. Channel C, web form

**Role:** PA. **Preconditions:** B passed. A JPEG or PNG of at most 5 MB, landscape, at least 1600 pixels wide, with no identifiable people and rights held by the tester (a picture of the campus will do); the text `Photo: URV, test image` as credit.

1. **D.1 Create as draft.** **Courses** > **New course**. Step **Basics**: course code `ACC-WEB-1`, type *Course*, level *Master*, ECTS `6`, ISCED code with one marked *Primary*, a functional contact e-mail; leave *Instructors* empty. **Next** (the step is checked before you move on: try it once with the course code empty and see the error summary at the top). Step **Texts**: English title, abstract, description only; **Add a language** `ca` with a title. Step **Attributes**: one hub, two SDGs, *Yes* for *Free course*, leave another yes/no *Not set*. Step **Review and status**: choose **Draft**, **Create course**; the page confirms *Course ACC-WEB-1 created.*
2. **D.2 Completeness.** The *Completeness* card lists the missing fields (at least *Learning outcomes (English)*, *Requirements: prerequisites (English)*, *Assessment (English)*, *Instructors*, *A published offering*); the course list shows a *N missing* badge. The *Image* card now exists. The course is not in the public catalogue (a search for its title finds nothing).
3. **D.3 Offerings.** On the course page, under *Offerings*, **Add offering**: code `2027S`, dates as above, English, delivery mode online, 30 seats maximum, a *How to apply* text, status **Published**, **Save offering** (*Offering saved.*). Add a second offering `2027F` with later dates, status **Draft**.
4. **D.4 Complete it.** Fill what the card listed (learning outcomes, prerequisites, assessment, and one instructor name exactly as the university publishes it, or a role such as *Course team, Faculty of X*), **Save** (*Course saved.*): the card reads *Complete* and the text *Every field the Aurora catalogue requires for publication is filled in.*
5. **D.5 Publish.** Use the status box *Summary and status*: **Publish**, confirm. The status reads *Published*. After at most 5 minutes the public course page `https://lspurv.urv.cat/en/courses/<id>` exists, with the key facts, one offering (the draft one is hidden) and the Catalan text tab.
6. **D.6 Image.** In the *Image* card choose the image file, leave *Alternative text (English)* empty and choose **Upload image**: the upload is refused because alternative text is required unless *Decorative image* is ticked (check the exact message). Fill the alternative text, the credit, **Upload image**; the card shows *Image uploaded.* with the image, size, source *Uploaded file* and the date. Public page: the image appears above *About this course*, with the alternative text and the credit (*Image: Photo: URV, test image*).
7. **D.7 Edit.** Change the English title (add the word `edited`), **Save**; **Save text** on the image with a changed alternative text (*Image text saved.*). Public page shows both after the cache time.
8. **D.8 Offering status.** Open offering `2027S` and choose **Cancel**, confirm: the public page shows it with the badge *Cancelled*, without seats or the apply button. Choose **Publish** again: normal display.
9. **D.9 Withdraw and restore.** On the course page choose **Withdraw**, confirm: status *Withdrawn*; the search no longer finds it and the course page answers *Page not found* (HTTP 404) after the cache time. Choose **Publish**: it is back. While the course is published, the page offers no **Delete** and says why in its place.
10. **D.10 History.** At the end of the course page, **History** lists, newest first, the admin changes with *By* (account id), *Type* *Admin change* and the actions: created, updated, status changes, the image set and text changes, in the order performed. Open **Sync history**: each form save is a run with channel *Web form*, trigger *Form*.

**Expected result:** as in each step. **Evidence:** D.2 completeness; D.4 *Complete*; D.5 and D.6 public pages; D.8 cancelled badge; D.9 404; D.10 history.

| Date | Executor | Result | Notes / defect ids |
|---|---|---|---|
| | | | |

### 3.5 E. Overrides on harvested records (deferred)

**Role:** PA of a harvested university. **Status: deferred.** The override screens (*Harvested record* banner, *Source value (partner's OEAPI): ...*, **Override**, **Save overrides**, *Status override*, **Revert status to the partner's value**) need a harvested record, and no partner has an OEAPI endpoint ready. No steps are written here on purpose: they will be added when the first partner is harvested, from [partner manual, section 12](../manuals/partner-admin.md#12-harvested-courses-overrides) and the [web form guide](../guides/web-form.md#overrides-mode-harvested-organizations).

| Date | Executor | Result | Notes / defect ids |
|---|---|---|---|
| | | `deferred` | No harvest available |

### 3.6 F. Public portal and public APIs

**Role:** OBS (anonymous, private browser window, never signed in on this profile). **Preconditions:** C and D passed, five minutes elapsed since the last change (public caches: 60 s for search, 300 s for course pages).

1. **F.1 Home.** `https://lspurv.urv.cat/` redirects to `/en`. The page *Find a course* shows the search box, *Browse N courses with upcoming offerings* (N at least 13 plus the published test courses), *Browse by field of study* and *Browse by university*, with the alliance logo and the header image if branding is installed. The university logo of the chosen partner shows next to its name.
2. **F.2 Search.** Search a word of a loaded course title (for example `Spark`); suggestions appear while typing; **Search** shows *N courses found* in `/en/courses`; searching a word that matches nothing shows *No courses match your search.* with *Remove all filters*.
3. **F.3 Filters.** In `/en/courses`, tick filters one by one and watch the result count: *University* (the counts match the loaded data: `uice` 5, `ude` 3, `vua` 2, `upec` 2, `up` 1, plus the test courses of the chosen one), *Delivery mode*, *Teaching language*, *Field of study*, *Level*, and the educational hub (its label is the attribute's name in *Course features* or its own group: check the exact label). A filter chip appears for each, removable. **Sort by** *Title (A-Z)* and *Next start date* change the order.
4. **F.4 Course page.** Open a loaded course (for example one of `uice`) and the web-form test course. Check: *Key facts* (ECTS credits, Level, Teaching languages, Delivery mode, Next offering, Application deadline, Course code, Contact, Last updated; *Instructors* only when filled), *About this course* with *Summary* and the texts that were supplied, the offerings with *Dates*, *Application period*, *Application deadline*, *Time zone*, *How to apply*, and the university name with logo. The loaded courses show no instructors, as agreed. *Last updated* is the date of the last change (today's date for the test courses; the upload date for the loaded ones).
5. **F.5 Language.** On the web-form test course the *Language of the course description* tabs offer English and Catalan; `?text_lang=ca` shows the Catalan title; texts that Catalan lacks are not translated or invented. The rest of the page stays in English.
6. **F.6 Page source.** `view-source:` of the course page: `<html lang="en">`, a `rel="canonical"` link with the `https://lspurv.urv.cat/en/courses/<id>` address, `rel="alternate"` `hreflang` links (check which values are present; English only is expected) and no `noindex`.
7. **F.7 Public API.** `curl -s 'https://lspurv.urv.cat/api/public/v1/courses?pageSize=50&upcoming=false'` answers 200 with `items`, `page`, `page_size`, `total`, `facets`; `total` equals the number of published courses (13 plus the test ones). A course `GET /api/public/v1/courses/<id>` shows `texts`, `offerings`, `updated_at` and, for the test course, `image` and `instructors`. A made-up id answers 404.
8. **F.8 OEAPI.** `curl -s -i 'https://lspurv.urv.cat/oeapi/v5/courses?pageSize=50'` answers 200 with the OEAPI v5 collection envelope. The set of courses (count and titles of three of them) matches F.7: the same published courses, with the same titles, ECTS and, for one course, the same offering dates. Differences, if any (for example courses without a current offering), are explained in *Notes*.
9. **F.9 OpenAPI viewer.** `https://lspurv.urv.cat/api/public/v1/docs` renders the API description in the browser (no external requests: the page works with the browser's network tab showing only `lspurv.urv.cat`); `https://lspurv.urv.cat/api/public/v1/openapi.json` returns JSON with `"openapi": "3.1..."`. `/oeapi/v5/` answers 200; OACC publishes no viewer for OEAPI.
10. **F.10 No cookies.** In a fresh private window, open `/en`, `/en/courses` and a course page with the developer tools open (*Application* > *Cookies*): none for `lspurv.urv.cat`. `curl -s -I https://lspurv.urv.cat/en | grep -i set-cookie` prints nothing; the same for `/api/public/v1/courses` and `/oeapi/v5/courses`.
11. **F.11 Withdrawn and draft stay hidden.** The draft course `ACC-WEB-1` created in D.1 was not visible before D.5; the withdrawn state of D.9 gave 404 in both the page and `GET /api/public/v1/courses/<id>`. Record the evidence already collected in D.

**Expected result:** as in each step. **Evidence:** F.1 home; F.3 filtered list; F.4 both course pages; F.6 source excerpt; F.7 and F.8 outputs (`.json`); F.9 viewer; F.10 cookies panel.

| Date | Executor | Result | Notes / defect ids |
|---|---|---|---|
| | | | |

### 3.7 G. Revocation and lifecycle

**Role:** AA1, PA, PA2. **Preconditions:** B passed; PA2's mailbox and authenticator app ready; PA2's address has never been invited.

1. **G.1 Revoke.** PA is signed in and working in **Courses**. AA1 opens **Organizations** > the university > **Administrators** > **Remove** next to PA, confirms. The page shows *<name> is no longer an administrator of this organization.* On AA1's own row the panel says *You cannot remove yourself: ask another alliance administrator.*
2. **G.2 Next request fails.** In PA's open session, reload the page or choose any module: the page shows *Your session has expired. Sign in again.* or *Your account has no administration role.* (record which; an access token already issued works for up to 5 minutes). After signing in again PA sees *Your account has no administration role yet. If you received an invitation, open the link in that e-mail.* and no modules. The course data of the university are unchanged.
3. **G.3 Re-invite.** AA1 invites PA's address again (**Invitations**, *Partner administrator*, **3 days**). Record what PA receives: whether a new set-up e-mail arrives or only the OACC invitation *(check; both are acceptable if PA can sign in)*, and any message such as *The login service reported a conflict with an existing account.* PA opens the link, signs in and sees *Invitation accepted*, then signs in again and has the modules back.
4. **G.4 Pending set-up.** AA1 invites PA2 as *Partner administrator* of the same university, **1 day**. PA2 does **not** open any e-mail. In **Administrators** the row of PA2 shows *Account* *Set-up pending: set a password, set up a one-time code app* and the action **Resend set-up e-mail**. Choose it and confirm (*Resend the set-up e-mail?*): the page shows *A new set-up e-mail was sent to <e-mail>.* and PA2 receives a new e-mail. The **Resend set-up e-mail** button does not appear for PA (active account).
5. **G.5 Resend and revoke invitations.** In **Invitations** the invitation of PA2 is *Pending*. Choose **Resend**, confirm: *A new invitation was sent to <e-mail>. The link is valid until <date>.* The first link now says *This invitation is not valid: it does not exist, was revoked or was already accepted.* Choose **Revoke** on the new one, confirm: status *Revoked*, and its link gives the same message.
6. **G.6 Expired invitation (next day).** AA1 invites PA2 again with **1 day**. Do not open the link. After the validity (at least 24 hours later, on the day after) PA2 opens the link: the page says *This invitation has expired. Ask an alliance administrator to send you a new one.*; the invitation is listed as *Expired*. AA1 uses **Resend**; the new link works. If the plan must finish earlier, mark G.6 `pending` and complete it later.
7. **G.7 Wrong account.** PA2 opens a fresh invitation link and signs in with a different account (for example AA2): the page explains *This invitation was issued for another account.* with instructions to sign out and sign in with the invited address.
8. **G.8 Clean state.** PA2 accepts a valid invitation (or AA1 removes PA2 and revokes the open invitation); at the end of the plan only the people who will really administer remain.

**Expected result:** as in each step. **Evidence:** G.1 confirmation; G.2 message; G.3 e-mails; G.4 panel with the pending account and the confirmation; G.5 messages; G.6 message.

| Date | Executor | Result | Notes / defect ids |
|---|---|---|---|
| | | | |

### 3.8 H. Operations

**Role:** OP, with AA1 for the *Maintenance* page. Commands run in `deploy/compose` on the production host. **Preconditions:** profiles `backup` and `observability` active; Grafana and Alertmanager reachable through `ssh -N -L 3001:127.0.0.1:3001 -L 9093:127.0.0.1:9093 <operator>@<host>` ([Guide E, 2.10](../onboarding/hosting-operator.md#210-alerting-and-logs)).

1. **H.1 Maintenance page.** AA1 opens **Maintenance** (`/en/admin/maintenance`). The *Dry run* notice says that *Dormancy* and *Account clean-up* are in dry run (with the date of their latest run). The six cards are present with their schedule: *History partitions* (00:10 UTC), *IdP metadata refresh* (04:15), *CSV upload retention* (04:30), *Retention* (04:45), *Dormancy* (05:00), *Account clean-up* (05:15). The latest run of each job is *Succeeded* (the first day after the deployment, jobs that have not yet run say so: record it). Filter *Runs* by *Dormancy*, **Show details** of the latest: the notice *Dry run: nothing was changed ...* and the list (empty is expected before 180 days).
2. **H.2 On-demand run.** Choose **Run now** on *History partitions*: *History partitions: run queued. It appears in the runs below once the worker starts it.* After a few seconds a run with trigger *Run now* and status *Succeeded* appears in *Runs*; **Show details** names who requested it.
3. **H.3 Test alert.** OP sends the delivery test: `docker compose --profile observability exec alertmanager amtool --alertmanager.url=http://127.0.0.1:9093 alert add OecpTestAlert severity=warning component=monitoring`. The mail `FIRING:1 OecpTestAlert (warning)` reaches the alert mailbox within a few minutes. Check that no other alert is firing that OP cannot explain ([runbook, section 7](runbook.md#7-monitoring-and-alerts)).
4. **H.4 Backups.** `docker compose exec backup pgbackrest --stanza=oecp info` lists last night's backup (a full on Sunday, a differential the other days, 02:00 UTC) with status `ok` and the WAL archive range up to now; `docker compose logs --since 24h backup | grep -E 'ERROR|WARN'` prints nothing; `docker compose exec postgres psql -U postgres -c 'SELECT last_archived_wal, last_failed_wal FROM pg_stat_archiver'` shows `last_archived_wal` advancing and no recent failure; `OECP_WAL_ARCHIVE=on`.
5. **H.5 Restore drill.** Outside peak hours: `scripts/restore-drill.sh | tee "drill-$(date -u +%F).txt"`. It ends with PASS and exit status 0; record the backup set, restore and recovery times. File the report where [runbook section 4](runbook.md#4-restore-drill) says. (The drill touches a scratch container, not production.)
6. **H.6 Grafana.** The dashboards *OECP overview* and *OECP logs* open and show current data: api and worker *up* and *ready*, backup ages, last WAL archived, no firing alerts, the *Certificates* row with the days left for the TLS certificate of the portal (not Traefik's self-generated one); *OECP logs* shows recent lines for every service.
7. **H.7 Smoke test.** The production form of the [Compose README smoke test](../../deploy/compose/README.md#smoke-test) ([Guide E, 2.8](../onboarding/hosting-operator.md#28-smoke-test)), without `-k`:
   ```sh
   PORTAL=lspurv.urv.cat AUTH=auth.lspurv.urv.cat
   curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://$PORTAL/"     # 302 -> /en
   curl -s "https://$PORTAL/en" | grep -o '<html[^>]*>'                           # lang="en", no Set-Cookie
   curl -s -i "https://$PORTAL/oeapi/v5/courses?pageSize=1" | head -1             # 200, OEAPI v5 envelope
   curl -s -i "https://$PORTAL/api/admin/v1/me" | grep -i www-authenticate        # 401, WWW-Authenticate: Bearer
   curl -s "https://$AUTH/realms/oecp/.well-known/openid-configuration" | grep -o '"issuer":"[^"]*"'
   ```
   The issuer is exactly `https://auth.lspurv.urv.cat/realms/oecp`. From outside the allowlist, `https://auth.lspurv.urv.cat/admin/` answers 403.
8. **H.8 Worker.** `docker compose ps` shows the worker *healthy*; the worker's `/health` lists the scheduled jobs with their next run ([Guide A, step 9](../onboarding/alliance.md#9-operate)).

**Expected result:** as in each step. **Evidence:** H.1 and H.2 screenshots; H.3 the e-mail (`.eml`); H.4 terminal output; H.5 the drill report file; H.6 screenshots; H.7 output.

| Date | Executor | Result | Notes / defect ids |
|---|---|---|---|
| | | | |

### 3.9 I. Accessibility and language

**Role:** PA or AA1 for the keyboard pass; a person with the tool for the screen-reader session. Reference: the [accessibility audit, section 5 and 7](accessibility-audit-2026-10.md). Use a desktop browser, no mouse.

1. **I.1 Keyboard, sign-in.** From `https://lspurv.urv.cat/en/admin` with Tab, Shift+Tab, Enter and Space only: the first Tab stop is *Skip to main content*; **Sign in** is reachable; on the login pages (e-mail, password, one-time code) every field and button is reachable, labelled and operable, and an error (wrong code) is announced on screen. The focus is always visible (a thick outline) and never lost.
2. **I.2 Keyboard, dashboard.** On the dashboard every module is reachable in reading order; the **Organization** list (alliance administrator) works with the arrow keys; **Sign out** is reachable.
3. **I.3 Keyboard, wizard.** In **Courses** > **New course**, step **Basics**: leave the course code empty and choose **Next** with Enter: focus moves to the error summary listing the problems; each link in it moves focus to its field, which is marked invalid; fill the field, **Next** moves to *Step 2 of 4: Texts* and focus lands on its heading. Language tabs of the Texts step work with the arrow keys. A confirmation dialog (for example **Withdraw** on a test course) puts focus on the safe button, Tab stays inside, Escape closes it. Do not save.
4. **I.4 Catalogue.** In `/en/courses`, a filter ticked with Space applies in place and the result count is announced (check with the screen reader if present); a filter chip removed with Enter moves focus to the results heading.
5. **I.5 Zoom 400 %.** In a desktop browser at 1280 px wide, zoom to 400 % (320 CSS px). Home, catalogue, a course page, the dashboard and wizard step 1: no horizontal scrolling of the page (wide tables scroll inside their own region), no text or control hidden or overlapping, all functions reachable. Repeat at 200 %.
6. **I.6 Screen-reader session.** Run the ten steps of [audit section 7](accessibility-audit-2026-10.md#7-what-remains-for-a-human-assistive-technology-session) with at least one screen reader (record name, version and browser: NVDA or JAWS on Windows, VoiceOver on macOS or iOS); record what was heard per step. May be marked `pending`; then the Foundation records that go-live proceeds with the known limitations of the [accessibility statement](accessibility-statement.md).
7. **I.7 Language.** Every page has `<html lang="en">`; the administration panel and the portal are English only, as announced; texts in other languages of a course (Catalan tab of D.1) are marked with their own `lang`.

**Expected result:** as in each step. **Evidence:** I.3 error summary; I.5 screenshots at 400 %; I.6 the session notes.

| Date | Executor | Result | Notes / defect ids |
|---|---|---|---|
| | | | |

### 3.10 Closing the test data

After all scenarios (OP and PA, with AA1 watching): withdraw `ACC-CSV-1`, `ACC-CSV-2` and `ACC-WEB-1` (**Withdraw**), then delete them (**Delete**, offered for withdrawn records in write mode). Check that the public search no longer finds them. Check that PA2 and any other account that will not administer are removed, and no invitation remains *Pending*. Restore the organization data changed in A.4. Remove the test files from laptops. Record in *Notes* anything that could not be removed.

| Date | Executor | Result | Notes |
|---|---|---|---|
| | | | |

## 4. Defect log and sign-off

### 4.1 Defect log

| Id | Scenario / step | Severity | Description (what was done, what was expected, what happened) | Status (open, fixed in, accepted) |
|---|---|---|---|---|
| D-01 | | | | |
| D-02 | | | | |
| D-03 | | | | |

### 4.2 Summary of results

| Scenario | Result | Date of the passing run |
|---|---|---|
| A. Alliance administration | | |
| B. Partner administrator onboarding | | |
| C. Channel B, CSV upload | | |
| D. Channel C, web form | | |
| E. Overrides on harvested records | deferred | |
| F. Public portal and APIs | | |
| G. Revocation and lifecycle | | |
| H. Operations | | |
| I. Accessibility and language | | |

Open defects at sign-off: blockers `__`, majors `__`, minors `__`. Accepted risks and `pending` items (with owner and date): `[TO COMPLETE]`.

### 4.3 Sign-off

The undersigned confirm that they performed or witnessed the scenarios marked with their role, and that the results above are correct. Release 0.11.0 is accepted for the Aurora pilot: yes / yes with the accepted risks listed above / no.

| Role | Name | Organization | Date | Signature |
|---|---|---|---|---|
| Alliance administrator (AA1) | | Aurora Foundation | | |
| Second alliance administrator (AA2) | | | | |
| Partner administrator (PA) | | | | |
| Hosting operator (OP) | | URV | | |
| Accepted on behalf of the Foundation | | Aurora Foundation | | |
