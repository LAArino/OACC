// SPDX-License-Identifier: EUPL-1.2
/**
 * Memory-conscious reading of a SAML metadata aggregate: one streaming SAX pass
 * (saxes, strict, namespace-aware) that records the root element and builds a
 * small tree only for the `EntityDescriptor`s whose `entityID` is wanted. The
 * eduGAIN aggregate (tens of MB, ~10k entities) is never held as a DOM here.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import {
  BINDING_POST,
  BINDING_REDIRECT,
  DS_NS,
  MD_NS,
  SAML2_PROTOCOL,
} from './idp-metadata-refresh.constants.js';

/** Element of the reduced tree built for wanted entities. */
export interface XmlElement {
  uri: string;
  local: string;
  /** No-namespace attributes by local name; namespaced ones as `{uri}local`. */
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

export interface AggregateScan {
  rootLocal: 'EntitiesDescriptor' | 'EntityDescriptor';
  /** `ID` attribute of the root, the target of an enveloped signature `#ID` reference. */
  rootId: string | undefined;
  /** `validUntil` of the root element. */
  validUntil: Date | undefined;
  /** SHA-256 (hex) of the bytes read. */
  sha256: string;
  bytes: number;
  /** Number of EntityDescriptor elements in the aggregate. */
  entityCount: number;
  /** Wanted entities found, by entityID. */
  entities: Map<string, ScannedEntity>;
  /** Wanted entityIDs that occur more than once (never used: ambiguous). */
  duplicates: Set<string>;
}

export interface ScannedEntity {
  element: XmlElement;
  /** Earliest `validUntil` of the entity and its enclosing EntitiesDescriptors. */
  validUntil: Date | undefined;
}

export class MetadataFormatError extends Error {
  override readonly name = 'MetadataFormatError';
}

/** Parses an `xs:dateTime`; one without zone designator is read as UTC. */
export function parseXsDateTime(value: string): Date {
  const trimmed = value.trim();
  const zoned = /(Z|[+-]\d{2}:\d{2})$/.test(trimmed) ? trimmed : `${trimmed}Z`;
  const date = new Date(zoned);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed) || Number.isNaN(date.getTime())) {
    throw new MetadataFormatError(`Invalid xs:dateTime "${value}"`);
  }
  return date;
}

const earliest = (a: Date | undefined, b: Date | undefined): Date | undefined =>
  a && b ? (a <= b ? a : b) : (a ?? b);

/**
 * Streams `path` once. Rejects a DOCTYPE (no DTDs or entity tricks in metadata),
 * a non-UTF-8 encoding, malformed XML and a root other than md:EntitiesDescriptor
 * or md:EntityDescriptor.
 */
export async function scanAggregate(
  path: string,
  wanted: ReadonlySet<string>,
): Promise<AggregateScan> {
  const parser = new SaxesParser({ xmlns: true, position: false });
  const hash = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const result: Omit<AggregateScan, 'sha256' | 'bytes' | 'rootLocal'> & {
    rootLocal: AggregateScan['rootLocal'] | undefined;
  } = {
    rootLocal: undefined,
    rootId: undefined,
    validUntil: undefined,
    entityCount: 0,
    entities: new Map(),
    duplicates: new Set(),
  };
  let depth = 0;
  /** validUntil of the enclosing (non-captured) elements, one entry per open element. */
  const validStack: (Date | undefined)[] = [];
  /** Open elements of the entity being captured. */
  let capture: XmlElement[] = [];
  let captureEntity: { id: string; validUntil: Date | undefined } | undefined;

  parser.on('xmldecl', (decl) => {
    if (decl.encoding && decl.encoding.toLowerCase().replace('_', '-') !== 'utf-8') {
      throw new MetadataFormatError(`Unsupported encoding ${decl.encoding} (UTF-8 only)`);
    }
  });
  parser.on('doctype', () => {
    throw new MetadataFormatError('DOCTYPE declarations are not allowed in metadata');
  });
  parser.on('opentag', (tag: SaxesTagNS) => {
    depth += 1;
    const attrs = attributes(tag);
    if (depth === 1) {
      if (
        tag.uri !== MD_NS ||
        (tag.local !== 'EntitiesDescriptor' && tag.local !== 'EntityDescriptor')
      ) {
        throw new MetadataFormatError(
          `Root element is {${tag.uri}}${tag.local}, expected md:EntitiesDescriptor or md:EntityDescriptor`,
        );
      }
      result.rootLocal = tag.local;
      result.rootId = attrs.ID;
      result.validUntil = attrs.validUntil ? parseXsDateTime(attrs.validUntil) : undefined;
    }
    if (captureEntity) {
      const element: XmlElement = { uri: tag.uri, local: tag.local, attrs, children: [], text: '' };
      capture.at(-1)?.children.push(element);
      capture.push(element);
      return;
    }
    const own = attrs.validUntil && depth > 1 ? parseXsDateTime(attrs.validUntil) : undefined;
    const inherited = validStack.reduce<Date | undefined>((acc, d) => earliest(acc, d), undefined);
    if (tag.uri === MD_NS && tag.local === 'EntityDescriptor') {
      result.entityCount += 1;
      const id = attrs.entityID;
      if (id !== undefined && wanted.has(id)) {
        if (result.entities.has(id) || result.duplicates.has(id)) {
          result.duplicates.add(id);
          result.entities.delete(id);
        }
        captureEntity = { id, validUntil: earliest(inherited, own ?? result.validUntil) };
        capture = [{ uri: tag.uri, local: tag.local, attrs, children: [], text: '' }];
        return;
      }
    }
    validStack.push(depth === 1 ? result.validUntil : own);
  });
  const onText = (text: string) => {
    const current = capture.at(-1);
    if (captureEntity && current) current.text += text;
  };
  parser.on('text', onText);
  parser.on('cdata', onText);
  parser.on('closetag', () => {
    depth -= 1;
    if (!captureEntity) {
      validStack.pop();
      return;
    }
    const element = capture.pop();
    if (capture.length === 0 && element) {
      if (!result.duplicates.has(captureEntity.id)) {
        result.entities.set(captureEntity.id, { element, validUntil: captureEntity.validUntil });
      }
      captureEntity = undefined;
    }
  });

  let bytes = 0;
  try {
    for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      hash.update(buffer);
      parser.write(decoder.decode(buffer, { stream: true }));
    }
    parser.write(decoder.decode());
    parser.close();
  } catch (error) {
    if (error instanceof MetadataFormatError) throw error;
    if (error instanceof TypeError && /decode|encoded/i.test(error.message)) {
      throw new MetadataFormatError('Metadata is not valid UTF-8');
    }
    if ((error as NodeJS.ErrnoException).code) throw error;
    throw new MetadataFormatError(`Malformed XML: ${(error as Error).message}`);
  }
  if (!result.rootLocal) throw new MetadataFormatError('Empty document');
  return { ...result, rootLocal: result.rootLocal, sha256: hash.digest('hex'), bytes };
}

