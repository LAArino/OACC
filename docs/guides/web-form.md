<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Web form: the course wizard and offerings

For partner administrators who maintain courses by hand (Channel C, spec §6.4), and for administrators of harvested organizations who correct or complete harvested data with overrides. Getting an account (invitation, password and TOTP) is covered by the onboarding guide [D. Partner without integration capacity](../onboarding/partner-manual.md); the shared data rules are in the [guides README](README.md#common-data-quality-rules).

The admin console lives at `/{locale}/admin` (English only in 0.2.0). An `alliance_admin` first picks the organization (kept in `?org=`); a `partner_admin` works on their own organization and its sub-units. The session is kept in memory: reloading the page restores it while your login session is alive (30 minutes idle, 8 hours at most), but **unsaved changes are lost**.

## Two modes

The mode follows the organization's authoritative channel (`GET …/reference` returns it as `form_mode`):

| Authoritative channel | Mode | What the form does |
|---|---|---|
| `form`, `csv` or none | `write` | Create, edit (full replace), change status and delete courses and offerings. CSV uploads write the same records. |
| `oeapi` | `overrides` | Records come from the harvester. The form cannot create or delete; it stores **overrides** on harvested fields and status. |

## Courses list

**Courses** lists every course of the organization, any status, with filters for text (code or any title), status, type and source channel, 25 per page. Each row shows code, title (English, else the first language), status, source, ECTS, offerings, last update and whether overrides exist. **New course** opens the wizard (write mode only).

## The course wizard

Four steps. A new course is filled in order and each step is checked before **Next**; an existing course opens on any step and can be saved from any of them. Server errors are mapped back to their fields and listed in an error summary at the top.

**1. Basics**

| Field | Rules |
|---|---|
| Course code | Your own code, `^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$`. **Cannot be changed later.** |
| Type of course | `Course`, `Blended Intensive Programme (BIP)`, `Lecture series`, `Other` |
| Levels | At least one of short cycle, bachelor, master, doctoral, other; the first ticked is the primary level |
| ECTS credits | > 0, ≤ 120, up to 2 decimals with a dot |
| Teaching hours | optional, > 0, 1 decimal |
| ISCED-F fields of study | 1 to 10 codes of 2–6 digits with a known broad field (shown next to the code); mark one as primary |
| Teaching unit | optional; a sub-unit of your organization that has a code |
| Information page, Contact e-mail | optional; `https://` only; e-mail address |

**2. Texts.** One tab per language; English is always present and its title is required by the form. Add languages from the 29 EU/EEA languages offered. Per language: title (required for that language, ≤ 500), abstract (shown on course cards, first 300 characters), description, learning outcomes, prerequisites, assessment (each ≤ 20,000) and keywords (separated by commas or new lines, ≤ 50 of ≤ 100 characters). A language whose fields are all empty is not sent; on save, **languages you removed are deleted**, except English.

**3. Attributes.** One control per alliance attribute definition: a checkbox group for `multi_enum` (Aurora: educational hub, SDGs, target audience), a list for `enum` (competence framework, with "Not set"), a checkbox for `boolean` (micro-credential, free course, enrolled only, open to the alliance; ticked stores `true`, unticked leaves it unset, keeping an explicit `false` that came from CSV), a text field for `text` (≤ 500).

**4. Review and status.** A summary of everything entered, then the status: **Draft** (not shown in the public catalogue) or **Published** (requires the English title). A new course starts as draft. For an existing course that is withdrawn or cancelled the choice stays empty and saving keeps that status; use the status actions to change it. **Create course** sends `POST`, **Save** sends `PUT` (a full replace of the record).

## Offerings

The course page lists its offerings; **Add offering** (write mode) opens the offering form, which has five sections:

| Section | Fields |
|---|---|
| Offering | Offering code (cannot be changed later, unique within the course), status (draft or published on save), academic session: one from the list, none, or "Other session code…" (an unknown code creates a minimal session: type `period`, name = code, the offering's dates) |
| Dates | Start and end date, application period start, application deadline (inclusive), time zone (organization default first; dates are local to it) |
| Teaching | Teaching languages (from the 29 form languages) and delivery modes (the deployment's active modes), at least one each; campus (≤ 200) |
| Seats | Maximum students (empty = no limit), seats reserved for the alliance, seats available now; neither may exceed the maximum. Saving a "seats available" figure records the date shown as "as of" in the portal. |
| How to apply | Application page (`https://`) and application instructions per language (≤ 20,000), e.g. a nomination by the home university |

Date rules: end ≥ start, deadline ≤ end, application period start ≤ deadline.

## Status actions

Course and offering pages show the current status and the actions available from it; each asks for confirmation.

| Current status | Actions offered |
|---|---|
| Draft | Publish, Cancel |
| Published | Withdraw, Cancel, Back to draft |
| Withdrawn | Publish, Back to draft |
| Cancelled | Publish, Back to draft |

What each state means for the public portal:

| Status | Course | Offering |
|---|---|---|
| Draft | hidden | hidden |
| Published | listed and searchable; the default search shows it while it has a published offering that has not ended; its page stays reachable | shown on the course page (past ones included); counts for "upcoming" |
| Withdrawn | hidden, offerings included | hidden |
| Cancelled | hidden (use Withdraw for courses) | shown with a "cancelled" badge until it starts, without seats or the apply button |

An offering is only visible when its course is published. **Delete** (write mode) appears for courses and offerings that are not published; it is a soft delete, refused for harvested records and for a course that still has published offerings. Re-creating a deleted code in the wizard brings the record back without its old overrides.

## Overrides mode (harvested organizations)

When the organization is harvested from its OEAPI endpoint, course and offering pages show a banner and every overridable field shows its **source value** ("Source value (partner's OEAPI): …") with an **Override** checkbox:

- Tick **Override** to enable the control and enter your value; the field is marked "Overridden".
- Untick a saved override to **revert**: on save the field returns to the source value at once.
- The review step lists the pending changes ("Override *field*: *value*", "Revert *field* to the source value"); **Save overrides** sends only those, as one `PATCH …/overrides` with `set` and `clear`.
- The status actions store a **`status` override**. It wins over the harvested status and over withdrawal by absence, so "Withdraw" is the immediate way to take a harvested course down. The console cannot remove a status override; use the API (`"clear": ["status"]`).

Overridable: course type, levels, ECTS, teaching hours, information page, contact e-mail, attributes (as one value), ISCED codes and every text field per language (adding a title in a new language adds that language until the title override is cleared); offering dates, time zone, teaching languages, delivery modes, campus, seat figures, application page and instructions.

**What survives a harvest.** Every override. The harvester compares payloads before overrides are applied, keeps writing the latest source value next to each override (that is the value displayed and restored when you revert) and never removes an override. Partners cannot send course types or alliance attributes through OEAPI, so overrides are the way to add them to harvested courses. If the organization later switches to `form` or `csv`, the first save of a record in the wizard drops its leftover overrides; CSV uploads do not.

## What cannot be edited, and why

| Item | Why |
|---|---|
| Course and offering codes | They are the natural key that CSV rows and harvests match on (`oecp.content.ext_id_immutable`). |
| Anything in a harvested organization except overrides | The partner's system is the source; creating or deleting there would be undone by the next harvest (`oecp.sync.channel_disabled`). |
| Teaching unit and academic session of harvested records | Not overridable ("change it in the partner's system"). |
| EQF level | Not in the wizard. A form save keeps the stored value, or derives it from the primary level (short cycle 5, bachelor 6, master 7, doctoral 8) when none is stored; CSV can set it explicitly (`eqf_level`). |
| "Seats as of" date | Stamped automatically when the seat figure is saved. |
| Withdrawn and cancelled in the wizard | Only through the status actions. |
| Published records, harvested records | Cannot be deleted: withdraw or cancel instead. |

## History

The course page ends with **History**: the latest 50 changes of the course and its offerings, newest first, with when, by whom (the administrator's account id, or `system:harvester`), type, action and a one-line summary. "Admin change" entries come from the audit log (created, updated with the changed fields, status from → to, overrides set or removed, deleted, withdrawn after N absences, republished when seen again); "Ingestion" entries record each accepted or rejected payload of a channel, only when its content changed. Payload bodies are never shown.

## Admin API equivalents

Base `https://{portal}/api/admin/v1`, JSON, bearer token (spec [§8.2](../spec-v4.1.md#82-admin-api-apiadminv1-implemented), [§8.3](../spec-v4.1.md#83-overrides-api); repository layout and project rules in [§11](../spec-v4.1.md#11-project-and-governance)).

| Screen action | Request |
|---|---|
| Reference lists of the wizard | `GET /organizations/{orgId}/reference` |
| Courses list | `GET /organizations/{orgId}/courses?q&status&kind&source_channel&page&page_size` (≤ 100) |
| Create course | `POST /organizations/{orgId}/courses` → 201 + `Location` |
| Open, save, delete course | `GET`, `PUT`, `DELETE /courses/{id}` (delete 204) |
| Status action | `POST /courses/{id}/status` `{"status": "withdrawn"}` |
| Save overrides | `PATCH /courses/{id}/overrides` `{"set": {…}, "clear": […]}` |
| History | `GET /courses/{id}/history?limit=50` (≤ 200) |
| Add offering | `POST /courses/{id}/offerings` |
| Offering | `GET`, `PUT`, `DELETE /offerings/{id}`, `POST …/status`, `PATCH …/overrides` |

```sh
API=https://portal.example.org/api/admin/v1
curl -sS -X POST "$API/organizations/$ORG/courses" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
  "ext_id": "DS-101", "status": "draft", "kind": "course", "levels": ["master"],
  "ects": 6, "teaching_hours": 45, "info_url": "https://www.example.org/courses/ds-101",
  "isced_codes": [{"code": "0612", "is_primary": true}, {"code": "0541"}],
  "attributes": {"sdg": ["sdg04"], "open_to_alliance": true},
  "texts": {"en": {"title": "Data Science for Society", "keywords": ["data", "society"]},
            "ca": {"title": "Ciència de dades per a la societat"}}}'
curl -sS -X POST "$API/courses/$COURSE/offerings" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
  "ext_offering_id": "2027S", "academic_session_ext_id": "2026-27-S2",
  "start_date": "2027-02-15", "end_date": "2027-06-15", "application_deadline": "2027-01-15",
  "teaching_languages": ["en"], "delivery_modes": ["online"], "max_students": 30,
  "alliance_seats": 10, "application_instructions": {"en": "Apply through your home university."}}'
curl -sS -X PATCH "$API/courses/$COURSE/overrides" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"set": {"kind": "bip", "texts.en.abstract": "Blended Intensive Programme."}, "clear": ["info_url"]}'
```

Request rules: `status` on create or replace is `draft` or `published` (default `draft`; a replace keeps the current status when omitted); `PUT` is a full replace of the record; codes in the body must match the existing record; `timezone` defaults to the organization's; `seats_available` stamps `seats_updated_at`. Override keys: `status`, `kind`, `levels`, `ects`, `teaching_hours`, `info_url`, `contact_email`, `attributes`, `isced_codes`, `texts.<lang>.<field>` for courses; `status`, the four dates, `timezone`, `teaching_languages`, `delivery_modes`, `campus`, `max_students`, `alliance_seats`, `seats_available`, `application_url`, `application_instructions` for offerings; at least one change, at most 100 keys each, never a key in both `set` and `clear`. Responses carry the effective values plus `overrides`, `override_meta` (`{by, at}`) and `source_values`.

**Bearer tokens.** The API accepts only Keycloak access tokens issued to the `oecp-admin` client with multi-factor authentication (`acr=mfa`); they live 300 seconds. Release 0.2.0 has no API keys or service accounts for administrators, so a script must use a token from an interactive sign-in (for example taken from the `Authorization` header of a console request in the browser's developer tools). Treat it as a password. For bulk changes, prefer [CSV](csv-authoring.md).

### Errors

Problems are `application/problem+json` with `errors[]` items carrying `code` and a JSON `pointer` into your body.

| HTTP | When | Codes |
|---|---|---|
| 400 | Body shape and field rules | `oecp.request.validation_failed` with items such as `oecp.content.english_missing` (publishing without `texts.en`), `invalid_code`, `unsupported_language` (not one of the 29), `duplicate_isced`, `unknown_isced_field`, `date_order`, `seats_exceed_capacity`, `invalid_value`, `override_not_allowed` (unknown override key) |
| 422 | Checks against the database and the resulting record | `oecp.content.unknown_isced_field`, `unknown_teaching_unit`, `unknown_delivery_mode`, `unknown_attribute`, `invalid_attribute_value`, `unknown_attribute_option`, `english_missing` (status action), `date_order` (after overrides), `unsupported_language`, `invalid_value` |
| 409 | State conflicts | `oecp.sync.channel_disabled` (create, replace or delete in overrides mode), `oecp.content.override_not_allowed` (overrides in write mode), `duplicate_ext_id`, `ext_id_immutable`, `has_published_offerings`, `published_not_deletable`, `harvested_not_deletable` |
| 404, 403, 401 | Unknown record; organization outside your scope; missing or expired token, MFA missing | `oecp.request.not_found`, `oecp.auth.forbidden_organization`, `oecp.auth.missing_token`, `invalid_token`, `insufficient_acr` |

Every successful save is one sync run (`form`, schema `form-1`) and one audit entry; a refused save writes nothing.
