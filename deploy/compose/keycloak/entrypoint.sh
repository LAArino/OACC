#!/bin/bash
# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# Keycloak reads no *_FILE variables natively: export each VAR from VAR_FILE
# (Docker secrets) and hand over to kc.sh.
set -euo pipefail

file_env() {
  local var="$1"
  local file_var="${var}_FILE"
  if [[ -n "${!file_var:-}" ]]; then
    if [[ -n "${!var:-}" ]]; then
      echo "entrypoint: both ${var} and ${file_var} are set" >&2
      exit 1
    fi
    export "${var}=$(< "${!file_var}")"
    unset "${file_var}"
  fi
}

file_env KC_DB_PASSWORD
file_env KC_BOOTSTRAP_ADMIN_PASSWORD

exec /opt/keycloak/bin/kc.sh "$@"
