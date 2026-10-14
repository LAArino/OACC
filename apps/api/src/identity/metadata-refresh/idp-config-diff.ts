// SPDX-License-Identifier: EUPL-1.2
import { createHash, X509Certificate } from 'node:crypto';
import { CERT_EXPIRY_WARNING_DAYS } from './idp-metadata-refresh.constants.js';
import type { IdpMetadata } from './saml-metadata.js';

/**
 * Keycloak SAML IdP config keys this job may write. Everything else (flows,
 * principal type, NameID policy, hideOnLogin, signing/encryption policy...) is
 * declared in realm-oecp.yaml and never touched.
 */
export const MANAGED_KEYS = [
  'signingCertificate',
  'singleSignOnServiceUrl',
  'postBindingAuthnRequest',
  'singleLogoutServiceUrl',
  'postBindingLogout',
] as const;
export type ManagedKey = (typeof MANAGED_KEYS)[number];

/** Desired value per managed key; `null` = remove the key (e.g. SLO no longer declared). */
export type DesiredConfig = Partial<Record<ManagedKey, string | null>>;

export interface CertificateInfo {
  /** Base64 DER. */
  der: string;
  fingerprint256: string;
  subject: string;
  notBefore: Date;
  notAfter: Date;
}

export interface DesiredConfigResult {
  desired: DesiredConfig;
  warnings: string[];
  /** Certificates kept, for audit (fingerprints only). */
  certificates: CertificateInfo[];
}

