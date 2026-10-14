<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# ADR-0009: Direct access to partner OEAPI endpoints with host approval

- Status: Accepted
- Date: 2026-10-14
- Deciders: Lluís Alfons Ariño
- Consulted: [RP] `docs/research/partner-oeapi-endpoints.md`, [R00] `docs/review/00-consolidado-decisiones-pendientes.md`, [R02] `docs/review/02-modelo-datos-ingesta.md`, [DL] `docs/decisions-log.md`, `docs/spec-v4.0.md`

## Context and problem statement

Four Aurora partners (UIBK, UICE, VUA, UDE) run OEAPI endpoints, the same
ones eduXchange harvests [DL 4, DL 13]. None of them publishes a base URL;
eduXchange reaches them through the SURFeduhub gateway, which takes one
HTTP Basic client credential and an `X-Route: endpoint=<id>` header and
relays each request to the institution [RP]. Using the gateway would give
OECP one credential for all four partners, but it makes OECP depend on SURF's
registry, access lists and pilot agreements for data that each university
owns [RP].

The owner decided to go **directly to each university**, with a credential
and a bilateral agreement per partner, and to keep SURFeduhub only as a
fallback [DL 14]. Direct access means the harvester sends authenticated
requests to URLs that administrators type into the dashboard. That is a
server-side request forgery (SSRF) surface: a mistyped or malicious base URL
could point the worker at internal services, cloud metadata endpoints or
other hosts on the deployment network [R00 §2.3].

How does OECP reach partner endpoints, and how is that outbound traffic
constrained?

## Decision drivers

- Minimise dependencies on SURF for partner-owned data [DL 14].
- Keep a working path for a partner that cannot grant direct access.
- No outbound request to an address an alliance administrator has not
  approved, and never to non-public networks in production.
- Partner credentials never sent to a host other than the approved one.

## Considered options

1. Direct access per partner, with alliance-level host approval and an
   outbound address policy; SURFeduhub as fallback.
2. SURFeduhub gateway for every partner.
3. Direct access with a static allowlist of hosts in deployment configuration.

## Decision outcome

Chosen option: **direct access with host approval, SURFeduhub as fallback**
[DL 14; spec §6.2.2, §6.2.6].

As built (`apps/api/src/ingestion/oeapi/net-guard.ts`, `http-transport.ts`,
`oeapi-v5.client.ts`, `oeapi-client.factory.ts`,
`apps/api/src/admin/integrations/integrations.service.ts`):

- `partner_integrations.access_mode` is `direct` (default) or `surfeduhub`.
  Direct uses the partner's `base_url`, `auth_scheme`
  (`none`/`basic`/`bearer`/`api_key_header`) and its `secret_ref`
  ([ADR-0008](0008-partner-credentials-encrypted-in-postgresql.md)).
  SURFeduhub uses `SURFEDUHUB_GATEWAY_URL`, `X-Route: endpoint=<id>` and the
  alliance credential `SURFEDUHUB_SECRET_REF`; its host is allowlisted by
  deployment configuration.
- **Host approval.** An `alliance_admin` approves the current host with
  `POST /api/admin/v1/organizations/{orgId}/integration/approve-host`
  (`approved_host`, `approved_by`, `approved_at`, audit row
  `integration.approve_host`). Saving a different host clears the approval.
  Test connection, Sync now and scheduled harvests refuse an unapproved host
  (`oecp.oeapi.host_not_approved`).
- **Transport policy.** `https` on port 443 only. The host name is resolved,
  and the request is refused (`oecp.oeapi.address_refused`) if any address is
  loopback, private (RFC 1918), CGNAT, ULA, link-local (including cloud
  metadata), multicast, unspecified, documentation or otherwise reserved;
  IPv4 embedded in IPv4-mapped, NAT64 and 6to4 addresses is classified as
  IPv4. The socket connects only to the checked address (pinned through a
  custom `lookup`, so DNS rebinding cannot redirect it) while TLS still
  verifies the host name. Redirects are followed only within the same
  origin, at most 3 (`oecp.oeapi.redirect_refused`). 30 s timeout, 20 MB body
  limit, per-partner request rate.
- `OECP_ALLOW_INSECURE_PARTNER_HTTP=true` (development only) admits `http`,
  other ports and loopback, private, CGNAT and ULA addresses so the OEAPI mock
  can be harvested; link-local, multicast and reserved ranges stay refused.
- Every call carries `consumer={consumer_profile}` (default `eduxchange`);
  the access agreement must record partner and SURF consent to reuse that
  data (spec §10).

### Consequences

- Good, because each university controls OECP's access to its data, and SURF
  is not on the path unless a partner chooses the fallback.
- Good, because a second person (an alliance administrator) must approve
  every outbound host, and the approval is audited.
- Good, because the address policy is pure and unit-tested independently of
  the network.
- Bad, because OECP must obtain and store one credential and one agreement per
  partner, and each partner may need to allowlist OECP's egress address.
- Bad, because the access path is not verified yet against a real partner;
  Channel A was verified only against `tools/oeapi-mock` (`docs/backlog.md`).
- Neutral, because SURFeduhub support is kept in code and configuration
  without being exercised by any partner today.

### Confirmation

Unit tests `apps/api/test/unit/oeapi-v5.client.test.ts` and `http-transport.test.ts`;
integration tests `apps/api/test/integration/integrations.controller.int.test.ts`
(approval, host change clears it, test connection needs an approved host)
and `harvest.int.test.ts`.

## Pros and cons of the options

### Direct access with host approval

- Good, because of data ownership and SSRF control per host.
- Bad, because of bilateral paperwork per partner.

### SURFeduhub for every partner

- Good, because of one credential and one integration point [RP].
- Bad, because of dependency on SURF's registry and agreements [DL 14].

### Static host allowlist in deployment configuration

- Good, because hosts are fixed at deploy time.
- Bad, because onboarding a partner would need a redeployment.

## More information

- Spec §6.2.2, §6.2.6, §10; [RP]; [DL 13], [DL 14].
- Revisit if a partner can only be reached through SURFeduhub, or if SURF
  offers per-institution consent that removes the bilateral agreements.
