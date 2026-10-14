// SPDX-License-Identifier: EUPL-1.2
/** Small SAML metadata aggregates for the idp-metadata-refresh tests, signed at test time. */
import { SignedXml } from 'xml-crypto';
import {
  ENVELOPED_SIGNATURE,
  EXC_C14N,
  RSA_SHA256,
  SHA256,
} from '../../src/identity/metadata-refresh/metadata-signature.js';
import type { TestCertificate } from './x509.js';

const POST = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

export interface FixtureEntity {
  entityId: string;
  /** Signing certificates (base64 DER); `use` omitted = usable for signing too. */
  signing: { der: string; use?: 'signing' }[];
  encryption?: string[];
  sso: { post?: string; redirect?: string };
  slo?: { post?: string; redirect?: string };
  nameIdFormats?: string[];
  validUntil?: Date;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function keyDescriptor(der: string, use?: string): string {
  return (
    `<md:KeyDescriptor${use ? ` use="${use}"` : ''}><ds:KeyInfo><ds:X509Data>` +
    `<ds:X509Certificate>\n${der.match(/.{1,64}/g)!.join('\n')}\n</ds:X509Certificate>` +
    `</ds:X509Data></ds:KeyInfo></md:KeyDescriptor>`
  );
}

function endpoints(local: string, eps: { post?: string; redirect?: string } | undefined): string {
  let out = '';
  if (eps?.redirect) out += `<md:${local} Binding="${REDIRECT}" Location="${esc(eps.redirect)}"/>`;
  if (eps?.post) out += `<md:${local} Binding="${POST}" Location="${esc(eps.post)}"/>`;
  return out;
}

export function entityXml(e: FixtureEntity): string {
  return (
    `<md:EntityDescriptor entityID="${esc(e.entityId)}"` +
    `${e.validUntil ? ` validUntil="${e.validUntil.toISOString()}"` : ''}>` +
    `<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">` +
    e.signing.map((c) => keyDescriptor(c.der, c.use)).join('') +
    (e.encryption ?? []).map((der) => keyDescriptor(der, 'encryption')).join('') +
    endpoints('SingleLogoutService', e.slo) +
    (e.nameIdFormats ?? []).map((f) => `<md:NameIDFormat>${f}</md:NameIDFormat>`).join('') +
    endpoints('SingleSignOnService', e.sso) +
    `</md:IDPSSODescriptor></md:EntityDescriptor>`
  );
}

/** An `md:EntitiesDescriptor` with `ID="_agg"`; `validUntil: null` omits the attribute. */
export function aggregateXml(
  entities: FixtureEntity[],
  options: { validUntil?: Date | null } = {},
): string {
  const validUntil =
    options.validUntil === undefined
      ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      : options.validUntil;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<md:EntitiesDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" ` +
    `xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ID="_agg" Name="urn:test:federation"` +
    `${validUntil ? ` validUntil="${validUntil.toISOString()}"` : ''}>\n` +
    entities.map(entityXml).join('\n') +
    `\n</md:EntitiesDescriptor>\n`
  );
}

/** Enveloped signature as first child of the root, exclusive c14n, RSA-SHA256 by default. */
export function signXml(
  xml: string,
  signer: TestCertificate,
  options: { signatureAlgorithm?: string; transforms?: string[] } = {},
): string {
  const sig = new SignedXml({
    privateKey: signer.keyPem,
    publicCert: signer.pem,
    signatureAlgorithm: (options.signatureAlgorithm ?? RSA_SHA256) as typeof RSA_SHA256,
    canonicalizationAlgorithm: EXC_C14N,
  });
  sig.addReference({
    xpath: '/*',
    transforms: (options.transforms ?? [ENVELOPED_SIGNATURE, EXC_C14N]) as never,
    digestAlgorithm: SHA256,
  });
  sig.computeSignature(xml, { prefix: 'ds', location: { reference: '/*', action: 'prepend' } });
  return sig.getSignedXml();
}
