# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# OEAPI v5.0 mock (simulated partner university) for local development only.
# No npm dependencies: the image is the Node base image plus three files.
FROM node:22.23.3-alpine3.24

WORKDIR /app
COPY --chown=root:root server.mjs healthcheck.mjs ./
COPY --chown=root:root data/ ./data/

ENV NODE_ENV=production \
    PORT=8090 \
    OEAPI_MOCK_DATASET=/app/data/uibk.json \
    OEAPI_MOCK_AUTH=none

# Unprivileged user of the base image (uid 1000); the files stay read-only to it.
USER node
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD ["node", "/app/healthcheck.mjs"]
CMD ["node", "/app/server.mjs"]
