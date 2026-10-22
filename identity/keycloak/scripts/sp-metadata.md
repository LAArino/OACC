<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# `sp-metadata`: multi-ACS SP metadata for the federation

Spec v4.0 §4 and [DL 15]: OACC registers **one** SAML service provider,
entityID `https://{auth-host}/realms/oecp`, in the hosting institution's
federation (SIR/RedIRIS for the URV-hosted Aurora MVP) with export to
eduGAIN. Keycloak, however, exposes **one Assertion Consumer Service (ACS) per
IdP alias** [R01 §3]:

```
https://{auth-host}/realms/oecp/broker/{alias}/endpoint
```

and its per-alias descriptor
(`/realms/oecp/broker/{alias}/endpoint/descriptor`) lists only that alias's
ACS, together with ACS entries for bindings that are not valid for Web SSO
(HTTP-Redirect, HTTP-Artifact). The federation needs a single
`EntityDescriptor` listing every ACS once, over HTTP-POST. The script
[`tools/scripts/sp-metadata.mjs`](../../../tools/scripts/sp-metadata.mjs)
(Node 22, no dependencies, no Keycloak changes) produces it, **before the
server exists**: the certificates it needs are the SAML key pairs that
`tools/scripts/gen-saml-keys.sh` creates and keycloak-config-cli imports into
the realm (`components` in [`../realm-oecp.yaml`](../realm-oecp.yaml)), so the
document registered at the federation matches what the running Keycloak will
use, and survives a reinstall of its database.

## Quick start

From the repository root, with Node 22 and OpenSSL:

```sh
# 1. The SAML key pairs (once; see deploy/compose/secrets/README.md)
bash tools/scripts/gen-saml-keys.sh

# 2. The organization, contacts and display texts
cp identity/keycloak/sp-metadata.config.example.yaml identity/keycloak/sp-metadata.config.yaml
$EDITOR identity/keycloak/sp-metadata.config.yaml          # git-ignored: it holds addresses

# 3. The document
node tools/scripts/sp-metadata.mjs --auth-host auth.aurora.example --out sp-metadata.xml

# 4. Commit identity/keycloak/sp-metadata.indexes.json if it changed; send sp-metadata.xml
```

The script prints the aliases with their indexes and the fingerprint and expiry
of each certificate, and refuses to write while anything is wrong (expired or
weak certificate, missing contact, example hosts, a private key that does not
fit its certificate, an alias enabled in the live realm without an ACS).

## Inputs

| Input | Source |
|---|---|
| Auth host, realm | `--auth-host` (or `OECP_AUTH_HOST`), `--realm` (default `oecp`) |
| IdP aliases | `identityProviders[]` of [`../realm-oecp.yaml`](../realm-oecp.yaml) with `enabled` true after keycloak-config-cli's variable substitution (so `OECP_DEV_IDP_ENABLED=true` includes the development IdP `urv`), plus `reserveAliases` of the config |
| SP signing and encryption certificates | the Docker secrets `deploy/compose/secrets/keycloak_saml_sig_cert` and `keycloak_saml_enc_cert` (`--secrets-dir`); or explicit files (`--sig-cert`, `--enc-cert`, PEM or base64 DER, repeatable: first is the current one); or the Admin API of a running Keycloak (`--keycloak-url` with a token in `KEYCLOAK_ADMIN_TOKEN` or `--token-file`) |
| Organization, contacts, MDUI, categories | [`sp-metadata.config.example.yaml`](../sp-metadata.config.example.yaml), copied to `sp-metadata.config.yaml` |
| Requested attributes | fixed by spec §4 (in the script) |
| ACS indexes | [`../sp-metadata.indexes.json`](../sp-metadata.indexes.json), committed |

**Why `reserveAliases`.** A federation registration is slow (review, then the
eduGAIN export), so the first one should already list the aliases of the
partners expected soon, not only those enabled today. The example config
reserves `urv`, the alias of the host institution's own IdP; an alias listed
there gets its ACS even while it is disabled in the realm. Keycloak accepts the
extra ACS endpoints; an IdP that is not enabled simply answers 404 on its
`/endpoint/descriptor`.

