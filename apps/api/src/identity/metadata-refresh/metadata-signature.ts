// SPDX-License-Identifier: EUPL-1.2
import { createHash, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DOMParser, type Element, MIME_TYPE } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { DS_NS, MD_NS } from './idp-metadata-refresh.constants.js';

/** The only profile accepted for aggregate signatures (eduGAIN / SAML metadata practice). */
export const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
export const ENVELOPED_SIGNATURE = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
export const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
export const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';

export class MetadataSignatureError extends Error {
  override readonly name = 'MetadataSignatureError';
}

export interface PinnedCertificate {
  pem: string;
  /** SHA-256 fingerprint, colon-separated hex as printed by OpenSSL. */
  fingerprint256: string;
  validTo: Date;
}

/** Reads the pinned signing certificate: exactly one PEM `CERTIFICATE` block, nothing else. */
export async function loadPinnedCertificate(path: string): Promise<PinnedCertificate> {
  const text = await readFile(path, 'utf8');
  const blocks = text.match(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g) ?? [];
  if (blocks.length !== 1 || !blocks[0]!.startsWith('-----BEGIN CERTIFICATE-----')) {
    throw new MetadataSignatureError(
      `${path} must contain exactly one PEM CERTIFICATE block (the federation signing certificate)`,
    );
  }
  const pem = `${blocks[0]}\n`;
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(pem);
  } catch (error) {
    throw new MetadataSignatureError(`${path}: invalid certificate (${(error as Error).message})`);
  }
  if (cert.publicKey.asymmetricKeyType !== 'rsa') {
    throw new MetadataSignatureError(`${path}: the pinned certificate must hold an RSA key`);
  }
  return { pem, fingerprint256: cert.fingerprint256, validTo: new Date(cert.validTo) };
}

export interface VerifiedSignature {
  sha256: string;
  bytes: number;
}

/**
 * Verifies the enveloped signature of a metadata file against the pinned
 * certificate only (KeyInfo is ignored), with a strict profile: one ds:Signature
 * as a direct child of the root; exclusive c14n for SignedInfo; RSA-SHA256; a
 * single SHA-256 Reference to the whole document (`""` or `#<root ID>`) whose
 * transforms are enveloped-signature and exclusive c14n only.
 *
 * xml-crypto needs the whole document as a string and a DOM (it canonicalises the
 * root element), so this step holds the file in memory once; extraction is done
 * afterwards by the streaming scanner on the same bytes (compared by SHA-256).
 */
export async function verifyMetadataSignature(
  path: string,
  pinned: PinnedCertificate,
): Promise<VerifiedSignature> {
  const raw = await readFile(path);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw new MetadataSignatureError('Metadata is not valid UTF-8');
  }
  if (/<!DOCTYPE/i.test(xml)) {
    throw new MetadataSignatureError('DOCTYPE declarations are not allowed in metadata');
  }
  checkSignature(xml, pinned);
  return { sha256, bytes: raw.length };
}

