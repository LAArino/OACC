// SPDX-License-Identifier: EUPL-1.2
import type { Env } from '../../config/env.js';

export const IDP_METADATA_SETTINGS = Symbol('IDP_METADATA_SETTINGS');

/** Configuration of the `idp-metadata-refresh` job (see `OECP_IDP_METADATA_*` in env.ts). */
export interface IdpMetadataSettings {
  /** HTTPS aggregate URL; undefined = job not configured (no-op). */
  url: string | undefined;
  /** PEM file of the pinned aggregate signing certificate. */
  signingCertFile: string | undefined;
  requireValidUntil: boolean;
  cacheDir: string;
  maxBytes: number;
  includeDisabled: boolean;
  refreshOnStart: boolean;
}

export function idpMetadataSettingsFromEnv(
  get: <K extends keyof Env>(key: K) => Env[K],
): IdpMetadataSettings {
  return {
    url: get('OECP_IDP_METADATA_URL'),
    signingCertFile: get('OECP_IDP_METADATA_SIGNING_CERT_FILE'),
    requireValidUntil: get('OECP_IDP_METADATA_REQUIRE_VALID_UNTIL'),
    cacheDir: get('OECP_IDP_METADATA_CACHE_DIR'),
    maxBytes: get('OECP_IDP_METADATA_MAX_BYTES'),
    includeDisabled: get('OECP_IDP_METADATA_INCLUDE_DISABLED'),
    refreshOnStart: get('OECP_IDP_METADATA_REFRESH_ON_START'),
  };
}
