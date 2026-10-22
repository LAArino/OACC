# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# Image for apps/web (Nuxt 4: SSR public catalogue, client-rendered /admin).
# Nitro's node-server preset produces a self-contained `.output/` directory, so
# the runtime stage needs neither pnpm nor node_modules.
#
# Build context: repository root (pnpm workspace: root lockfile and packages/*).
#   docker build -f deploy/compose/dockerfiles/web.Dockerfile -t oecp/web .
# Runtime configuration through NUXT_* variables, e.g. NUXT_PUBLIC_API_BASE.

ARG NODE_IMAGE=node:22.23.3-alpine3.24

FROM ${NODE_IMAGE} AS toolchain
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /repo
COPY package.json ./
# pnpm 11+ downloads its native binary on first use: do it once, cached in this layer.
RUN corepack enable && corepack install && pnpm --version

FROM toolchain AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
ENV NODE_ENV=production
RUN pnpm -r --filter "@oecp/web..." run --if-present build

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
LABEL org.opencontainers.image.title="oecp-web" \
      org.opencontainers.image.description="Open Alliance Course Catalogue: public catalogue and admin dashboard" \
      org.opencontainers.image.licenses="EUPL-1.2"
WORKDIR /app
COPY --from=build /repo/apps/web/.output ./.output
USER 1000:1000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