**Admin API mode.** With `--keycloak-url` the certificates are read from
`/admin/realms/oecp/keys` (active and passive RSA keys, signing `RS256` and
encryption), leaving out the providers `rsa-generated` and `rsa-enc-generated`
unless `--include-generated` is given (their certificates change with the
database), and the enabled aliases of the live realm are compared with the
document. The token is never taken from the command line; get one for an
administrator or a service account of the `master` realm, for example
`export KEYCLOAK_ADMIN_TOKEN=$(...)` from the token endpoint.

## Output

One `EntityDescriptor` (`sp-metadata.xml`), unsigned (the federation signs the
aggregate), containing:

- `entityID="https://{auth-host}/realms/oecp"` (or `entityId` of the config).
- `<md:Extensions>` with `mdattr:EntityAttributes`: entity categories
  `https://refeds.org/category/personalized` (REFEDS Personalized Access) and
  `https://refeds.org/category/code-of-conduct/v2` (CoCo v2), and the
  assurance certification `https://refeds.org/sirtfi`. **No** R&S
  (`http://refeds.org/category/research-and-scholarship`), per spec §4: the
  script refuses a config that asks for it. `mdrpi:RegistrationInfo` is left
  to the registrar.
- One `SPSSODescriptor` with
  `protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"`,
  `AuthnRequestsSigned="true"`, `WantAssertionsSigned="true"`, and:
  - `mdui:UIInfo`: `DisplayName`, `Description`, `InformationURL`,
    `PrivacyStatementURL` (required by CoCo v2; set `privacyStatementUrl` to the
    portal's `https://<portal host>/en/privacy` once the privacy notice is
    published there, see [privacy-notice-draft.md](../../../docs/production/privacy-notice-draft.md))
    and `Logo`.
  - `KeyDescriptor use="signing"` and `use="encryption"` with the realm
    certificates (several during a key rollover, current one first) and
    Keycloak's key id as `KeyName`, exactly as Keycloak writes it into its
    signatures. The encryption descriptor declares `EncryptionMethod`
    `http://www.w3.org/2009/xmlenc11#rsa-oaep` and `…xmlenc#rsa-oaep-mgf1p`,
    matching `encryptionAlgorithm: RSA-OAEP`: assertions MUST be encrypted.
  - `SingleLogoutService` per alias (HTTP-POST and HTTP-Redirect) at
    `…/broker/{alias}/endpoint`.
  - `NameIDFormat` `urn:oasis:names:tc:SAML:2.0:nameid-format:transient`
    (the NameID is not the identifier; `subject-id`/`pairwise-id` are).
  - **One `AssertionConsumerService` per alias**, binding HTTP-POST,
    `Location="https://{auth-host}/realms/oecp/broker/{alias}/endpoint"`,
    with a **stable `index`** and `isDefault="true"` on the lowest index.
  - `AttributeConsumingService index="0"` with `ServiceName` and
    `RequestedAttribute`: `subject-id` and `pairwise-id`
    (`urn:oasis:names:tc:SAML:attribute:…`, alternatives, so not individually
    required), and `mail`, `schacHomeOrganization`, `displayName`,
    `givenName`, `sn` (`urn:oid:…`, `isRequired="true"`), `NameFormat`
    `urn:oasis:names:tc:SAML:2.0:attrname-format:uri`.
- `md:Organization` and `md:ContactPerson` (technical, support, and the
  Sirtfi security contact as `contactType="other"` with
  `remd:contactType="http://refeds.org/metadata/contactType/security"`).

The output is deterministic (no timestamps), so it can be committed and
compared.

## Stable ACS indexes

