#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# Creates the key pairs of the realm's SAML service provider (RSA 3072,
# self-signed certificates valid 10 years) as the four Docker secrets read by
# keycloak-config (identity/keycloak/realm-oecp.yaml, `components`):
#
#   keycloak_saml_sig_key    keycloak_saml_sig_cert    signing (AuthnRequests)
#   keycloak_saml_enc_key    keycloak_saml_enc_cert    encryption (assertions)
#
# Each file is ONE line of base64 (key: PKCS#8 DER; certificate: X.509 DER),
# without PEM armor and without trailing newline, because keycloak-config-cli
# substitutes the file into the YAML text before parsing and Keycloak strips
# the PEM markers with a pattern that would swallow a folded single line.
#
# Usage (from anywhere inside the repository):
#
#   bash tools/scripts/gen-saml-keys.sh                    # into deploy/compose/secrets
#   bash tools/scripts/gen-saml-keys.sh --dir /srv/oecp/secrets
#   bash tools/scripts/gen-saml-keys.sh --subject '/O=Example/CN=auth.example.org'
#
# Options: --dir DIR; --subject DN (both certificates; default
# "/O=Open Alliance Course Catalogue/CN=OECP SAML signing" and "... encryption");
# --days N (default 3650); --bits N (default 3072, minimum 3072); --force.
#
# Existing files are never overwritten without --force: replacing a key pair
# changes the SAML metadata, which the federation and every partner IdP must
# receive again (docs/production/runbook.md, section 2). Keep an offline copy.

set -euo pipefail

dir=""
subject=""
days=3650
bits=3072
force=false

usage() {
  sed -n '17,25p' "$0" | sed 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir | --subject | --days | --bits)
      [ "$#" -ge 2 ] || { echo "$1 needs a value" >&2; exit 2; }
      case "$1" in
        --dir) dir=$2 ;;
        --subject) subject=$2 ;;
        --days) days=$2 ;;
        --bits) bits=$2 ;;
      esac
      shift
      ;;
    --force) force=true ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

case "$days" in '' | *[!0-9]*) echo "--days must be a number" >&2; exit 2 ;; esac
case "$bits" in '' | *[!0-9]*) echo "--bits must be a number" >&2; exit 2 ;; esac
[ "$bits" -ge 3072 ] || { echo "--bits must be at least 3072" >&2; exit 2; }
command -v openssl >/dev/null 2>&1 || { echo "openssl not found" >&2; exit 1; }

if [ -z "$dir" ]; then
  repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "Not inside the repository: pass --dir" >&2
    exit 1
  }
  dir="$repo_root/deploy/compose/secrets"
fi
[ -d "$dir" ] || { echo "Directory not found: $dir" >&2; exit 1; }

names="keycloak_saml_sig_key keycloak_saml_sig_cert keycloak_saml_enc_key keycloak_saml_enc_cert"
if [ "$force" != true ]; then
  for name in $names; do
    if [ -e "$dir/$name" ]; then
      echo "$dir/$name exists; use --force to replace the key pairs (the SAML metadata changes)" >&2
      exit 1
    fi
  done
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077

for use in sig enc; do
  dn=$subject
  if [ -z "$dn" ]; then
    case "$use" in
      sig) dn="/O=Open Alliance Course Catalogue/CN=OECP SAML signing" ;;
      *) dn="/O=Open Alliance Course Catalogue/CN=OECP SAML encryption" ;;
    esac
  fi
  openssl genpkey -algorithm RSA -pkeyopt "rsa_keygen_bits:$bits" -out "$work/$use.pem" 2>/dev/null
  openssl req -new -x509 -sha256 -days "$days" -key "$work/$use.pem" -subj "$dn" -out "$work/$use.crt"
  # PKCS#8 explicitly: `openssl pkey -outform DER` writes the PKCS#1 form on
  # OpenSSL 3.0 (Ubuntu 22.04/24.04) and PKCS#8 on LibreSSL and OpenSSL 3.6.
  # base64 + tr instead of `openssl base64 -A`: one line on BSD and GNU alike.
  openssl pkcs8 -topk8 -nocrypt -in "$work/$use.pem" -outform DER | base64 | tr -d '\n' >"$work/keycloak_saml_${use}_key"
  openssl x509 -in "$work/$use.crt" -outform DER | base64 | tr -d '\n' >"$work/keycloak_saml_${use}_cert"
done

for name in $names; do
  [ -s "$work/$name" ] || { echo "Generation of $name failed" >&2; exit 1; }
done
for name in $names; do
  mv -f "$work/$name" "$dir/$name"
  # Same convention as the other secrets: private directory, files readable by
  # the container users.
  chmod 644 "$dir/$name"
done

echo "Written to $dir:"
for use in sig enc; do
  fingerprint=$(base64 --decode <"$dir/keycloak_saml_${use}_cert" |
    openssl x509 -inform DER -noout -fingerprint -sha256 -enddate | tr '\n' ' ')
  echo "  $use: $fingerprint"
done
echo "Keep an offline copy of the four files. Registered certificates change with them."