function attributes(tag: SaxesTagNS): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of Object.values(tag.attributes)) {
    if (attr.prefix === 'xmlns' || attr.name === 'xmlns') continue;
    out[attr.uri ? `{${attr.uri}}${attr.local}` : attr.local] = attr.value;
  }
  return out;
}

/** What the refresh needs from an IdP's EntityDescriptor. */
export interface IdpMetadata {
  entityId: string;
  /** Base64 DER, whitespace removed, de-duplicated, in document order. */
  signingCertificates: string[];
  sso: { post?: string; redirect?: string };
  slo: { post?: string; redirect?: string };
  nameIdFormats: string[];
}

const children = (el: XmlElement, uri: string, local: string): XmlElement[] =>
  el.children.filter((c) => c.uri === uri && c.local === local);

/**
 * Extracts the SAML 2.0 IDPSSODescriptor of an entity: signing certificates
 * (`KeyDescriptor` with `use="signing"` or without `use`), the first HTTP-POST and
 * HTTP-Redirect SingleSignOnService and SingleLogoutService locations, NameIDFormats.
 */
export function extractIdpMetadata(entity: XmlElement): IdpMetadata {
  const entityId = entity.attrs.entityID ?? '';
  const idp = children(entity, MD_NS, 'IDPSSODescriptor').find((d) =>
    (d.attrs.protocolSupportEnumeration ?? '').split(/\s+/).includes(SAML2_PROTOCOL),
  );
  if (!idp) {
    throw new MetadataFormatError(`Entity ${entityId} has no SAML 2.0 IDPSSODescriptor`);
  }
  const certificates: string[] = [];
  for (const kd of children(idp, MD_NS, 'KeyDescriptor')) {
    const use = kd.attrs.use;
    if (use !== undefined && use !== 'signing') continue;
    for (const keyInfo of children(kd, DS_NS, 'KeyInfo')) {
      for (const data of children(keyInfo, DS_NS, 'X509Data')) {
        for (const cert of children(data, DS_NS, 'X509Certificate')) {
          const b64 = cert.text.replace(/\s+/g, '');
          if (b64 && !certificates.includes(b64)) certificates.push(b64);
        }
      }
    }
  }
  const endpoints = (local: string) => {
    const found: { post?: string; redirect?: string } = {};
    for (const ep of children(idp, MD_NS, local)) {
      const location = ep.attrs.Location?.trim();
      if (!location) continue;
      if (ep.attrs.Binding === BINDING_POST) found.post ??= location;
      else if (ep.attrs.Binding === BINDING_REDIRECT) found.redirect ??= location;
    }
    return found;
  };
  return {
    entityId,
    signingCertificates: certificates,
    sso: endpoints('SingleSignOnService'),
    slo: endpoints('SingleLogoutService'),
    nameIdFormats: children(idp, MD_NS, 'NameIDFormat')
      .map((n) => n.text.trim())
      .filter(Boolean),
  };
}
