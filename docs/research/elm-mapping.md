<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# OACC and the European Learning Model (ELM / Europass / QDR): mapping, gaps and QDR coverage

Research date: 2026-10-23 (backlog item "Europass / Qualifications Dataset Register alignment", [backlog](../backlog.md), Discussion #5). Evidence tags: **[LIVE]** verified by a live call or a downloaded file, **[DOC]** taken from a published document, **[INF]** inference of this study, **[UNV]** could not be verified. Read-only study: no code or schema was changed.

## 1. Summary

1. **Fit: good for a course catalogue, with one structural twist.** OACC course = ELM `LearningAchievementSpecification` (LAS, what is learnt); OACC offering = ELM `LearningOpportunity` (LO, when/where/how, exactly one LAS each); university = `Organisation`; alliance = `Group` [INF from DOC].
2. **LOQ 3.3.1 is enough for a first export.** An LO does not need a Qualification; since 3.3.1 a LAS needs learning outcomes *or* a learning-outcome summary [DOC]. Mandatory fields are reachable from OACC data, three with fallbacks (LO homepage, organisation address, outcomes as one summary note).
3. **Mapping size:** of 66 rows in §4, 11 exact, 29 transform, 16 partial, 10 none (internal bookkeeping, seats, enrolment start, instructors, privacy notice, eligibility flags).
4. **Missing in ELM:** seats and capacity, enrolment opening, time zone, instructors, per-course contact, alliance attributes (only partly), joint offer. **Missing in OACC:** learning setting (formal / non-formal), awarding body, structured learning outcomes, EQF on a non-qualification, assessment type, price and currency, quality assurance.
5. **QDR import is not useful for these nine countries.** Universities appear only as *degree programmes* (AT, IS, FR) or only in accreditation records (DE, NL, CZ); ES, IT, DK have no dataset; no course-level or micro-credential entries (§7).
6. **Recommendation:** no import channel; build the export as a thin, validated serialiser (effort S for a spike, M to publish), design it now on 3.3.1, and take no canonical-model decision before DG EMPL answers (§9) and the ELM 3.4 draft exists.
7. **Depends on ELM 3.4** (planned early 2027, from a DG EMPL contact [UNV]; no public trace found): the micro-credential non-formal profile decides learning setting, assessment type, awarding body and quality-assurance fields, i.e. whether an ADR adds them.
8. **Gate before publishing anything:** the QDR rule is "publish only data you own" and each publisher registers with EU Login and signs a publishing agreement [DOC]; an alliance operator publishing for ten universities needs delegation confirmed by DG EMPL.

## 2. Sources consulted

| Source | Version / date | Accessed | How |
|---|---|---|---|
| ELM Browser, LOQ constraints ([3.3.1 documentation](https://europa.eu/europass/elm-browser/documentation/3-3-1/rdf/ap/loq/documentation/loq-constraints_en.html), [MDR vocabularies](https://europa.eu/europass/elm-browser/documentation/3-3-1/rdf/ap/loq/documentation/loq-constraints-mdr_en.html)) | ELM 3.3.1; SHACL v1.3.0, updated 2026-02-03 (3.3.0 page: v1.2.0) | 2026-10-23 | static HTML pages behind the JavaScript browser, read with curl; tables parsed |
| [LOQ SHACL file](http://data.europa.eu/snb/model/application-profile/loq-constraints) (RDF/XML, content negotiation) | v1.2.0 (the dereferenced URI still serves the 3.3.0 file) | 2026-10-23 | downloaded, used for the cardinality check of §6 |
| [LOQ-Diagram_v3.3.pdf](https://code.europa.eu/qualifications-courses-and-credentials/ELM-support), `mapping/MC-Mapping.docx`, EDC micro-credential JSON example | ELM-support project 627, last activity 2026-09-11 | 2026-10-23 | GitLab API; PDF pages 1-3 viewed, text extracted |
| [Europass: ELM in the QDR](https://europass.europa.eu/en/qdr-european-learning-model), [Publish your data](https://europa.eu/europass/en/stakeholders/qdr/publishdata), [Register](https://europa.eu/europass/en/stakeholders/qdr/register) | live pages | 2026-10-23 | curl, text extracted |
| [LOQ schemata 3.3.1 (zip)](https://europass.europa.eu/system/files/2026-02/schemata-LOQ-3.3.1.zip): XSD and sample XML | 3.3.1, 2026-02 | 2026-10-23 | downloaded (31.9 MB), read only |
| ELM vocabularies (`snb/learning-setting`, `learning-opportunity`, `learning-assessment`, `learning-activity`, `learning-schedule`, `target-group`, `education-credit`) | issued 2026-09-23 (target-group 2023-06-28) | 2026-10-23 | `Accept: application/rdf+xml` on the scheme and concept URIs |
| QDR SPARQL endpoint `https://europa.eu/europass/qdr/open-data/sparql` (found in the UI bundle `5.2b32377be068e3ed2770.js`: `endpoint:"/open-data/sparql"`) | live store | 2026-10-23 | GET with `query`; about 10 s limit per query, whole-store aggregates fail |
| QDR DCAT catalogue [`/open-data/dcat`](https://europa.eu/europass/qdr/open-data/dcat) and country ZIPs (AUT, NLD, ISL, CZE: 23.8 MB; LOQ-wide JSON-LD: 0.4 MB) | files dated 2026-10-18 | 2026-10-23 | curl, parsed with rdflib; total downloads about 56 MB |
| EU Vocabularies page [snb-model](https://op.europa.eu/en/web/eu-vocabularies/dataset/-/resource?uri=http://publications.europa.eu/resource/dataset/snb-model) | ELM 3.3.1 LATEST | 2026-10-23 | built-in browser: header read; **Downloads and Release notes tabs did not render** (assets blocked, 403) |
| OACC: `packages/schemas/src/canonical.ts`, `enums.ts`, `attributes.ts`, `media.ts`, `public-responses.ts`; migrations 0001, 0005, 0007, 0008, 0009; [spec v4.1](../spec-v4.1.md) §5, §9; [ADR-0005](../adr/0005-pull-only-oeapi-harvesting-canonical-model.md), [ADR-0012](../adr/0012-alliance-course-attributes-as-validated-jsonb.md); [CSV guide](../guides/csv-authoring.md); [example alliance](../data/example-alliance-2026-27/README.md) | repository at `327e2cd` | 2026-10-23 | read |

## 3. ELM concepts relevant to a course catalogue

- **Three classes describe a course** [DOC, LOQ-Diagram p.2, SHACL]. `LearningOpportunity` (LO): the conditions (time, place, price, deadline, mode, provider) under which a person can learn; carries `providedBy` (1..*), `learningAchievementSpecification` (**1..1**), `learningActivitySpecification` (0..1), `hasPart`/`isPartOf`. `LearningAchievementSpecification` (LAS): what may be learnt: outcomes, ISCED-F, credit points, entry requirement, languages, target group, learning setting. `Qualification` is a **subclass** of LAS that adds EQF level (1..1), NQF level (1..*), awarding and accreditation. `LearningActivitySpecification`: how it is learnt (activity types, mode, contact hours, volume of learning). QDR: "a learning opportunity can, but does not necessarily have to, be linked to a qualification" [DOC].
- **A course with several offerings** = one LAS node referenced by several LO nodes [INF]: the cardinality is 1..1 on the LO side and the LAS has no inverse property. Programmes with modules use `hasPart`/`isPartOf` between LOs.
- **Identifiers**: `adms:identifier` to `Identifier` (`skos:notation` 1..1, `schemeName`, `schemeAgency`) or `LegalIdentifier` (adds `dc:spatial`, for registrations and tax). QDR asks for globally unique, persistent identifiers, URIs under a domain the publisher owns (`http://data.domain.eu/collection/type/key`); other codes get a dataset namespace at publication [DOC].
- **Vocabularies** (authority: Publications Office, EU Vocabularies; `snb/*` schemes owned by DG EMPL) [DOC, LIVE]: languages, countries, currencies, file types are NAL tables (`publications.europa.eu/resource/authority/...`, upper-case ISO 639-3/B and alpha-3 codes); ELM schemes `http://data.europa.eu/snb/<scheme>/25831c2`: `isced-f` (concepts `snb/isced-f/0413`), `eqf` (`snb/eqf/6`), `qdr` (NQF), `education-credit` (ECTS = `6fcec5c5af`), `learning-setting` (formal `6fd4685715`, non-formal `e207a81fc7`), `learning-opportunity` (Course, Class, Short learning programme, Short online course, Programme module, MOOC...), `learning-assessment` used for `mode` (Presential, Online, Hybrid, Blended, Workbased, Project based, Research-Lab based), `learning-activity` (includes since 2026-09-23 "Blended Intensive Programme (BIP)", "Virtual exchange / COIL", "Summer / winter school", "Short course / CPD"), `learning-schedule` (full time, part time), `target-group` (e.g. "Persons in tertiary education (EQF 6/7/8)"). No SDG or micro-credential concept was found in these schemes [LIVE].
- **Namespaces**: from the 3.3 header update (January 2026) `elm:` is `http://data.europa.eu/snb/model/ontology/`; before, `http://data.europa.eu/snb/model/elm/` [DOC]. Both coexist in the QDR store (§7) [LIVE]; an exporter must emit the new one.
- **Formats**: LOQ is published as RDF/XML, Turtle or XML (`loq.xsd`, root `Courses` with `*References` containers) [DOC, LIVE]; JSON Schema exists only for EDC [DOC]. A JSON-LD LOQ context is not published [UNV]; the example in §6 uses an illustrative one.
- **Mandatory in LOQ 3.3.1** [DOC, closed shapes: unknown properties are rejected]: LO `dc:title`, `learningAchievementSpecification` (1..1), `providedBy`, `foaf:homepage`, `defaultLanguage`; LAS `dc:title`, `ISCEDFCode`, `dc:language`, and outcome or summary; Organisation `legalName` and `location` (Location needs `address`, Address needs `countryCode`); Identifier `notation`; CreditPoint `framework` and `point`; Note `noteLiteral`; WebResource `contentUrl`; Amount `unit` and `value`; MediaObject `content`, `contentType`, `contentEncoding`; Group `prefLabel`. Everything else is optional, including all LO scheduling fields; the QDR tolerates missing mandatory data temporarily by agreement with the support team [DOC].
- **Delta 3.3.0 to 3.3.1** (SHACL 1.2.0 to 1.3.0) [LIVE]: `dc:description` becomes an HTML whitelist literal (h1-h6, p, strong/b, em/i, ul, ol, li, br...); `learningOutcome` on LAS/Qualification goes from 1..* to 0..*, with a rule that a LAS has a learning outcome *or* a summary.

## 4. Field-by-field mapping

Cardinalities are LOQ 3.3.1 [DOC]. Fit: **exact** (same meaning and shape), **transform** (same meaning, conversion needed), **partial** (part of the meaning or a free-text carrier), **none**. Concept ids are under `http://data.europa.eu/snb/`.

### Course (`courses`, canonical `course`)

| OACC field | ELM class.property | Card. | Vocabulary / datatype | Fit | Note |
|---|---|---|---|---|---|
| `id` | LAS IRI | - | IRI | transform | mint under the portal base URL; stable across harvests |
| `ext_id` | LAS `adms:identifier` to Identifier | 0..* (notation 1..1) | string, `schemeName` "OACC course code" | transform | `schemeAgency` = university |
| `source_ref`, `source_channel`, `content_hash`, `overrides`, `absent_count`, `last_seen_at`, `created_at`, `deleted_at` | - | - | - | none | internal bookkeeping |
| `status` | export filter; `elm:status` | 0..1 | xsd:string (accreditation-status) | transform | export `published` only; the QDR writes "released" / "Not published anymore" itself [LIVE] |
| `kind` | LO `dc:type`; LearningActivitySpecification `dc:type` | 0..* | `learning-opportunity`, `learning-activity` | partial | course = Course `05053c1cbe`; bip = Short learning programme `74a4a268e8` + activity BIP `c_78e38bae` [INF]; lecture_series = Class `7e1ac538db` [INF]; other = omit |
| `ects` | LAS `elm:creditPoint` to CreditPoint | 0..* (framework 1..1, point 1..1) | `education-credit/6fcec5c5af`, point xsd:string | exact | note: AT publishes framework `60b314e826` (labelled ECVET) with text such as "180 ECTS" [LIVE] |
| `levels[]` / `level` | LAS `elm:targetGroup` (and `elm:educationLevel`) | 0..* | `target-group` EQF 6/7/8 tertiary | partial | bachelor, master, doctoral map; short_cycle and other do not; "primary first" order is lost |
| `eqf_level` | Qualification `elm:EQFLevel` | 1..1, **Qualification only** | `snb/eqf/1-8` | partial | a plain LAS has no EQF property; use `educationLevel` [INF] or the Qualification class (then NQF 1..* is required too) |
| `teaching_hours` | LearningActivitySpecification `elm:contactHour` | 0..* | xsd:string | partial | contact hours, not notional workload (`volumeOfLearning`, xsd:duration) |
| `teaching_unit_ext_id` | LO `providedBy` (second Organisation) with `org:subOrganizationOf` | 1..* / 0..1 | IRI | transform | faculty or department as sub-organisation |
| `info_url` | LO `foaf:homepage` to WebResource | **1..*** | `elm:contentUrl` anyURI | exact | LOQ requires it, OACC does not: fall back to the portal course page |
| `contact_email` | Organisation `elm:contactPoint` to ContactPoint `elm:emailAddress` (Mailbox) | 0..* | `mailto:` IRI | partial | LO has no contact point: per-course contact is lost, university contact survives |
| `isced_codes[]` | LAS `elm:ISCEDFCode` | **1..*** | `snb/isced-f/<2-4 digits>` | transform | 5-6 digit codes cut to 4; primary flag lost (unordered) |
| `instructors[]` | - | - | - | none | LOQ has no teacher or person property; a note would be personal data in free text, not exported by default |
| image (`image_key`, `image_alt`, `image_decorative`, `image_credit`, `image_width/height`) | LO `elm:bannerImage` to MediaObject | 0..1 (content, contentType, contentEncoding 1..1) | base64 string, file-type NAL (`WEBP` exists), encoding concept | transform | inline only, no URL form; use the 640 px file; alt text to `dc:title`, credit to `dc:description` (both 0..*) |

### Course texts (`course_texts`, one row per language)

| OACC field | ELM class.property | Card. | Vocabulary / datatype | Fit | Note |
|---|---|---|---|---|---|
| `lang` | language tag of the langString | - | BCP 47 | exact | OACC primary subtag only |
| `title` | LO `dc:title`; LAS `dc:title` | 1..* | rdf:langString | exact | emitted on both |
| `abstract` | LAS `dc:description` | 0..* | HTML whitelist literal | transform | plain text escaped, wrapped in `<p>` |
| `description` | LO `dc:description` | 0..* | HTML whitelist literal | transform | same |
| `learning_outcomes` | LAS `elm:learningOutcomeSummary` to Note (`noteLiteral`); optional `elm:learningOutcome` to LearningOutcome (`dc:title`) | 0..1 / 0..* (one of the two required) | rdf:langString | transform | one free text: summary always, outcome nodes only if the text is a list; no ESCO skills |
| `prerequisites` | LAS `elm:entryRequirement` to Note | 0..1 | rdf:langString | exact | |
| `assessment` | LAS `elm:provenBy` to LearningAssessmentSpecification | 0..* (title 1..*) | rdf:langString | transform | title synthesised ("Assessment"); no assessment type or grading scheme |
| `mode_of_repetition` | LO `elm:scheduleInformation` to Note | 0..1 | rdf:langString | partial | course-level text on an offering-level property |
| `methods` | LearningActivitySpecification `dc:description` | 0..* | HTML whitelist literal | transform | |
| `literature` | LO `elm:additionalNote` to Note (`dc:subject` "literature") | 0..* | rdf:langString | partial | |
| `privacy_notice` | - | - | - | none | OACC data-protection text; no ELM place |
| `remarks` | LO `elm:additionalNote` | 0..* | rdf:langString | exact | |
| `keywords[]` | LAS `elm:category` | 0..* | rdf:langString | partial | free strings, not a controlled vocabulary |
| `is_machine_translated` | - | - | - | none | |

### Offering (`course_offerings`, canonical `courseOffering`)

| OACC field | ELM class.property | Card. | Vocabulary / datatype | Fit | Note |
|---|---|---|---|---|---|
| `id` | LO IRI | - | IRI | transform | one LO per published offering |
| `ext_offering_id` (+ course code) | LO `adms:identifier` | 0..* | string "course#offering" | transform | the same key OACC uses in its history |
| `status` | export filter | - | - | transform | published offerings; cancelled omitted [INF] |
| `academic_session_ext_id` (+ session name, type, dates) | LO `dc:temporal` to PeriodOfTime `skos:prefLabel` | 0..1 | rdf:langString | partial | label only; session hierarchy lost |
| `start_date`, `end_date` | PeriodOfTime `elm:startDate`, `elm:endDate` | 0..1 | xsd:dateTime | transform | date plus offset of `timezone`; time of day is a convention |
| (derived) | LO `elm:duration` | 0..1 | xsd:duration | transform | from the dates, e.g. P61D |
| `enrol_start_date` | - | - | - | none | no property for enrolment opening |
| `application_deadline` | LO `elm:applicationDeadline` | 0..* | xsd:dateTime | transform | end of day, local offset |
| `timezone` | offset inside the dateTime values | - | - | transform | not stored in ELM |
| `teaching_languages[]` | LO `elm:defaultLanguage` (1..1); LAS `dc:language` (1..*) | 1..1 / 1..* | Language NAL (`.../language/ENG`) | transform | first language is default, all on the LAS; language is an offering attribute in OACC, a specification attribute in ELM; BCP 47 to ISO 639-3/B table needed |
| `delivery_modes[]` | LO `elm:mode` | 0..* | `learning-assessment`: Presential `9191af2ed9`, Online `920fbb3cbe`, Hybrid `c_3a90b26d`, Blended `e92d221e4d` | transform | presential, online, hybrid, blended map 1:1; `coil` = Online plus activity "Virtual exchange / COIL" `c_1951b644`; `joint_delivery` has no mode |
| `campus` | LO `elm:location` to Location (`geographicName`, address) | 0..* (address 1..*, country 1..1) | Country NAL alpha-3 | transform | country comes from the organisation, nullable in OACC |
| `max_students`, `alliance_seats`, `seats_available`, `seats_updated_at` | - | - | - | none | no capacity property; volatile data, do not export |
| `application_url` | LO `elm:supplementaryDocument` to WebResource | 0..* | anyURI | partial | no dedicated property; `admissionProcedure` is a Note without URL |
| `application_instructions{lang}` | LO `elm:admissionProcedure` to Note | 0..1 | rdf:langString | exact | |
| (none in OACC) learning schedule | LO `elm:learningSchedule` | 0..1 | `learning-schedule` | none | full / part time not stored |
| (none; attribute `free_course`) | LO `elm:priceDetail` to PriceDetail, Amount | 0..* (unit 1..1, value 1..1) | currency NAL, xsd:decimal | transform | only "free" is known: 0 in an assumed currency |
| `updated_at` | LO `dc:modified` | 0..1 | xsd:dateTime | exact | |

### Organisation (`organizations`), academic session, alliance attributes

| OACC field | ELM class.property | Card. | Vocabulary / datatype | Fit | Note |
|---|---|---|---|---|---|
| `id`, `slug` | Organisation IRI | - | IRI | transform | |
| `name{lang}` | Organisation `rov:legalName` | **1..*** | rdf:langString | partial | OACC stores a display name, not necessarily the legal name |
| `org_type` | Organisation `dc:type`; alliance = Group | 0..* | Concept, no scheme mandated | partial | institution = Organisation, alliance = Group, faculty / department / campus = sub-organisation |
| `parent_id` | `org:subOrganizationOf` | 0..1 | IRI | exact | |
| `is_partner` | `elm:groupMemberOf` to Group (the alliance) | 0..* | Group `skos:prefLabel` 1..* | transform | alliance is expressible in ELM |
| `schac_home_organization` | Organisation `adms:identifier` | 0..* | `schemeName` "SCHAC" | transform | no ELM registry scheme [UNV] |
| `erasmus_code`, `pic` | Organisation `adms:identifier` | 0..* | `schemeName` "Erasmus code" / "PIC" | transform | not LegalIdentifier (that needs a registration country) |
| `country_code` | Organisation `elm:location` to Location, Address `elm:countryCode` | **location 1..***, country 1..1 | alpha-2 to alpha-3 NAL | transform | street address optional (`fullAddress`) |
| `website_url` | Organisation `foaf:homepage` | 0..* | anyURI | exact | |
| `logo_url` | Organisation `elm:logo` to MediaObject | 0..1 | inline base64 | transform | |
| `contact_email` | ContactPoint `elm:emailAddress` | 0..* | `mailto:` IRI | exact | |
| `default_timezone`, `ui_languages`, `keycloak_idp_alias`, `ext_id`, `partner_id` | - | - | - | none | internal |
| `attributes.educational_hub` | `elm:category` | 0..* | rdf:langString | partial | no hub concept |
| `attributes.sdg` | `elm:category` / Note | 0..* | - | partial | no SDG vocabulary found [LIVE] |
| `attributes.competence_framework` | LearningOutcome `elm:relatedSkill` | 0..* | Concept (own list allowed) | partial | needs structured outcomes |
| `attributes.micro_credential` | - | - | - | none | no concept in 3.3.1 [LIVE]; the 3.4 candidate |
| `attributes.free_course` | PriceDetail | 0..* | see offering | transform | |
| `attributes.enrolled_only`, `open_to_alliance` | LO `elm:admissionProcedure` text | 0..1 | rdf:langString | none | eligibility has no field; text only |
| `attributes.target_audience` | LAS `elm:targetGroup` | 0..* | `target-group` | partial | scheme is level and experience based; no staff roles |

## 5. Gaps both ways

**LOQ needs, OACC lacks or holds weakly**
- **Structured learning outcomes** (`LearningOutcome` nodes, ESCO skills, reusability level): OACC has one free text. QDR guidance wants a summary note plus one node per bullet [DOC].
- **Awarding body and awarding opportunity**: who awards the credits (for a BIP the student's home university) is not stored; the LAS can omit it, a Qualification cannot [INF].
- **Learning setting** (formal / non-formal): not stored; central to the 3.4 profile [UNV].
- **EQF on a non-qualification, NQF, accreditation, quality-assurance type** (DEQAR link): `eqf_level` exists but has no home on a plain LAS.
- **Per-LO homepage** (1..*), **organisation address**, **currency and amount**, **assessment type and grading scheme**, **learning schedule**, **stable URIs**, **credit framework** (implicitly ECTS).
- Language and level are offering- and course-level in OACC but specification-level in ELM; export must merge them.

**OACC holds, ELM cannot express**
- **Seats** (`max_students`, `alliance_seats`, `seats_available`) and `seats_updated_at`; **enrolment opening**; **time zone** (folded into offsets); **instructors** (persons are out of LOQ); **privacy notice**; per-course **contact**.
- **Joint offer**: `providedBy` is 1..* ("several organisations directing the learning opportunity", [DOC]), but OACC stores one organisation per course; `joint_delivery` is only a mode. The alliance as provider is expressible with a `Group` (EDC examples use one) [DOC, INF].
- **Alliance attributes** (hub, SDG, framework, micro-credential, eligibility flags): at best free-text `category` or notes; ADR-0012 attributes stay OACC-only.
- **Course kind** (BIP, lecture series) only through vocabulary concepts and only for BIP and COIL.

## 6. Worked example: BIP "Social Innovation Lab" (Northvale, example alliance)

Source: [`northvale/courses.csv` and `offerings.csv`](../data/example-alliance-2026-27/northvale/courses.csv), course `EXA-NOR-BIP-SOCIAL-LAB`, offering `2026-27`. Hand-written; `.example` URLs are fictional. **Checks run [LIVE]:** it parses as JSON-LD (rdflib, 124 triples) and passes a cardinality and closed-shape check against every LOQ SHACL shape of the file v1.2.0 (a minimal checker, not a SHACL engine; datatypes and vocabulary membership were *not* checked; a deliberately broken copy is rejected). **Not verified:** acceptance by the QDR (publishable forms are Turtle, RDF/XML or XML; JSON-LD is shown for readability), the vocabulary choices marked [INF] in §4, `elm:Group` use, and the 3.3.1 shapes (v1.3.0 not downloadable as RDF). Left out on purpose: `status` (QDR sets it), `bannerImage` (the example has no image), `awardingOpportunity`, `learningSetting`, publisher, instructors, seats and enrolment start (no ELM place).

```json
{
  "@context": {
    "elm": "http://data.europa.eu/snb/model/ontology/", "dc": "http://purl.org/dc/terms/", "adms": "http://www.w3.org/ns/adms#",
    "foaf": "http://xmlns.com/foaf/0.1/", "skos": "http://www.w3.org/2004/02/skos/core#", "rov": "http://www.w3.org/ns/regorg#",
    "org": "http://www.w3.org/ns/org#", "xsd": "http://www.w3.org/2001/XMLSchema#", "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "snb": "http://data.europa.eu/snb/", "auth": "http://publications.europa.eu/resource/authority/",
    "title": {"@id": "dc:title", "@container": "@language"}, "description": {"@id": "dc:description", "@container": "@language"},
    "legalName": {"@id": "rov:legalName", "@container": "@language"}, "prefLabel": {"@id": "skos:prefLabel", "@container": "@language"},
    "noteLiteral": {"@id": "elm:noteLiteral", "@container": "@language"}, "geographicName": {"@id": "elm:geographicName", "@container": "@language"},
    "category": {"@id": "elm:category", "@container": "@language"}, "schemeAgency": {"@id": "adms:schemeAgency", "@container": "@language"},
    "type": {"@id": "dc:type", "@type": "@id"}, "language": {"@id": "dc:language", "@type": "@id"}, "temporal": "dc:temporal",
    "modified": {"@id": "dc:modified", "@type": "xsd:dateTime"}, "identifier": "adms:identifier", "notation": "skos:notation",
    "homepage": "foaf:homepage", "groupMember": {"@id": "foaf:member", "@type": "@id"}, "schemeName": "elm:schemeName",
    "mode": {"@id": "elm:mode", "@type": "@id"}, "defaultLanguage": {"@id": "elm:defaultLanguage", "@type": "@id"},
    "providedBy": {"@id": "elm:providedBy", "@type": "@id"}, "location": "elm:location", "address": "elm:address",
    "countryCode": {"@id": "elm:countryCode", "@type": "@id"},
    "learningAchievementSpecification": {"@id": "elm:learningAchievementSpecification", "@type": "@id"},
    "learningActivitySpecification": {"@id": "elm:learningActivitySpecification", "@type": "@id"},
    "learningOutcome": "elm:learningOutcome", "learningOutcomeSummary": "elm:learningOutcomeSummary", "entryRequirement": "elm:entryRequirement",
    "provenBy": "elm:provenBy", "admissionProcedure": "elm:admissionProcedure", "additionalNote": "elm:additionalNote",
    "supplementaryDocument": "elm:supplementaryDocument", "priceDetail": "elm:priceDetail", "amount": "elm:amount",
    "unit": {"@id": "elm:unit", "@type": "@id"}, "value": {"@id": "rdf:value", "@type": "xsd:decimal"},
    "creditPoint": "elm:creditPoint", "framework": {"@id": "elm:framework", "@type": "@id"}, "point": "elm:point",
    "ISCEDFCode": {"@id": "elm:ISCEDFCode", "@type": "@id"}, "targetGroup": {"@id": "elm:targetGroup", "@type": "@id"},
    "duration": {"@id": "elm:duration", "@type": "xsd:duration"}, "applicationDeadline": {"@id": "elm:applicationDeadline", "@type": "xsd:dateTime"},
    "startDate": {"@id": "elm:startDate", "@type": "xsd:dateTime"}, "endDate": {"@id": "elm:endDate", "@type": "xsd:dateTime"},
    "contentUrl": {"@id": "elm:contentUrl", "@type": "xsd:anyURI"}, "contactPoint": "elm:contactPoint",
    "emailAddress": {"@id": "elm:emailAddress", "@type": "@id"}, "groupMemberOf": {"@id": "elm:groupMemberOf", "@type": "@id"}
  },
  "@graph": [
    { "@id": "https://catalogue.example-alliance.example/elm/lo/2d9c1f7e-0b6a-4c1e-9a52-7f0d3b8a41c1", "@type": "elm:LearningOpportunity",
      "identifier": {"@id": "_:idLo", "@type": ["elm:Identifier", "adms:Identifier"], "notation": "EXA-NOR-BIP-SOCIAL-LAB#2026-27",
        "schemeName": "OACC offering code", "schemeAgency": {"en": "Northvale University"}},
      "title": {"en": "BIP: Social Innovation Lab"},
      "description": {"en": "<p>Three online preparation meetings in March and April lead to an on-site intensive week in Northvale in May 2027. Teams of students from all four universities of the alliance interview stakeholders, build a prototype and pitch it to a jury of practitioners.</p>"},
      "type": "snb:learning-opportunity/74a4a268e8", "mode": "snb:learning-assessment/e92d221e4d", "defaultLanguage": "auth:language/ENG",
      "providedBy": "https://catalogue.example-alliance.example/elm/org/northvale",
      "homepage": {"@id": "_:hpLo", "@type": "elm:WebResource", "contentUrl": "https://www.northvale.example/courses/bip-social-innovation-lab"},
      "supplementaryDocument": {"@id": "_:apply", "@type": "elm:WebResource", "title": {"en": "Application"},
        "contentUrl": "https://www.northvale.example/apply/bip-social-innovation-lab"},
      "temporal": {"@id": "_:period", "@type": "dc:PeriodOfTime", "prefLabel": {"en": "Spring semester 2026-27"},
        "startDate": "2027-03-15T00:00:00+02:00", "endDate": "2027-05-14T23:59:59+03:00"},
      "duration": "P61D", "applicationDeadline": "2027-01-31T23:59:59+02:00",
      "admissionProcedure": {"@id": "_:adm", "@type": "elm:Note", "noteLiteral": {"en": "Ask the international office of your home university to nominate you before 31 January 2027. Nominated students receive a link to the registration form."}},
      "location": {"@id": "_:locLo", "@type": "dc:Location", "geographicName": {"en": "Northvale"},
        "address": {"@id": "_:addrLo", "@type": "elm:Address", "countryCode": "auth:country/FIN"}},
      "priceDetail": {"@id": "_:price", "@type": "elm:PriceDetail", "prefLabel": {"en": "Free of charge"},
        "amount": {"@id": "_:amt", "@type": "elm:Amount", "unit": "auth:currency/EUR", "value": "0"}},
      "additionalNote": {"@id": "_:rem", "@type": "elm:Note", "noteLiteral": {"en": "Travel support from the alliance mobility fund is available to students of partner universities."}},
      "learningAchievementSpecification": "https://catalogue.example-alliance.example/elm/las/EXA-NOR-BIP-SOCIAL-LAB",
      "learningActivitySpecification": "https://catalogue.example-alliance.example/elm/activity/EXA-NOR-BIP-SOCIAL-LAB",
      "modified": "2026-10-20T09:15:00Z" },
    { "@id": "https://catalogue.example-alliance.example/elm/las/EXA-NOR-BIP-SOCIAL-LAB", "@type": "elm:LearningAchievementSpecification",
      "identifier": {"@id": "_:idLas", "@type": ["elm:Identifier", "adms:Identifier"], "notation": "EXA-NOR-BIP-SOCIAL-LAB",
        "schemeName": "OACC course code", "schemeAgency": {"en": "Northvale University"}},
      "title": {"en": "BIP: Social Innovation Lab"},
      "description": {"en": "<p>A Blended Intensive Programme in which interdisciplinary teams design a prototype that tackles a social challenge identified with a local organisation.</p>"},
      "language": "auth:language/ENG", "ISCEDFCode": ["snb:isced-f/0413", "snb:isced-f/0314"],
      "creditPoint": {"@id": "_:cp", "@type": "elm:CreditPoint", "framework": "snb:education-credit/6fcec5c5af", "point": "4"},
      "targetGroup": ["snb:target-group/1599531db0", "snb:target-group/acb7f20f25"],
      "category": {"en": ["social innovation", "design thinking", "entrepreneurship", "BIP"]},
      "learningOutcomeSummary": {"@id": "_:los", "@type": "elm:Note", "noteLiteral": {"en": "Frame a social challenge from the perspective of those affected; apply design-thinking methods in an international team; test a prototype with users; pitch an idea clearly and concisely."}},
      "learningOutcome": [
        {"@id": "_:o1", "@type": "elm:LearningOutcome", "title": {"en": "Frame a social challenge from the perspective of those affected"}},
        {"@id": "_:o2", "@type": "elm:LearningOutcome", "title": {"en": "Apply design-thinking methods in an international team"}},
        {"@id": "_:o3", "@type": "elm:LearningOutcome", "title": {"en": "Test a prototype with users"}},
        {"@id": "_:o4", "@type": "elm:LearningOutcome", "title": {"en": "Pitch an idea clearly and concisely"}} ],
      "entryRequirement": {"@id": "_:entry", "@type": "elm:Note", "noteLiteral": {"en": "Nomination by the home university. No specific background is required; teamwork in English is part of the course."}},
      "provenBy": {"@id": "_:assess", "@type": "elm:LearningAssessmentSpecification", "title": {"en": "Assessment"},
        "description": {"en": "<p>Participation in the online meetings, the team prototype and the final pitch. Pass/fail; a transcript of records is issued.</p>"}} },
    { "@id": "https://catalogue.example-alliance.example/elm/activity/EXA-NOR-BIP-SOCIAL-LAB", "@type": "elm:LearningActivitySpecification",
      "title": {"en": "BIP: Social Innovation Lab, teaching and learning activities"},
      "description": {"en": "<p>Online preparation meetings, an on-site intensive week and mentoring by practitioners.</p>"},
      "type": "snb:learning-activity/c_78e38bae", "mode": "snb:learning-assessment/e92d221e4d", "language": "auth:language/ENG" },
    { "@id": "https://catalogue.example-alliance.example/elm/org/northvale", "@type": ["elm:Organisation", "foaf:Agent"],
      "legalName": {"en": "Northvale University", "fi": "Northvalen yliopisto"},
      "identifier": {"@id": "_:idOrg", "@type": ["elm:Identifier", "adms:Identifier"], "notation": "northvale.example", "schemeName": "SCHAC home organization"},
      "homepage": {"@id": "_:hpOrg", "@type": "elm:WebResource", "contentUrl": "https://www.northvale.example"},
      "location": {"@id": "_:locOrg", "@type": "dc:Location", "address": {"@id": "_:addrOrg", "@type": "elm:Address", "countryCode": "auth:country/FIN"}},
      "contactPoint": {"@id": "_:cp1", "@type": "elm:ContactPoint", "emailAddress": {"@id": "mailto:courses@northvale.example", "@type": "elm:Mailbox"}},
      "groupMemberOf": "https://catalogue.example-alliance.example/elm/group/example-alliance" },
    { "@id": "https://catalogue.example-alliance.example/elm/group/example-alliance", "@type": "elm:Group",
      "prefLabel": {"en": "Example European Universities Alliance"}, "groupMember": "https://catalogue.example-alliance.example/elm/org/northvale" }
  ]
}
```

Choices to review: the `learningOutcome` nodes come from splitting the stored sentence at semicolons (a heuristic, not OACC data); `P61D` and the `T23:59:59` deadline are conventions; 0 in `EUR` assumes a currency; the BIP concepts are [INF]; the offset changes with Finnish summer time (`+02:00` to `+03:00`).

## 7. QDR coverage measured

**Method [LIVE].** (1) SPARQL on the QDR endpoint, run 2026-10-23, per country through the provider organisation's address (`?lo elm:providedBy/elm:location/elm:address/elm:countryCode <country NAL>`; Qualifications through `awardingOpportunity/awardingBody/...`); counts of released and "Not published anymore" records. (2) The DCAT country ZIPs of 2026-10-18 for AUT, NLD, ISL, CZE (Turtle parsed with rdflib). DEU (8 parts of about 220 MB) and FRA (first part 216 MB) exceed the 100 MB cap and were not downloaded. **All 1,903 JSON-LD files of the LOQ-wide ZIP and all JSON-LD files of the four countries are 0 bytes**: Turtle is the only usable bulk format today. Records exist in both namespaces (§3), so counts for one namespace may overlap those of the other; "file" and "live" counts differ because the live store keeps retired versions.

| Country | DCAT download | Qualifications | Learning opportunities | EQF 6-8 | University signal |
|---|---|---|---|---|---|
| AT | yes, 17.4 MB | file 7,118; live 6,420 released + 10,353 retired | file 6,948; live 6,268 released + 10,545 retired | Q 1,857 (26%); LO 1,809 (26%) (file) | 936 providers; **1,162 LOs from university-like providers, all degree programmes** (durations P2Y-P6Y, one P6M outlier; 1,152 with "ECTS" text); Innsbruck 72 released (+105 retired), P2Y-P6Y |
| IS | yes, 0.7 MB | 0 | 539 (live = file), 4 universities (Iceland 470, Akureyri 42, Agricultural 15, Hólar 12) | no EQF, ISCED-F "00", no credit points | titles such as "Business Finance, MS", "Korean Studies, Minor": programmes |
| NL | yes, 1.2 MB | file 1,036 | 0 | 64 (EQF 6: 61, 7: 3) | none; e.g. nurse specialisations; VU Amsterdam (357) and University of Amsterdam (413) only in *accreditation* records |
| DE | yes, 8 x 220 MB (skipped) | none found by awarding-body address | **not measurable** (endpoint limit); by name only Hochschule Fulda 2, HWR 2, Niederrhein 1, APOLLON Hochschule 175 | 0 Qualifications at EQF 6-8 | most providers are training firms; **Duisburg-Essen only in 453 accreditation records** |
| CZ | yes, 4.4 MB | file 1,954 | 0 | 123 (EQF 6: 72, 7: 51) | national occupational standards (codes like "29-061-R"); Palacký in 5 accreditation records |
| FR | yes, 2 parts (216 MB first, skipped) | live 20,528 released | live 61,882 released + 16 retired | Q released: EQF 6 6,549; 7 7,492; 8 24 | university-like names: 1,938 LOs, 9,262 Qualifications, licence / master programmes (Lille, Paris-Saclay); **Paris-Est Créteil: 0 LOs, 181-362 qualification records** (programmes) |
| ES, IT, DK | no dataset | ES 0, IT 3, DK 0 | ES 0, IT 3, DK 0 | - | none |

Whole store: 121,438 Qualifications (EQF 6: 35,935; 7: 33,726; 8: 3,247), 475,879 LAS, 283,026 Organisations; LO total not countable in 10 s. Micro-credential in the title: 18 Qualification records, 5 distinct titles, one publisher (LO titles not countable). Course-level university entries do exist elsewhere: Gothenburg 8,253 LOs, Gävle 5,816, Skövde 2,834, Galway 2,250 (titles such as "Economic History: Introductory Level") [LIVE]; none in the nine countries.

**What it means for import.**
- A QDR import would bring degree programmes and national occupational standards, not courses, BIPs or lecture series; no useful match for any alliance partner outside AT, IS and FR, and there only at programme level.
- Programme records are published by national bodies (IDs under `mms.is`, `data.lerneninoesterreich.at`) [INF], not by the universities: refresh cycles and ownership are not the alliance's.
- Possible narrow uses: organisation reference data (names, country, identifiers) and a link from an OACC course to its programme as a `QualificationReference` [INF]. Neither needs a general import channel.
- Quality signals seen in the data: free-text credit points, Austria's credit framework concept, retired versions, namespaces mixed in one store.

## 8. Options and recommendation

| Option | What | Effort | Decision points |
|---|---|---|---|
| (a) Export profile now on LOQ 3.3.1 | read-only serialiser from the public course JSON (`/api/public/v1`) to Turtle/RDF-XML; vocabulary tables (languages, countries, modes, ISCED-F); URI policy; mini-SHACL in CI; hosted URL for QDR "automatic update" | **S** spike (one organisation, no migration), **M** to publish for the alliance | who may publish (§9); URI base and persistence; whether instructors, images and seats stay out; test against QDR acceptance |
| (b) Design now, build against 3.4 | keep (a) behind the mapping tables; add nothing to the canonical model until the 3.4 non-formal micro-credential profile is public | **S** now (this study plus a draft ADR), **M** later | 3.4 draft date and content; whether `learningSetting`, assessment type, awarding body and quality assurance become mandatory |
| (c) Import channel | read QDR into OACC | **L**, low value | none justified; revisit only for organisation reference data |

**Recommendation.** Do (a) as a spike and (b) as the plan; do not do (c). Concretely: (1) ask the §9 questions first; (2) build the spike for one partner against 3.3.1, validated against the SHACL 1.3.0 shapes once obtainable; (3) keep every ELM-specific decision in mapping tables so that 3.4 changes tables, not code.

**Canonical model.** The 3.3.1 export needs **no change**: fallbacks exist for the LO homepage (portal page), outcomes (summary note) and organisation address (country). Changes that would improve it, each needing an ADR (backlog rule) and none to be decided before 3.4: formal/non-formal `learning_setting` per course or alliance default; structured `learning_outcomes[]`; an awarding statement (credit-awarding institution); price amount and currency instead of the `free_course` flag; assessment type; per-course organisation address; a joint-offer relation (several providing organisations).

## 9. Open questions for DG EMPL (EMPL-ELM-SUPPORT@ec.europa.eu)

1. **Who may publish.** May an alliance operator register as a QDR organisation and publish on behalf of ten universities (the platform has a "Delegation" function [DOC]), given the rule "publish only data you own" and the publishing agreement that lets the Commission republish? Is a university's public course catalogue "owned" by it, and does a national body already publishing its programmes (AT, IS, FR) conflict with course-level entries from an alliance?
2. **ELM 3.4.** When is a draft available and where (the ELM-support GitLab has no public issues [LIVE])? Does the non-formal micro-credential profile extend LOQ (catalogue) or only EDC (credentials)? Which fields become mandatory, how can the alliance contribute use cases (BIPs, lecture series, COIL, joint offers), and will the namespace header change again?
3. **Identifiers for joint offers.** How should one LO provided jointly by several universities be identified, who owns the identifier and is `publisher`, and how is double publication by each partner avoided? Is `Group` the intended place for a European University alliance?
4. **Visibility.** Are LOs without a Qualification or EQF level shown in Europass course search, and are they ranked or filtered differently?
5. **Learning setting.** Is a credit-bearing BIP or university short course "formal" or "non-formal" in ELM terms?
6. **Serialisation.** Which file types does "automatic update" accept for LOQ (the bulk JSON-LD files are empty today), and is the LOQ 3.3.1 SHACL v1.3.0 available as RDF?
7. **Vocabularies.** Are concepts for micro-credential, SDG or European Universities alliances planned, and may persons (instructors) be published at all?

## What could not be accessed or verified

EU Vocabularies "Downloads" and "Release notes" tabs (blocked assets); SHACL v1.3.0 as RDF; ELM 3.4 (no public document, claim from a DG EMPL contact only); QDR acceptance of the example; the German LO count; EQF 6-8 for FR learning opportunities; whether Europass course search shows non-qualification LOs.
