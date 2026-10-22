<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# OACC architecture

OACC is a **modular monolith**: one NestJS codebase built into one image (`oecp/api`) that runs as two processes, `api` (HTTP, `dist/main.js`) and `worker` (BullMQ jobs on Valkey, `dist/worker.js`), next to a Nuxt portal (`oecp/web`), Keycloak, PostgreSQL and Valkey behind Traefik ([ADR-0001](adr/0001-modular-monolith-on-nestjs.md), [spec §3](spec-v4.1.md#3-architecture)). One deployment serves **one alliance**: the alliance's name, branding, partner organizations, course attributes and host names are configuration, and the first deployment is the Aurora alliance hosted by URV.

Course data enters through three **ingestion channels** that all end in the same canonical model ([spec §6](spec-v4.1.md#6-ingestion-anti-corruption-layer)): **Channel A**, the worker harvests a partner's OEAPI v5 endpoint (or the SURFeduhub gateway) on a schedule; **Channel B**, a partner administrator uploads `courses.csv` and `offerings.csv` in the admin console; **Channel C**, a partner administrator edits courses in the console's web form. Each organization has one authoritative channel; the others can only add overrides ([ADR-0010](adr/0010-overrides-on-harvested-records.md)). The four diagrams below go from the outside in: who surrounds a deployment, how it runs on one host, how the API is split into modules, and how a course travels from a source to the public outputs.

## 1. Solution context

```mermaid
flowchart LR
  aadm["Alliance administrator<br/>alliance_admin, Aurora Foundation office"]
  subgraph partners["Partner universities"]
    padm["Partner administrator<br/>partner_admin"]
    ep["Partner OEAPI v5 endpoint"]
    surf["SURFeduhub gateway"]
  end
  subgraph oecp["OACC deployment (one alliance)"]
    console["Admin console<br/>/{locale}/admin, client-rendered"]
    portal["Nuxt portal, server-rendered"]
    api["api<br/>/api/public/v1, /oeapi/v5,<br/>/api/admin/v1, /media"]
    worker["worker<br/>harvester and scheduled jobs"]
    kc["Keycloak, realm oecp<br/>local accounts with TOTP<br/>for organizations without IdP"]
    db[("PostgreSQL<br/>pgBackRest repo1 on the host")]
    grafana["Grafana<br/>profile observability"]
  end
  subgraph fed["Identity federation"]
    edugain["eduGAIN metadata aggregate"]
    pidp["Partner SAML IdP<br/>one per partner"]
  end
  subgraph consumers["Consumers"]
    students["Students and the public"]
    portals["External portals"]
    clients["Catalogue API clients"]
  end
  subgraph hosting["Hosting institution"]
    hop["Hosting operator, URV"]
    smtp["SMTP relay"]
    repo2["Second backup site, repo2<br/>planned, not configured"]
    probe["Off-host availability probe<br/>planned"]
  end

  worker -- "Channel A: scheduled harvest,<br/>network egress, approved host only" --> ep
  worker -- "Channel A fallback: X-Route" --> surf
  surf -.-> ep
  padm -- "Channel B: CSV upload" --> console
  padm -- "Channel C: web form" --> console
  aadm -- "host approval, organizations,<br/>invitations, maintenance" --> console
  console -- "Bearer JWT" --> api
  console -- "OIDC sign-in" --> kc
  kc -- "SAML" --> pidp
  pidp -.- edugain
  worker -- "IdP metadata refresh" --> edugain
  students --> portal
  portal --> api
  portals -- "/oeapi/v5" --> api
  clients -- "/api/public/v1" --> api
  api --> db
  worker --> db
  api -- "invitation mail" --> smtp
  kc -- "set-up mail" --> smtp
  db -. "WAL and backups" .-> repo2
  probe -. "HTTPS check" .-> portal
  hop -- "127.0.0.1:3001" --> grafana
```

- **Channel A** is pull-only ([ADR-0005](adr/0005-pull-only-oeapi-harvesting-canonical-model.md)): the worker calls a partner endpoint only once an alliance administrator has approved its host (`partner_integrations.approved_host`), only over `https` on port 443 and only to public addresses (`apps/api/src/ingestion/oeapi/net-guard.ts`); see [ADR-0009](adr/0009-direct-partner-oeapi-access-with-host-approval.md), [spec §6.1](spec-v4.1.md#61-common-pipeline-implemented) and [§6.2](spec-v4.1.md#62-channel-a-scheduled-oeapi-harvester-implemented-mock-verified) (6.2.6 for the outbound rules). The `api` process also reaches the endpoint for "Test connection".
- **Channels B and C** are the console's CSV upload and course wizard: [spec §6.3](spec-v4.1.md#63-channel-b-csv-upload-implemented), [§6.4](spec-v4.1.md#64-channel-c-web-form-implemented), [ADR-0011](adr/0011-csv-uploads-all-or-nothing-shared-validator.md); the [data-provider guides](guides/README.md) explain all three channels.
- **Identity** is Keycloak only, for administrators only; the public portal never loads OIDC code. A federated organization signs in through its own SAML IdP ([ADR-0004](adr/0004-keycloak-only-identity-one-saml-idp-per-partner.md)), whose metadata the worker refreshes from the signed eduGAIN aggregate ([ADR-0017](adr/0017-idp-metadata-refresh-from-pinned-signature-aggregate.md)); an organization without IdP uses local accounts with TOTP (decision 22 in [decisions-log.md](decisions-log.md)). Details in [spec §4](spec-v4.1.md#4-identity).
- **Roles** are those of the [onboarding index](onboarding/README.md): alliance administrator, partner administrator and hosting operator (no OACC account).
- **Operations**: repo2 and the off-host probe are open items of [Guide E](onboarding/hosting-operator.md); Grafana is reachable on the host's loopback only.

## 2. Deployment on one host (Docker Compose)

```mermaid
flowchart TB
  internet(("Internet"))
  outbound(("Partner endpoints,<br/>eduGAIN, image URLs"))

  subgraph always["No profile: always started"]
    traefik["traefik<br/>traefik:v3.7.14<br/>ports 80, 443 | edge"]
    web["web<br/>oecp/web, Nuxt :3000 | edge"]
    api["api<br/>oecp/api: node dist/main.js<br/>:3000 | edge, backend"]
    worker["worker<br/>oecp/api: node dist/worker.js<br/>health :3001 | backend, egress"]
    keycloak["keycloak<br/>oecp/keycloak :8080 | edge, backend"]
    kcc["keycloak-config<br/>adorsys/keycloak-config-cli<br/>one-shot realm import | backend"]
    postgres[("postgres<br/>oecp/postgres: databases oecp, keycloak<br/>WAL archiving | backend")]
    valkey[("valkey<br/>valkey/valkey:8.1.10-alpine | backend")]
  end
  subgraph dev["Profile dev"]
    mailpit["mailpit<br/>SMTP sink, 127.0.0.1:8025"]
    mock["oeapi-mock<br/>oecp/oeapi-mock, 127.0.0.1:8090"]
    tidp["test-saml-idp<br/>simplesamlphp, 127.0.0.1:8091"]
  end
  subgraph bkp["Profile backup"]
    backup["backup<br/>oecp/postgres: oecp-backup run<br/>network_mode none"]
  end
  subgraph obs["Profile observability"]
    prom["prometheus"]
    am["alertmanager"]
    otel["otel-collector"]
    nexp["node-exporter"]
    bbox["blackbox-exporter"]
    loki["loki"]
    alloy["alloy"]
    dsp["docker-socket-proxy<br/>docker-api network"]
    graf["grafana<br/>127.0.0.1:3001"]
  end
  subgraph vols["Named volumes"]
    v_pg[("postgres_data, postgres_socket,<br/>pgbackrest-repo")]
    v_up[("uploads<br/>/data/uploads")]
    v_idp[("idp-metadata")]
    v_vk[("valkey_data")]
    v_acme[("traefik_acme")]
    v_bm[("backup-metrics, tmpfs")]
    v_obs[("prometheus_data, loki_data, alloy_data,<br/>grafana_data, alertmanager_data")]
  end

  internet -- ":80 redirects, :443 TLS" --> traefik
  traefik -- "portal host /, router web" --> web
  traefik -- "portal host: routers api, api-search, api-suggest,<br/>oeapi, api-admin, api-docs" --> api
  traefik -- "auth host: router auth /realms/oecp, /resources;<br/>auth-admin /admin, /realms/master, IP allowlist" --> keycloak
  web -- "http://api:3000" --> api
  api --> postgres
  api --> valkey
  worker --> postgres
  worker --> valkey
  worker -- "egress" --> outbound
  keycloak --> postgres
  kcc --> keycloak
  backup --- v_pg
  postgres --- v_pg
  api --- v_up
  worker --- v_up
  api --- v_idp
  worker --- v_idp
  backup -. "read-only" .- v_up
  backup --- v_bm
  valkey --- v_vk
  traefik --- v_acme
  obs --- v_obs
  prom -- "scrapes :3000/metrics" --> api
  prom -- "scrapes :3001/metrics" --> worker
  alloy --> dsp
  alloy --> loki
  graf --> prom
  graf --> loki
```

- **Profiles** follow `deploy/compose/compose.yaml`: eight services always run (`keycloak-config` exits after the realm import), `dev` adds the SMTP sink, the OEAPI mock partner and a test SAML IdP, `backup` adds the pgBackRest scheduler, `observability` adds metrics, alerts, traces and logs.
- **Networks**: `edge` (`oecp-edge`, Traefik and what it routes to; not internal, so `api` and `keycloak` also reach the SMTP relay), `backend` (`oecp-backend`, internal: data stores), `egress` (`oecp-egress`, the worker's outbound access) and `docker-api` (`oecp-docker-api`, internal: Alloy to the socket proxy). `backup` has no network; repo2 needs `egress` on `postgres` and `backup`.
- **Routers** (labels on `api`, `keycloak`, `web`): `api` matches `/api`, `/oeapi` and `/media`; `api-search` and `api-suggest` (`/api/public/v1/courses`, `/suggest`), `oeapi` (`/oeapi/v5`) and `api-admin` (`/api/admin`) add per-IP rate limits; `api-docs` serves `/api/public/v1/docs`, `/api/admin/v1/docs` and `/api/docs-assets/`. Middlewares are in `deploy/compose/traefik/dynamic/`.
- **Ports**: only 80 and 443 are published on all interfaces; the Traefik dashboard (8080, local development), Grafana (3001) and the `dev` ports listen on 127.0.0.1.
- **One image, two processes**: `api` and `worker` both run `oecp/api` and share the volumes `uploads` (CSV uploads and course images) and `idp-metadata`. Detail: [spec §3](spec-v4.1.md#3-architecture) and §10, [deploy/compose/README.md](../deploy/compose/README.md), [ADR-0003](adr/0003-traefik-edge-proxy.md) and [Guide E](onboarding/hosting-operator.md).

## 3. Modules of the API and their relations

```mermaid
flowchart LR
  subgraph apiP["api process: AppModule, dist/main.js"]
    catalogue["CatalogueModule<br/>/api/public/v1"]
    oeapi["OeapiModule<br/>/oeapi/v5"]
    admin["AdminModule /api/admin/v1<br/>auth, courses, uploads, integrations,<br/>organizations, network, InvitationsModule"]
    csvApi["CsvIngestionModule<br/>inline uploads"]
    maintApi["MaintenanceApiModule"]
    mediaApi["MediaApiModule<br/>/media"]
    misc["HealthModule, OpenApiModule"]
  end
  shared["Shared by both processes:<br/>DbModule, AppConfigModule, AppLoggerModule,<br/>MetricsModule, IngestionModule (CanonicalWriter,<br/>HarvestQueue, OEAPI client), SecretsModule,<br/>IdentityModule, MediaCoreModule, MaintenanceCoreModule"]
  subgraph workerP["worker process: WorkerModule, dist/worker.js"]
    ingW["IngestionWorkerModule<br/>HarvestScheduler, HarvestScheduleProcessor,<br/>HarvestProcessor"]
    csvW["CsvWorkerModule<br/>CsvProcessor, CsvRetentionScheduler"]
    maintW["MaintenanceWorkerModule<br/>MaintenanceScheduler, MaintenanceProcessor,<br/>IdpMetadataRefreshModule"]
    mediaW["MediaWorkerModule<br/>MediaProcessor"]
  end
  subgraph queues["Valkey queues"]
    qhs[["harvest-schedule"]]
    qh[["harvest"]]
    qc[["csv"]]
    qm[["media"]]
    qmt[["maintenance"]]
  end
  subgraph pg["PostgreSQL"]
    tOrg[("organizations, partner_integrations,<br/>secrets, attribute_definitions")]
    tCourse[("courses, course_texts, course_offerings,<br/>academic_sessions, course_isced_codes,<br/>course_offering_delivery_modes")]
    tSync[("sync_runs, sync_errors,<br/>ext_metadata_history")]
    tAudit[("audit_log, admin_invitations,<br/>admin_activity, maintenance_runs")]
  end

  apiP -.- shared
  workerP -.- shared
  admin -- "Sync now" --> qh
  admin -- "large upload" --> qc
  ingW -- "job scheduler per partner" --> qhs
  qhs -- "tick to harvest-{organization_id}" --> qh
  qh --> ingW
  qc --> csvW
  csvApi -- "image_url" --> qm
  csvW -- "image_url" --> qm
  qm --> mediaW
  maintApi -- "on-demand run" --> qmt
  maintW -- "daily schedules" --> qmt
  qmt --> maintW
  admin -- "form saves via CanonicalWriter" --> tCourse
  csvApi -- "CanonicalWriter" --> tCourse
  ingW -- "CanonicalWriter" --> tCourse
  csvW -- "CanonicalWriter" --> tCourse
  ingW -- "runs, errors, raw payloads" --> tSync
  csvW --> tSync
  admin -- "organizations, integrations,<br/>credentials" --> tOrg
  admin -- "audit, invitations" --> tAudit
  maintW -- "retention, partitions,<br/>dormancy, metadata refresh" --> tAudit
  catalogue -- "reads published" --> tCourse
  oeapi -- "reads published" --> tCourse
  mediaW -- "image columns" --> tCourse
```

- **Modules** are the directories of `apps/api/src/`: `catalogue`, `oeapi`, `admin` (subdirectories `auth`, `courses`, `uploads`, `integrations`, `organizations`, `network`, `invitations`; only `invitations` is a module of its own), `ingestion` (`oeapi/` harvester client and adapter, `csv/`, `canonical-writer.service.ts`), `identity` (Keycloak admin client, `metadata-refresh/`), `maintenance`, `media`, `secrets`, `health`, `openapi`, `metrics`, `db`, `config`, `logging`, `common` (problem details) and `cli` (the `oecp` command, not loaded by either process).
- **The two root modules** are `app.module.ts` (`AppModule`) and `worker.module.ts` (`WorkerModule`); the worker has no public HTTP, only `/health`, `/ready` and `/metrics` on port 3001. `IngestionModule` registers the BullMQ connection and the `harvest` queues in both processes; the processors exist only in the worker.
- **Queues** (constants in `harvest.constants.ts`, `csv/csv.constants.ts`, `media/media.constants.ts`, `maintenance/maintenance.constants.ts`): `harvest-schedule`, `harvest`, `csv` (uploads and the daily `csv-retention`), `media` (CSV `image_url` fetches) and `maintenance` (`history-partitions`, `idp-metadata-refresh`, `retention`, `dormancy`, `account-cleanup`). Schedules and job ids are in [spec §3, "Queues"](spec-v4.1.md#3-architecture).
- **Tables** come from `apps/api/db/migrations/0001_init.sql` to `0010_sync_run_files.sql`. Administrators are Keycloak users, not a table; the IdP metadata cache is the `idp-metadata` volume, and the refresh writes Keycloak's IdP configuration and `audit_log`. Credentials in `secrets` are encrypted with the master key ([ADR-0008](adr/0008-partner-credentials-encrypted-in-postgresql.md)).
- **Read paths** (`catalogue`, `oeapi`) only read published records; full-text search runs in PostgreSQL ([ADR-0007](adr/0007-full-text-search-in-postgresql.md)). Admin API detail: [spec §8.2](spec-v4.1.md#82-admin-api-apiadminv1-implemented) and the [OpenAPI documents](api/README.md).

## 4. Data flow of a course

```mermaid
flowchart LR
  subgraph sources["Sources"]
    sA["Channel A<br/>OEAPI v5 pages"]
    sB["Channel B<br/>courses.csv, offerings.csv"]
    sC["Channel C<br/>course wizard"]
  end
  subgraph validate["Validation"]
    vA["OeapiV5Adapter<br/>v5 to canonical mapping"]
    vB["Shared CSV validator<br/>packages/schemas csv-validate.ts<br/>in the browser and on the server"]
    vC["Admin API contracts<br/>courseInput, offeringInput"]
    canon["Canonical Zod schema<br/>packages/schemas canonical.ts"]
  end
  writer["CanonicalWriter<br/>content hash, natural key,<br/>overrides if authoritative = oeapi,<br/>withdrawal by absence (harvest)"]
  tables[("courses, course_texts,<br/>course_offerings")]
  rule{"Publication rule<br/>handbook completeness,<br/>OECP_PUBLISH_RULE warn | enforce"}
  subgraph outputs["Outputs: published courses only"]
    portal["Nuxt SSR portal"]
    pub["/api/public/v1"]
    oe["/oeapi/v5<br/>ext.oecp, ext.oecp_image"]
    media["/media<br/>course images"]
  end
  subgraph side["Side outputs"]
    sync[("sync_runs, sync_errors<br/>sync monitor")]
    hist[("ext_metadata_history")]
    audit[("audit_log")]
  end

  sA --> vA
  sB --> vB
  sC --> vC
  vA --> canon
  vB --> canon
  vC --> canon
  canon --> writer
  writer -- "upsert when hash differs" --> tables
  tables --> rule
  rule -- "published, or draft in enforce" --> tables
  tables --> portal
  tables --> pub
  tables --> oe
  tables --> media
  writer -- "one run per harvest, upload or save;<br/>rejections and warnings" --> sync
  writer -- "raw payload and SHA-256" --> hist
  writer -- "status changes, overrides" --> audit
  rule -- "oecp.content.handbook_incomplete" --> sync
```

- **Validation** differs per channel and meets in one canonical schema: the harvester maps v5 in `apps/api/src/ingestion/oeapi/oeapi-v5.adapter.ts` ([spec §6.2.4](spec-v4.1.md#62-channel-a-scheduled-oeapi-harvester-implemented-mock-verified)); CSV files go through `validateCsvFiles` of `packages/schemas/src/csv-validate.ts`, the same code in the console (`apps/web/app/utils/csvConsole.ts`) and in `CsvIngestionService`, and an upload is all or nothing ([ADR-0011](adr/0011-csv-uploads-all-or-nothing-shared-validator.md)); the form posts to the admin API, validated by the Zod contracts of `packages/schemas/src/admin-courses.ts`.
- **`CanonicalWriter`** (`apps/api/src/ingestion/canonical-writer.service.ts`) hashes the RFC 8785 serialisation with SHA-256 (`content_hash`): an equal hash only refreshes `last_seen_at`, so every channel is idempotent ([spec §6.1](spec-v4.1.md#61-common-pipeline-implemented)). On an `oeapi`-authoritative organization, CSV or form changes become per-field `overrides` that survive the next harvest ([ADR-0010](adr/0010-overrides-on-harvested-records.md), [spec §5.3](spec-v4.1.md#53-overrides-dl-12-implemented)). A course missing from 3 complete harvests (`withdraw_after_absences`) is withdrawn, unless 30 % or more of the published courses are missing at once ([ADR-0015](adr/0015-withdrawal-by-absence-with-mass-absence-guard.md), spec §6.2.5).
- **The publication rule** is `completeness()` of `packages/schemas/src/handbook.ts`, applied after a course and its offerings are written: `warn` publishes with a warning, `enforce` keeps an incomplete course as `draft` (decision 21c, [ADR-0016](adr/0016-handbook-publish-rule-with-warn-and-enforce.md)). Nothing is rejected because of it.
- **Outputs** read the same tables: the portal renders server-side from the public API ([ADR-0002](adr/0002-vue3-nuxt-ssr-catalogue.md), [spec §7](spec-v4.1.md#7-public-portal)); `/oeapi/v5` carries what v5 cannot express in `ext.oecp` and `ext.oecp_image` ([spec §9](spec-v4.1.md#9-public-read-api-oeapi-v5-compatible-implemented), [ADR-0014](adr/0014-strict-consumer-semantics-on-oeapi-read-api.md)); course images are WebP files under `/data/uploads/media/courses/`, uploaded in the form or fetched by the `media` queue from a CSV `image_url`, and served at `/media/courses/{courseId}/{file}`.
- **Side outputs**: each harvest, upload or form save is one `sync_runs` row with its `sync_errors`, shown in the console's sync history; raw payloads (without person data) go to the monthly partitions of `ext_metadata_history`; status changes and overrides are written to `audit_log`.
