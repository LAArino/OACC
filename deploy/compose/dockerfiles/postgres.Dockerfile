# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# PostgreSQL 16 with pgBackRest (spec §10 "Backups"): one image for the
# `postgres` service (WAL archiving through archive_command), the `backup`
# service (profile `backup`: scheduled full/differential backups, uploads
# archive, textfile metrics) and the scratch container of
# scripts/restore-drill.sh. Same PostgreSQL minor as the upstream image it
# replaces, so an existing `postgres_data` volume starts unchanged.
#
# Build context: deploy/compose/postgres (bin/ holds the OACC helper scripts).
# Packages come from the PGDG apt repository already configured in the
# upstream image (pgBackRest, MIT) and from Debian (jq, MIT). Both are pinned:
# bump the ARGs when PGDG or a Debian security update replaces the version
# (the build then fails with "Version ... was not found").

ARG POSTGRES_IMAGE=postgres:16.15

FROM ${POSTGRES_IMAGE}

ARG PGBACKREST_VERSION=2.59.3-1.pgdg13+1
ARG JQ_VERSION=1.7.1-6+deb13u4

LABEL org.opencontainers.image.title="oecp-postgres" \
      org.opencontainers.image.description="PostgreSQL 16 with pgBackRest for OACC" \
      org.opencontainers.image.licenses="PostgreSQL AND MIT AND EUPL-1.2"

# hadolint ignore=DL3008
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        "pgbackrest=${PGBACKREST_VERSION}" \
        "jq=${JQ_VERSION}"; \
    rm -rf /var/lib/apt/lists/*; \
    # The package's sample /etc/pgbackrest.conf would be read when
    # /etc/pgbackrest/pgbackrest.conf is missing; Compose mounts the latter.
    rm -f /etc/pgbackrest.conf; \
    install -d -m 0755 /etc/pgbackrest; \
    # Repository (volume `pgbackrest-repo`), lock files, textfile metrics.
    install -d -o postgres -g postgres -m 0750 /var/lib/pgbackrest; \
    install -d -o postgres -g postgres -m 0750 /tmp/pgbackrest; \
    install -d -o postgres -g postgres -m 0755 /var/lib/oecp-backup-metrics; \
    pgbackrest version; \
    jq --version

# /usr/local/bin precedes /usr/bin in PATH: `pgbackrest` is the wrapper that
# loads /run/secrets/pgbackrest_* (see bin/pgbackrest), then runs /usr/bin/pgbackrest.
COPY --chmod=0555 bin/ /usr/local/bin/

# Non-root, as the upstream entrypoint expects when it is not started as root:
# the data directory and every volume above are owned by postgres (uid 999).
USER postgres
