#!/bin/sh
# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# Entrypoint of the api/worker image. If DATABASE_PASSWORD_FILE is set (Docker
# secret), inject that password into DATABASE_URL, percent-encoded, so the
# password is not stored in compose files or `docker inspect` output.
set -eu

if [ -n "${DATABASE_PASSWORD_FILE:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  DATABASE_URL="$(node -e '
    const fs = require("node:fs");
    const url = new URL(process.env.DATABASE_URL);
    url.password = fs.readFileSync(process.env.DATABASE_PASSWORD_FILE, "utf8").trim();
    process.stdout.write(url.href);
  ')"
  export DATABASE_URL
  unset DATABASE_PASSWORD_FILE
fi

exec "$@"
