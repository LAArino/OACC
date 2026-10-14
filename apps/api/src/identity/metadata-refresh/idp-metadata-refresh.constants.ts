// SPDX-License-Identifier: EUPL-1.2

/** BullMQ queue, job name and job scheduler id of the daily refresh (spec §4). */
export const IDP_METADATA_REFRESH_QUEUE = 'idp-metadata-refresh';
export const IDP_METADATA_REFRESH_JOB = 'idp-metadata-refresh';
export const IDP_METADATA_REFRESH_SCHEDULER_ID = 'idp-metadata-refresh';
/** One-off run queued by the worker at start-up. */
export const IDP_METADATA_REFRESH_STARTUP_JOB_ID = 'idp-metadata-refresh-startup';
/** Daily at 04:15 UTC. */
export const IDP_METADATA_REFRESH_CRON = '15 4 * * *';

/** `audit_log.actor_sub` and `action` of an applied update. */
export const IDP_METADATA_REFRESH_ACTOR = 'system:metadata-refresh';
export const IDP_METADATA_REFRESH_AUDIT_ACTION = 'idp.metadata_refresh';

/** Download timeout (headers and body). */
export const AGGREGATE_FETCH_TIMEOUT_MS = 60_000;
/** The last good aggregate is reused at most this long after it was downloaded. */
export const AGGREGATE_MAX_STALENESS_MS = 7 * 24 * 60 * 60 * 1000;
/** Start-up runs reuse a cached aggregate younger than this instead of downloading. */
export const STARTUP_CACHE_REUSE_MS = 24 * 60 * 60 * 1000;
/** Warn when a kept signing certificate expires within this many days. */
export const CERT_EXPIRY_WARNING_DAYS = 30;

/** SAML 2.0 namespaces and identifiers. */
export const MD_NS = 'urn:oasis:names:tc:SAML:2.0:metadata';
export const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';
export const SAML2_PROTOCOL = 'urn:oasis:names:tc:SAML:2.0:protocol';
export const BINDING_POST = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
export const BINDING_REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