/** Synchronous core of {@link verifyMetadataSignature}, on a document string. */
export function checkSignature(xml: string, pinned: PinnedCertificate): void {
  const fail = (message: string): never => {
    throw new MetadataSignatureError(message);
  };
  let signatureXml: string;
  let rootId: string | null;
  {
    // Scoped so this DOM can be collected before xml-crypto parses its own.
    const root = parseStrict(xml, fail).documentElement;
    if (
      !root ||
      root.namespaceURI !== MD_NS ||
      (root.localName !== 'EntitiesDescriptor' && root.localName !== 'EntityDescriptor')
    ) {
      fail('Root element is not md:EntitiesDescriptor or md:EntityDescriptor');
    }
    const signatures: Element[] = [];
    for (let n = root!.firstChild; n; n = n.nextSibling) {
      const el = n as Element;
      if (n.nodeType === 1 && el.namespaceURI === DS_NS && el.localName === 'Signature') {
        signatures.push(el);
      }
    }
    if (signatures.length !== 1) {
      fail(`Expected one ds:Signature child of the root element, found ${signatures.length}`);
    }
    signatureXml = signatures[0]!.toString();
    rootId = root!.getAttribute('ID') || null;
  }

  const sig = new SignedXml({
    publicCert: pinned.pem,
    // Trust only the pinned certificate, never a key carried in the document.
    getCertFromKeyInfo: () => null,
  });
  try {
    sig.loadSignature(signatureXml);
  } catch (error) {
    fail(`Unreadable signature: ${(error as Error).message}`);
  }
  if (sig.canonicalizationAlgorithm !== EXC_C14N) {
    fail(`SignedInfo canonicalization ${sig.canonicalizationAlgorithm} is not exclusive c14n`);
  }
  if (sig.signatureAlgorithm !== RSA_SHA256) {
    fail(`Signature algorithm ${sig.signatureAlgorithm} is not RSA-SHA256`);
  }
  checkReferences(sig, rootId, fail);

  let valid: boolean;
  try {
    valid = sig.checkSignature(xml);
  } catch (error) {
    fail(`Signature verification failed: ${conciseXmlCryptoError(error as Error)}`);
  }
  if (!valid!) fail('Signature verification failed: digest or signature value mismatch');
  // References as re-read by checkSignature from the verified SignedInfo.
  checkReferences(sig, rootId, fail);
  if (sig.getSignedReferences().length !== 1) fail('Signature does not cover the document');
}

/**
 * xmldom 0.9 reports what it recovers from through `onError(level, message)`,
 * and only throws on its own for a `fatalError`; any diagnostic at any level
 * (`warning`, `error`, `fatalError`) aborts here, on the first one, except the
 * U+FFFD heuristic below. A throw from `onError` reaches the caller wrapped in
 * a `ParseError`, so the first diagnostic is recorded and reported instead.
 *
 * The one tolerated warning is the "Unicode replacement character detected"
 * hint: the bytes were already decoded as strict UTF-8, so a U+FFFD is a
 * literal, well-formed character of the signed content (e.g. a mis-encoded
 * display name upstream), not an encoding problem of this file.
 */
function parseStrict(xml: string, fail: (message: string) => never) {
  let diagnostic: string | undefined;
  try {
    return new DOMParser({
      onError: (level, message) => {
        if (level === 'warning' && message.startsWith('Unicode replacement character')) return;
        diagnostic = `${level}: ${message}`;
        throw new MetadataSignatureError(diagnostic);
      },
    }).parseFromString(xml, MIME_TYPE.XML_APPLICATION);
  } catch (error) {
    return fail(`Malformed XML: ${diagnostic ?? (error as Error).message}`);
  }
}

function checkReferences(
  sig: SignedXml,
  rootId: string | null,
  fail: (message: string) => never,
): void {
  const refs = sig.getReferences();
  if (refs.length !== 1) fail(`Expected one signature Reference, found ${refs.length}`);
  const ref = refs[0]!;
  const uri = ref.uri ?? '';
  if (!(uri === '' || (rootId !== null && uri === `#${rootId}`))) {
    fail(`Signature Reference ${uri} does not point at the root element`);
  }
  if (ref.digestAlgorithm !== SHA256)
    fail(`Digest algorithm ${ref.digestAlgorithm} is not SHA-256`);
  const transforms = [...ref.transforms];
  if (
    !transforms.includes(ENVELOPED_SIGNATURE) ||
    transforms.some((t) => t !== ENVELOPED_SIGNATURE && t !== EXC_C14N)
  ) {
    fail(`Unexpected signature transforms: ${transforms.join(', ') || 'none'}`);
  }
}

/** xml-crypto messages embed whole signature or digest values: keep them short for logs. */
function conciseXmlCryptoError(error: Error): string {
  if (/signature value .* is incorrect/s.test(error.message)) {
    return 'signature value does not verify with the pinned certificate';
  }
  if (/calculated digest is/.test(error.message)) {
    return 'reference digest mismatch (content altered after signing)';
  }
  return error.message.length > 300 ? `${error.message.slice(0, 300)}…` : error.message;
}
