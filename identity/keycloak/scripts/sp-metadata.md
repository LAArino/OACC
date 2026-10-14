<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# `sp-metadata`: multi-ACS SP metadata generator (design, not implemented)

Spec v4.0 §4 and [DL 15]: OECP registers **one** SAML service provider,
entityID `https://{auth-host}/realms/oecp`, in the hosting institution's
federation (SIR/RedIRIS for the URV-hosted Aurora MVP) with export to
eduGAIN. Keycloak, however, exposes **one Assertion Consumer Service (ACS) per
IdP alias** [R01 §3]:

```
https://{auth-host}/realms/oecp/broker/{alias}/endpoint
```

and its per-alias descriptor
(`/realms/oecp/broker/{alias}/endpoint/descriptor`) lists only that alias's
ACS. The federation needs a single `EntityDescriptor` listing all of them.
This tool produces it; it is to be implemented in this directory (Node 22
script, no Keycloak changes) when the first partner IdP goes live.

## Inputs

| Input | Source |
|---|---|
| Auth host, realm | CLI flags or environment (`OECP_AUTH_HOST`, realm `oecp`) |
| IdP aliases | `identityProviders[].alias` in `../realm-oecp.yaml` (enabled ones), cross-checked against the live realm through the Admin API |
| SP signing and encryption certificates | realm keys (`GET /admin/realms/oecp/keys`): active RSA `sig` and `enc` keys; also the next key during a rollover |
| Organization and contacts | a small checked-in YAML (`sp-metadata.config.yaml`): `OrganizationName`, `OrganizationDisplayName`, `OrganizationURL` (en), technical, support and security (Sirtfi) contacts |
| MDUI | `DisplayName`, `Description`, `InformationURL`, `PrivacyStatementURL` (required by CoCo v2), `Logo` |
| Requested attributes | fixed by spec §4 |

## Output

One `EntityDescriptor` (`sp-metadata.xml`), unsigned (the federation signs
the aggregate), containing:

- `entityID="https://{auth-host}/realms/oecp"`.
- `<md:Extensions>` with:
  - `mdattr:EntityAttributes`: entity categories
    `https://refeds.org/category/personalized` (REFEDS Personalized Access),
    `https://refeds.org/category/code-of-conduct/v2` (CoCo v2), and the
    assurance certification `https://refeds.org/sirtfi`. **No** R&S
    (`http://refeds.org/category/research-and-scholarship`), per spec §4.
  - `mdrpi:RegistrationInfo` is left to the registrar.
- One `SPSSODescriptor` with
  `protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"`,
  `AuthnRequestsSigned="true"`, `WantAssertionsSigned="true"`, and:
  - `mdui:UIInfo` (MDUI above) and `PrivacyStatementURL`.
  - `KeyDescriptor use="signing"` and `use="encryption"` (assertions MUST be
    encrypted, spec §4) with the realm certificates; during key rollover both
    old and new certificates.
  - `EncryptionMethod` `http://www.w3.org/2009/xmlenc11#rsa-oaep` (and
    `…xmlenc#rsa-oaep-mgf1p`), matching `encryptionAlgorithm: RSA-OAEP`.
  - `SingleLogoutService` per alias (HTTP-POST and HTTP-Redirect) at
    `…/broker/{alias}/endpoint`.
  - `NameIDFormat` `urn:oasis:names:tc:SAML:2.0:nameid-format:transient`
    (the NameID is not the identifier; `subject-id`/`pairwise-id` are).
  - **One `AssertionConsumerService` per alias**, binding HTTP-POST,
    `Location="https://{auth-host}/realms/oecp/broker/{alias}/endpoint"`,
    with a **stable `index`** and `isDefault="true"` on the first only.
  - `AttributeConsumingService index="0"` with `ServiceName`,
    `RequestedAttribute` for `subject-id` and `pairwise-id`
    (`urn:oasis:names:tc:SAML:attribute:…`), `mail`, `schacHomeOrganization`,
    `displayName`, `givenName`, `sn` (`isRequired="true"` except the
    alternatives), with `NameFormat` `urn:oasis:names:tc:SAML:2.0:attrname-format:uri`.

## Stable ACS indexes

Indexes must never change once published, because IdPs may cache metadata.
The tool keeps an append-only map in `sp-metadata.indexes.json`
(`{ "<alias>": <index> }`): new aliases get `max(index) + 1`; removed aliases
keep their reserved index and are dropped from the output. The map is
committed with the generated metadata.

## Usage (planned)

```sh
node identity/keycloak/scripts/sp-metadata.mjs \
  --auth-host auth.aurora.example \
  --realm-file identity/keycloak/realm-oecp.yaml \
  --config identity/keycloak/scripts/sp-metadata.config.yaml \
  --out sp-metadata.xml
```

With `--check`, the tool validates the output against the SAML 2.0 metadata
XSDs and fails if an enabled alias has no ACS, or an index would change.

## When to run

- When a partner IdP is added, enabled or removed in `realm-oecp.yaml`.
- When realm SP keys rotate (publish the new key well before activating it).
- Then resubmit the document to the federation registry (SIR) and wait for
  its eduGAIN export before enabling the partner's invitations.
