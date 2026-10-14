# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# Image for apps/api, run as two processes (spec §3):
#   api     node dist/main.js     (HTTP, port 3000)
#   worker  node dist/worker.js   (BullMQ processors and schedules)
# plus one-off commands, e.g. `pnpm db:migrate` and `node dist/cli.js ...`.
#
# Build context: repository root (pnpm workspace: root lockfile and packages/*).
#   docker build -f deploy/compose/dockerfiles/api.Dockerfile -t oecp/api .
# The build context is filtered by api.Dockerfile.dockerignore next to this file.

ARG NODE_IMAGE=node:22.23.3-alpine3.24

# --- toolchain: Node + the pnpm version pinned in package.json#packageManager ---
FROM ${NODE_IMAGE} AS toolchain
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /repo
COPY package.json ./
RUN corepack enable \
 && corepack install \
 && chown -R node:node /corepack

# --- source: the filtered workspace -------------------------------------------
FROM toolchain AS source
COPY . .

# --- build: all dependencies, then compile api and the workspace packages it uses
FROM source AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm -r --filter "@oecp/api..." run --if-present build

# --- prod-deps: production dependencies of api and its workspace packages only --
FROM source AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@oecp/api..."

# --- runtime -------------------------------------------------------------------
FROM toolchain AS runtime
ENV NODE_ENV=production
LABEL org.opencontainers.image.title="oecp-api" \
      org.opencontainers.image.description="Open European Campus Portal: API and worker" \
      org.opencontainers.image.licenses="EUPL-1.2"
# Sources and production node_modules (files stay root-owned: read-only for the app).
COPY --from=prod-deps /repo /repo
# Compiled output of api and of the workspace packages (packages/*/dist).
COPY --from=build /repo/apps/api/dist /repo/apps/api/dist
COPY --from=build /repo/packages /repo/packages
COPY deploy/compose/dockerfiles/oecp-entrypoint.sh /usr/local/bin/oecp-entrypoint
RUN chmod 0555 /usr/local/bin/oecp-entrypoint \
 && mkdir -p /data/uploads \
 && chown node:node /data/uploads
USER 1000:1000
WORKDIR /repo/apps/api
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/oecp-entrypoint"]
CMD ["node", "dist/main.js"]