Indexes must never change once published, because IdPs may cache metadata.
The tool keeps an append-only map in `identity/keycloak/sp-metadata.indexes.json`
(`{ "<alias>": <index> }`): new aliases get `max(index) + 1`; removed aliases
keep their reserved index and are dropped from the output. The script rewrites
the file when it adds an alias; **commit it** with the generated metadata.
The first registration is `{ "urv": 0 }`.

## Checking

- `--check` writes nothing and fails if an alias would be added to the indexes
  file, if the output file (`--out`) exists and differs from what would be
  generated, or on any of the problems above. Use it before sending and in CI
  of a deployment repository.
- With `xmllint` installed (libxml2) the script always checks that the document
  is well-formed. For schema validation, give `--schema-dir DIR` with the
  SAML 2.0 metadata XSDs, whose `schemaLocation` entries point to local files:

  ```sh
  mkdir -p /tmp/saml-xsd && cd /tmp/saml-xsd
  for f in saml-schema-metadata-2.0.xsd saml-schema-assertion-2.0.xsd; do
    curl -fsSO "https://docs.oasis-open.org/security/saml/v2.0/$f"; done
  curl -fsSO https://www.w3.org/TR/xmldsig-core/xmldsig-core-schema.xsd
  curl -fsSO https://www.w3.org/TR/xmlenc-core/xenc-schema.xsd
  curl -fsSO https://www.w3.org/2001/xml.xsd
  sed -i.bak -E \
    -e "s#(schemaLocation=[\"'])http://www.w3.org/TR/[^\"']*/(xmldsig-core-schema|xenc-schema)\.xsd#\1\2.xsd#" \
    -e "s#(schemaLocation=[\"'])http://www\.w3\.org/[0-9]+/([0-9]+/)?xml\.xsd#\1xml.xsd#" *.xsd
  node tools/scripts/sp-metadata.mjs --auth-host … --schema-dir /tmp/saml-xsd
  ```

  The same variable `SAML_SCHEMA_DIR` makes the unit tests validate their output
  too (`node --test "tools/scripts/**/*.test.mjs"`, also run by CI). The
  generated document of the development realm validates against these schemas,
  as does the descriptor Keycloak 26.8.1 itself serves.
- Compare with the real thing: after the realm import, the per-alias
  descriptor of Keycloak (`/realms/oecp/broker/{alias}/endpoint/descriptor`)
  lists the same entityID, the same certificates (plus the generated ones,
  see below) and the same ACS location.

## When to run

- **Before the server exists**, to get the first registration going: URV IT
  receives `sp-metadata.xml` and registers it in SIR; no DNS or TLS is needed
  to produce it, only the future auth host name.
- When a partner IdP is added, enabled or removed in `realm-oecp.yaml` and its
  alias is not yet covered by `reserveAliases`.
- When the SAML key pairs rotate (publish the new certificates next to the old
  ones well before activating the new keys: `--sig-cert CURRENT --sig-cert NEXT`).
- Then resubmit the document to the federation registry (SIR) and wait for
  its eduGAIN export before enabling the partner's invitations.

## Things to know

- **Keycloak lists more certificates than the metadata does.** Keycloak keeps its
  generated RSA keys (priority 100) enabled next to the imported ones (priority
  200), so its own per-alias descriptors also carry the generated certificates.
  They are neither used for signing nor registered; only the imported pair is
  in this metadata, and a partner who took a certificate from a Keycloak
  descriptor should be given this metadata instead. To remove them from the
  descriptors, disable `rsa-generated` and `rsa-enc-generated` in the console
  (Realm settings, Keys, Providers) once the stable keys are in use; tokens
  signed with them become invalid, at most a few minutes of access tokens.
- **The signing key signs tokens too.** Keycloak chooses the active key by use
  and algorithm only, so the imported RS256 key (priority 200) also signs the
  realm's tokens from the first import on; the API fetches the JWKS and follows
  the new `kid`. The generated key stays enabled and publishes in the JWKS, so
  tokens issued before the switch remain valid until they expire.
- **Hosts.** The document contains `https://{auth-host}/…`; if the auth host
  changes, the entityID changes and the registration starts over.
