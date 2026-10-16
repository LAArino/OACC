<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Helm chart (v1 deliverable, not yet available)

The Helm chart is a **v1** deliverable (spec v4.1 §12; §10 "Deliverables";
[DL 10]). The MVP ships only the Docker Compose reference deployment in
[`../compose`](../compose/README.md). This directory reserves the location
and records what the chart will need, so that the Compose deployment and the
chart stay aligned.

## Planned scope

- Workloads: `web` (Deployment), `api` (Deployment, HPA), `worker`
  (Deployment, single replica or leader-elected schedules), `keycloak-config`
  (Job, Helm hook post-install/post-upgrade), `db-migrate` (Job running
  `pnpm db:migrate`, pre-upgrade hook).
- External dependencies by default (operators bring their own): PostgreSQL 16
  (e.g. CloudNativePG with PITR), Valkey 8, Keycloak 26 (e.g. Keycloak
  Operator), S3-compatible object storage for uploads (v1), OpenBao (v1).
- Ingress through Traefik `IngressRoute`/`Middleware` CRDs or a standard
  `Ingress` plus annotations; rate limits and headers equivalent to
  `deploy/compose/traefik/dynamic/middlewares.yaml`.
- NetworkPolicies mirroring the Compose networks: only the worker has
  egress to partner OEAPI endpoints; data stores have no egress.
- Pod security: non-root, read-only root filesystem, dropped capabilities,
  `seccompProfile: RuntimeDefault`.
- Backups and monitoring: what the Compose profiles `backup` (pgBackRest,
  WAL archiving, 35-day window, restore drill) and `observability` (alert
  rules, Alertmanager, logs shipped to Loki by Grafana Alloy, Grafana
  dashboards) provide maps to the PostgreSQL operator's backups and the
  cluster's monitoring stack; the alert rules of
  `deploy/compose/observability/alert-rules.yml` as a `PrometheusRule`.
- Branding: the alliance's header images and logo (deployment files, never in
  the image) mounted into `web` at `NUXT_BRANDING_DIR`.

## Values it will need

| Value | Purpose |
|---|---|
| `global.portalHost`, `global.authHost` | public hosts (portal and Keycloak) |
| `image.registry`, `image.repository.{api,web}`, `image.tag` / `image.digest`, `image.pullSecrets` | cosign-signed images |
| `api.replicas`, `api.resources`, `api.autoscaling.*` | API sizing |
| `worker.resources`, `worker.egress.allowedCidrs` | harvester sizing and egress policy |
| `web.replicas`, `web.resources` | Nuxt sizing |
| `web.env.NUXT_PUBLIC_API_BASE` | public API base URL |
| `web.branding.existingConfigMap` (or a volume), `web.env.NUXT_PUBLIC_HERO_IMAGE`, `…_HERO_IMAGE_COURSES`, `…_LOGO_IMAGE`, `…_FAVICON_IMAGE` and the alt texts | header images, alliance logo, favicon and partner logos (`partner-<slug>.svg`) served at `/branding/` (`deploy/compose/branding/README.md`) |
| `postgresql.host`, `postgresql.port`, `postgresql.database`, `postgresql.user`, `postgresql.existingSecret` | `DATABASE_URL` |
| `valkey.url`, `valkey.existingSecret` | `VALKEY_URL` |
| `keycloak.issuer`, `keycloak.jwksUrl`, `keycloak.adminUrl`, `keycloak.backendClientExistingSecret` | JWT validation and Admin API (`oecp-backend`) |
| `keycloakConfig.enabled`, `keycloakConfig.image`, `keycloakConfig.adminExistingSecret`, `keycloakConfig.realmFile` | realm as code Job (`identity/keycloak/realm-oecp.yaml` as ConfigMap) |
| `secrets.masterKey.existingSecret` | `OECP_MASTER_KEY_FILE` (AES-256-GCM master key, spec §10) |
| `secrets.provider` (`db` \| `openbao`), `openbao.address`, `openbao.auth.*` | secret references (`db:` in MVP, `openbao:` in v1) |
| `uploads.storage` (`pvc` \| `s3`), `uploads.pvc.size`, `uploads.s3.{endpoint,bucket,existingSecret}` | CSV uploads |
| `smtp.host`, `smtp.port`, `smtp.from`, `smtp.existingSecret` | invitations and alerts |
| `ingress.className`, `ingress.tls.{issuer,secretName}`, `ingress.rateLimits.{search,suggest,oeapi,admin}` | edge, TLS, spec §10 limits (20/10/10/30 r/s) |
| `keycloakAdmin.allowlist` | IP allowlist of the Keycloak admin console |
| `observability.otlpEndpoint`, `observability.serviceMonitor.enabled` | OpenTelemetry and Prometheus Operator |
| `networkPolicy.enabled`, `podSecurityContext`, `securityContext` | hardening |
| `migrations.enabled`, `migrations.hook` | `pnpm db:migrate` Job |
| `alliance.slug`, `alliance.uiLanguages` | alliance-agnostic configuration (spec §1) |
