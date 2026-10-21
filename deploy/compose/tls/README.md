<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# TLS certificates issued by the institution

This directory holds the server certificates and private keys of a deployment
whose hosting institution issues its own certificates (URV for
`lspurv.urv.cat` and `auth.lspurv.urv.cat`) instead of using ACME (Let's
Encrypt). Nothing in it except this README is part of the repository (the
`.gitignore` here lets only `README.md`, `.gitkeep` and `.gitignore` through).

The `traefik` service mounts the directory **read-only** at `/etc/traefik/tls`
(`OECP_TLS_DIR` in `.env` moves it elsewhere; default `./tls`, this
directory). Traefik loads the files named in
[`../traefik/dynamic/tls.yaml`](../traefik/dynamic/tls.yaml.example), which you
create from the example. Without that file this directory is unused. Full
procedure: [Guide E, step 2.4b](../../../docs/onboarding/hosting-operator.md#24b-tls-with-certificates-issued-by-the-institution);
renewal: [runbook, Certificate renewal (institution-issued)](../../../docs/production/runbook.md#certificate-renewal-institution-issued).

## Files to drop in

| File | Content |
|---|---|
| `portal.fullchain.pem` | The **portal certificate first**, then the intermediate CA certificate(s) in order up to (not including) the root. PEM. If one certificate covers both hosts (subject alternative names for the portal and the auth host), this is the only certificate you need |
| `portal.key.pem` | Its private key, PEM, **unencrypted** (Traefik cannot ask for a passphrase) |
| `auth.fullchain.pem` | Only if the auth host has its **own** certificate: the same layout |
| `auth.key.pem` | Only then: its private key |

These names are what `tls.yaml.example` expects; use others if you also edit
`tls.yaml`. The portal certificate becomes Traefik's **default** certificate,
the one served without SNI, which is the one the in-host TLS probe watches
(`OecpTlsCertificateExpiring`).

Chain order matters: leaf first, then the intermediate that signed it, then the
one above, and so on. Do **not** append the root. A certificate delivered
without chain needs the institution's intermediate appended
(`cat portal.crt intermediate.pem > portal.fullchain.pem`).

## Permissions

Traefik runs as root inside its container, so the keys need not be readable by
anyone else. On the host (run from `deploy/compose/`):

```sh
sudo chown -R root:root tls
sudo chmod 700 tls
sudo chmod 600 tls/*.key.pem
sudo chmod 644 tls/*.fullchain.pem
```

The mount is read-only, so a compromised Traefik cannot alter them either.

## Renewal

Traefik re-reads `traefik/dynamic/tls.yaml` when it changes, but not the PEM
files it names. After replacing them, run `touch traefik/dynamic/tls.yaml`. Run
the checks above **first**: with a key that does not match the certificate
Traefik serves no certificate at all. Procedure: runbook, *Certificate renewal
(institution-issued)*.

## Check before starting

```sh
openssl x509 -in tls/portal.fullchain.pem -noout -dates -subject -ext subjectAltName
openssl crl2pkcs7 -nocrl -certfile tls/portal.fullchain.pem | openssl pkcs7 -print_certs -noout   # leaf first; each issuer= is the next subject=
openssl verify -CAfile institution-root.pem -untrusted tls/portal.fullchain.pem tls/portal.fullchain.pem   # chain complete up to the root
# the key matches the certificate (same digest twice):
openssl x509 -in tls/portal.fullchain.pem -noout -pubkey | openssl sha256
openssl pkey -in tls/portal.key.pem -pubout | openssl sha256
```