export class MetadataPolicyError extends Error {
  override readonly name = 'MetadataPolicyError';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** SHA-256 over the DER, colon-separated upper-case hex (OpenSSL style). */
export function derFingerprint(der: string): string {
  return createHash('sha256')
    .update(Buffer.from(der, 'base64'))
    .digest('hex')
    .toUpperCase()
    .replace(/(..)(?!$)/g, '$1:');
}

const shortFp = (fp: string) => fp.slice(0, 23);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Parses certificates, drops unparsable and expired ones (Keycloak 26.8 ignores
 * an expired IdP certificate) and warns about those expiring within 30 days or
 * not yet valid (kept: published ahead of a key rollover).
 */
export function usableCertificates(
  ders: readonly string[],
  now: Date,
  warnings: string[],
): CertificateInfo[] {
  const kept: CertificateInfo[] = [];
  for (const der of ders) {
    let cert: X509Certificate;
    try {
      cert = new X509Certificate(Buffer.from(der, 'base64'));
    } catch {
      warnings.push('Dropped an unparsable signing certificate');
      continue;
    }
    const info: CertificateInfo = {
      der,
      fingerprint256: cert.fingerprint256,
      subject: cert.subject.replace(/\n/g, ', '),
      notBefore: new Date(cert.validFrom),
      notAfter: new Date(cert.validTo),
    };
    if (info.notAfter <= now) {
      warnings.push(
        `Dropped expired signing certificate ${shortFp(info.fingerprint256)} (expired ${isoDay(info.notAfter)})`,
      );
      continue;
    }
    if (info.notBefore > now) {
      warnings.push(
        `Signing certificate ${shortFp(info.fingerprint256)} is not valid before ${isoDay(info.notBefore)}`,
      );
    } else if (info.notAfter.getTime() - now.getTime() <= CERT_EXPIRY_WARNING_DAYS * DAY_MS) {
      warnings.push(
        `Signing certificate ${shortFp(info.fingerprint256)} expires on ${isoDay(info.notAfter)}`,
      );
    }
    kept.push(info);
  }
  return kept;
}

/**
 * Target values of the managed keys for an IdP, from its metadata and the
 * current Keycloak config (whose binding flags decide the preferred binding:
 * POST unless `postBinding*` is "false"). Throws {@link MetadataPolicyError} when
 * the metadata cannot yield a working configuration (no usable certificate, no
 * SSO endpoint): the current configuration is then kept.
 */
export function desiredConfig(
  metadata: IdpMetadata,
  current: Readonly<Record<string, string | undefined>>,
  now: Date,
): DesiredConfigResult {
  const warnings: string[] = [];
  if (metadata.signingCertificates.length === 0) {
    throw new MetadataPolicyError('Metadata declares no signing certificate');
  }
  const certificates = usableCertificates(metadata.signingCertificates, now, warnings);
  if (!certificates.some((c) => c.notBefore <= now)) {
    throw new MetadataPolicyError('Metadata has no currently valid signing certificate');
  }
  const desired: DesiredConfig = {
    signingCertificate: certificates.map((c) => c.der).join(','),
  };

  const sso = pickEndpoint(metadata.sso, current.postBindingAuthnRequest !== 'false');
  if (!sso) {
    throw new MetadataPolicyError('Metadata has no HTTP-POST or HTTP-Redirect SingleSignOnService');
  }
  if (sso.switched) {
    warnings.push(
      `SingleSignOnService: configured binding not offered, using HTTP-${sso.post ? 'POST' : 'Redirect'}`,
    );
  }
  desired.singleSignOnServiceUrl = sso.location;
  desired.postBindingAuthnRequest = String(sso.post);

  const slo = pickEndpoint(metadata.slo, current.postBindingLogout !== 'false');
  if (slo) {
    if (slo.switched && current.singleLogoutServiceUrl) {
      warnings.push(
        `SingleLogoutService: configured binding not offered, using HTTP-${slo.post ? 'POST' : 'Redirect'}`,
      );
    }
    desired.singleLogoutServiceUrl = slo.location;
    desired.postBindingLogout = String(slo.post);
  } else {
    // Keycloak rejects an empty value: the key is removed.
    desired.singleLogoutServiceUrl = null;
  }

  const policy = current.nameIDPolicyFormat;
  if (policy && metadata.nameIdFormats.length > 0 && !metadata.nameIdFormats.includes(policy)) {
    warnings.push(
      `NameID policy ${policy} is not among the IdP's NameIDFormats (${metadata.nameIdFormats.join(', ')})`,
    );
  }
  if (current.validateSignature !== 'true') {
    warnings.push('validateSignature is not "true" for this IdP');
  }
  return { desired, warnings, certificates };
}

function pickEndpoint(
  endpoints: { post?: string; redirect?: string },
  preferPost: boolean,
): { location: string; post: boolean; switched: boolean } | undefined {
  const preferred = preferPost ? endpoints.post : endpoints.redirect;
  if (preferred) return { location: preferred, post: preferPost, switched: false };
  const other = preferPost ? endpoints.redirect : endpoints.post;
  if (other) return { location: other, post: !preferPost, switched: true };
  return undefined;
}

const certSet = (value: string | undefined) =>
  new Set(
    (value ?? '')
      .split(',')
      .map((c) => c.replace(/\s+/g, ''))
      .filter(Boolean),
  );

/**
 * Keys whose desired value differs from the current config. Certificates are
 * compared as a set (order and whitespace do not matter); a `null` desired value
 * differs only when the key is present.
 */
export function changedKeys(
  current: Readonly<Record<string, string | undefined>>,
  desired: DesiredConfig,
): ManagedKey[] {
  const changed: ManagedKey[] = [];
  for (const key of MANAGED_KEYS) {
    if (!(key in desired)) continue;
    const want = desired[key];
    const have = current[key];
    if (want === null) {
      if (have !== undefined) changed.push(key);
    } else if (key === 'signingCertificate') {
      const a = certSet(have);
      const b = certSet(want);
      if (a.size !== b.size || [...a].some((c) => !b.has(c))) changed.push(key);
    } else if ((have ?? '').trim() !== want) {
      changed.push(key);
    }
  }
  return changed;
}

/** The current config with only `keys` set to their desired values. */
export function applyChanges(
  current: Readonly<Record<string, string>>,
  desired: DesiredConfig,
  keys: readonly ManagedKey[],
): Record<string, string> {
  const next: Record<string, string> = { ...current };
  for (const key of keys) {
    const value = desired[key];
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Audit-safe description of a change (URLs, flags and certificate fingerprints only). */
export function describeChange(
  key: ManagedKey,
  current: Readonly<Record<string, string | undefined>>,
  desired: DesiredConfig,
): { before: unknown; after: unknown } {
  if (key === 'signingCertificate') {
    return {
      before: [...certSet(current[key])].map(derFingerprint),
      after: [...certSet(desired[key] ?? undefined)].map(derFingerprint),
    };
  }
  return { before: current[key] ?? null, after: desired[key] ?? null };
}
