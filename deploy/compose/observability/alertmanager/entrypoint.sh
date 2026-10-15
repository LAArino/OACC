#!/bin/sh
# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# Renders alertmanager.yml.tmpl (see its header) into the data volume and
# starts Alertmanager on it. Busybox sh/sed only (prom/alertmanager image).
#   sh entrypoint.sh --render-only <out>   renders and exits (for amtool).
set -eu

tmpl=/etc/alertmanager/oecp/alertmanager.yml.tmpl
out=/alertmanager/alertmanager.yml
render_only=
if [ "${1:-}" = "--render-only" ]; then render_only=1; out=${2:-/dev/stdout}; fi

# Value for a single-quoted YAML scalar ('' for '), escaped for sed (\ & |).
q() { printf '%s' "$1" | sed -e "s/'/''/g" -e 's/[\\&|]/\\&/g'; }

email=; smtpauth=; webhook=
if [ -n "${OECP_ALERT_EMAIL_TO:-}" ] && [ -n "${OECP_ALERT_SMTP_HOST:-}" ]; then email=1; fi
if [ -n "$email" ] && [ -n "${OECP_ALERT_SMTP_USER:-}" ]; then smtpauth=1; fi
if [ -n "${OECP_ALERT_WEBHOOK_URL:-}" ]; then webhook=1; fi
if [ -n "$smtpauth" ] && [ -z "${OECP_ALERT_SMTP_PASSWORD_FILE:-}" ]; then
  echo "alertmanager: OECP_ALERT_SMTP_USER needs OECP_ALERT_SMTP_PASSWORD_FILE (Docker secret alert_smtp_password)" >&2
  exit 1
fi
case "${OECP_ALERT_SMTP_REQUIRE_TLS:-true}" in
  true|false) ;;
  *) echo "alertmanager: OECP_ALERT_SMTP_REQUIRE_TLS must be true or false" >&2; exit 1 ;;
esac

keep() { # marker enabled
  if [ -n "$2" ]; then echo "s/[[:space:]]*# @$1\$//"; else echo "/# @$1\$/d"; fi
}

sed \
  -e "$(keep email "$email")" \
  -e "$(keep smtpauth "$smtpauth")" \
  -e "$(keep webhook "$webhook")" \
  -e "s|__SMTP_HOST__|$(q "${OECP_ALERT_SMTP_HOST:-}")|g" \
  -e "s|__SMTP_PORT__|$(q "${OECP_ALERT_SMTP_PORT:-25}")|g" \
  -e "s|__SMTP_REQUIRE_TLS__|${OECP_ALERT_SMTP_REQUIRE_TLS:-true}|g" \
  -e "s|__SMTP_USER__|$(q "${OECP_ALERT_SMTP_USER:-}")|g" \
  -e "s|__SMTP_PASSWORD_FILE__|$(q "${OECP_ALERT_SMTP_PASSWORD_FILE:-}")|g" \
  -e "s|__EMAIL_FROM__|$(q "${OECP_ALERT_EMAIL_FROM:-no-reply@example.org}")|g" \
  -e "s|__EMAIL_TO__|$(q "${OECP_ALERT_EMAIL_TO:-}")|g" \
  -e "s|__WEBHOOK_URL__|$(q "${OECP_ALERT_WEBHOOK_URL:-}")|g" \
  -e "s|__ENVIRONMENT__|$(q "${OECP_ENVIRONMENT:-local}")|g" \
  "$tmpl" > "$out"

[ -n "$render_only" ] && exit 0

echo "alertmanager: receivers: e-mail=${email:-off} webhook=${webhook:-off}" >&2
exec /bin/alertmanager \
  --config.file="$out" \
  --storage.path=/alertmanager \
  --cluster.listen-address= \
  "$@"
