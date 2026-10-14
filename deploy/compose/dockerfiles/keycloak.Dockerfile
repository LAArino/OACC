# SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
# SPDX-License-Identifier: EUPL-1.2
#
# Optimised Keycloak 26 image (spec §4), required by `kc.sh start --optimized`:
# build-time options (database vendor, health and metrics endpoints) are baked
# in once here instead of being re-augmented at every start.
# Build context: deploy/compose/keycloak (contains entrypoint.sh only).
# EUPL-1.2 login themes from identity/keycloak/themes will be copied here later.

ARG KEYCLOAK_IMAGE=quay.io/keycloak/keycloak:26.8.1

FROM ${KEYCLOAK_IMAGE} AS builder
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true
WORKDIR /opt/keycloak
RUN /opt/keycloak/bin/kc.sh build

FROM ${KEYCLOAK_IMAGE}
LABEL org.opencontainers.image.title="oecp-keycloak" \
      org.opencontainers.image.licenses="Apache-2.0 AND EUPL-1.2"
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY --chmod=0555 entrypoint.sh /opt/oecp/entrypoint.sh
USER 1000
ENTRYPOINT ["/opt/oecp/entrypoint.sh"]
CMD ["start", "--optimized"]
