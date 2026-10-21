#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
//
// Multi-ACS SAML SP metadata of the OECP realm: one EntityDescriptor with an
// Assertion Consumer Service per partner IdP alias, for the federation
// registration (SIR/RedIRIS, eduGAIN; spec §4). User documentation:
// identity/keycloak/scripts/sp-metadata.md. No dependencies (Node 22).
//
//   node tools/scripts/sp-metadata.mjs --auth-host auth.example.org \
//     --config identity/keycloak/sp-metadata.config.yaml --out sp-metadata.xml
//
// Certificates come from the Docker secrets created by gen-saml-keys.sh
// (works before the server exists) or, with --keycloak-url and a token in
// KEYCLOAK_ADMIN_TOKEN or --token-file, from the live realm's Admin API.

import { X509Certificate, createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const CATEGORY_PERSONALIZED = 'https://refeds.org/category/personalized';
export const CATEGORY_COCO_V2 = 'https://refeds.org/category/code-of-conduct/v2';
export const ASSURANCE_SIRTFI = 'https://refeds.org/sirtfi';
const CATEGORY_RS = 'http://refeds.org/category/research-and-scholarship';

const NS = {
  md: 'urn:oasis:names:tc:SAML:2.0:metadata',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  saml: 'urn:oasis:names:tc:SAML:2.0:assertion',
  mdattr: 'urn:oasis:names:tc:SAML:metadata:attribute',
  mdui: 'urn:oasis:names:tc:SAML:metadata:ui',
  remd: 'http://refeds.org/metadata',
};

const BINDING_POST = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const BINDING_REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
const NAMEID_TRANSIENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';
const ATTR_NAME_FORMAT_URI = 'urn:oasis:names:tc:SAML:2.0:attrname-format:uri';

// Spec §4: attributes released by the partner IdP. subject-id and pairwise-id
// are alternatives (one is configured per IdP), so neither is mandatory alone.
export const REQUESTED_ATTRIBUTES = [
  {
    friendlyName: 'subject-id',
    name: 'urn:oasis:names:tc:SAML:attribute:subject-id',
    required: false,
  },
  {
    friendlyName: 'pairwise-id',
    name: 'urn:oasis:names:tc:SAML:attribute:pairwise-id',
    required: false,
  },
  { friendlyName: 'mail', name: 'urn:oid:0.9.2342.19200300.100.1.3', required: true },
  {
    friendlyName: 'schacHomeOrganization',
    name: 'urn:oid:1.3.6.1.4.1.25178.1.2.9',
    required: true,
  },
  { friendlyName: 'displayName', name: 'urn:oid:2.16.840.1.113730.3.1.241', required: true },
  { friendlyName: 'givenName', name: 'urn:oid:2.5.4.42', required: true },
  { friendlyName: 'sn', name: 'urn:oid:2.5.4.4', required: true },
];

/** Error with a message meant for the operator (no stack trace). */
export class UsageError extends Error {}

// ---------------------------------------------------------------------------
// YAML subset (the config file only): block maps and lists, plain and quoted
// scalars, flow lists of scalars, comments. Anything else is rejected.
// ---------------------------------------------------------------------------

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      if (i === 0 || /[\s[,:-]/.test(line[i - 1] ?? ' ')) quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(text, lineNo) {
  const t = text.trim();
  if (t === '') return null;
  if (t.startsWith('"')) {
    if (!t.endsWith('"') || t.length < 2)
      throw new UsageError(`line ${lineNo}: unterminated string`);
    return t.slice(1, -1).replace(/\\(["\\nt/])/g, (_, ch) => ({ n: '\n', t: '\t' })[ch] ?? ch);
  }
  if (t.startsWith("'")) {
    if (!t.endsWith("'") || t.length < 2)
      throw new UsageError(`line ${lineNo}: unterminated string`);
    return t.slice(1, -1).replaceAll("''", "'");
  }
  if (t.startsWith('[')) {
    if (!t.endsWith(']')) throw new UsageError(`line ${lineNo}: flow lists must fit on one line`);
    const inner = t.slice(1, -1).trim();
    return inner === '' ? [] : splitFlow(inner, lineNo).map((item) => parseScalar(item, lineNo));
  }
  if (/^[{|>&*!]/.test(t))
    throw new UsageError(`line ${lineNo}: unsupported YAML syntax "${t[0]}"`);
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+$/.test(t)) return Number(t);
  return t;
}

function splitFlow(inner, lineNo) {
  const items = [];
  let current = '';
  let quote = null;
  for (const c of inner) {
    if (quote) {
      current += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      current += c;
    } else if (c === ',') {
      items.push(current);
      current = '';
    } else current += c;
  }
  if (quote) throw new UsageError(`line ${lineNo}: unterminated string`);
  items.push(current);
  return items;
}

export function parseYamlSubset(text) {
  const lines = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const stripped = stripComment(raw).replace(/\s+$/, '');
    if (stripped.trim() === '') return;
    if (/^\t/.test(stripped)) throw new UsageError(`line ${i + 1}: tabs are not allowed`);
    lines.push({
      no: i + 1,
      indent: stripped.length - stripped.trimStart().length,
      text: stripped.trim(),
    });
  });
  let pos = 0;

  const keyOf = (text, no) => {
    const m = /^("[^"]*"|'[^']*'|[^\s:#"'][^:]*?)\s*:(?:\s+(.*))?$/.exec(text);
    if (!m) throw new UsageError(`line ${no}: expected "key: value"`);
    return { key: String(parseScalar(m[1], no)), rest: m[2] ?? '' };
  };

  function parseBlock(indent) {
    const first = lines[pos];
    if (!first) return null;
    if (first.text === '-' || first.text.startsWith('- ')) return parseList(indent);
    return parseMap(indent);
  }

  function parseMap(indent, firstEntry) {
    const map = {};
    let pending = firstEntry;
    for (;;) {
      let line;
      if (pending) {
        line = pending;
        pending = null;
      } else {
        line = lines[pos];
        if (!line || line.indent < indent) break;
        if (line.indent > indent) throw new UsageError(`line ${line.no}: unexpected indentation`);
        pos++;
      }
      const { key, rest } = keyOf(line.text, line.no);
      if (Object.hasOwn(map, key)) throw new UsageError(`line ${line.no}: duplicate key "${key}"`);
      if (rest !== '') map[key] = parseScalar(rest, line.no);
      else {
        const next = lines[pos];
        if (
          next &&
          (next.indent > indent || (next.indent === indent && next.text.startsWith('- ')))
        ) {
          map[key] = parseBlock(next.indent);
        } else map[key] = null;
      }
    }
    return map;
  }

  function parseList(indent) {
    const list = [];
    for (;;) {
      const line = lines[pos];
      if (!line || line.indent < indent || !(line.text === '-' || line.text.startsWith('- ')))
        break;
      if (line.indent > indent) throw new UsageError(`line ${line.no}: unexpected indentation`);
      pos++;
      const rest = line.text.slice(1).trim();
      if (rest === '') {
        const next = lines[pos];
        list.push(next && next.indent > indent ? parseBlock(next.indent) : null);
      } else if (/^("[^"]*"|'[^']*'|[^\s:#"'[][^:]*?)\s*:(\s|$)/.test(rest)) {
        // "- key: value": the item is a map whose keys start two columns in.
        list.push(parseMap(indent + 2, { no: line.no, indent: indent + 2, text: rest }));
      } else list.push(parseScalar(rest, line.no));
    }
    return list;
  }

  if (lines.length === 0) return {};
  const result = parseBlock(lines[0].indent);
  if (pos < lines.length) throw new UsageError(`line ${lines[pos].no}: unexpected content`);
  return result;
}

// ---------------------------------------------------------------------------
// Realm file: enabled IdP aliases
// ---------------------------------------------------------------------------

/**
 * Aliases of `identityProviders` in realm-oecp.yaml with their `enabled`
 * state, after keycloak-config-cli's env substitution ($(env:NAME:-default)).
 * Reads the block line by line instead of parsing the whole realm file.
 */
export function readRealmProviders(realmText, env = process.env) {
  const lines = realmText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^identityProviders:\s*(#.*)?$/.test(l));
  if (start < 0) throw new UsageError('realm file has no top-level "identityProviders:" block');
  const providers = [];
  let itemIndent = null;
  let current = null;
  for (const raw of lines.slice(start + 1)) {
    if (/^\S/.test(raw) && !raw.startsWith('#')) break;
    const line = stripComment(raw);
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const alias = /^(\s*)- alias:\s*(.+?)\s*$/.exec(line);
    if (alias && (itemIndent === null || indent === itemIndent)) {
      itemIndent = indent;
      current = { alias: String(parseScalar(alias[2], 0)), enabled: true };
      providers.push(current);
    } else if (current && itemIndent !== null && indent === itemIndent + 2) {
      const enabled = /^\s*enabled:\s*(.+?)\s*$/.exec(line);
      if (enabled)
        current.enabled = resolveBoolean(String(parseScalar(enabled[1], 0)), env, current.alias);
    }
  }
  if (providers.length === 0) throw new UsageError('no identity provider found in the realm file');
  return providers;
}

function resolveBoolean(value, env, alias) {
  const substituted = value.replace(
    /\$\(env:([A-Za-z0-9_]+)(?::-([^)]*))?\)/g,
    (_, name, fallback) => {
      const v = env[name];
      if (v !== undefined && v !== '') return v;
      if (fallback !== undefined) return fallback;
      throw new UsageError(`"enabled" of IdP "${alias}" uses undefined variable ${name}`);
    },
  );
  if (substituted === 'true') return true;
  if (substituted === 'false') return false;
  throw new UsageError(`"enabled" of IdP "${alias}" is "${substituted}", expected true or false`);
}

// ---------------------------------------------------------------------------
// Stable ACS indexes (append-only)
// ---------------------------------------------------------------------------

/**
 * Index of every alias, never changing once assigned. `existing` is the parsed
 * indexes file ({alias: index}); new aliases get max(index) + 1 in the order
 * given. Returns the full map and the aliases that were added.
 */
export function assignIndexes(existing, aliases) {
  const map = { ...existing };
  for (const [alias, index] of Object.entries(map)) {
    if (!Number.isInteger(index) || index < 0 || index > 65534) {
      throw new UsageError(`indexes file: "${alias}" has an invalid index ${index}`);
    }
  }
  const used = Object.values(map);
  if (new Set(used).size !== used.length)
    throw new UsageError('indexes file: two aliases share an index');
  const added = [];
  let next = used.length === 0 ? 0 : Math.max(...used) + 1;
  for (const alias of aliases) {
    if (Object.hasOwn(map, alias)) continue;
    map[alias] = next++;
    added.push(alias);
  }
  return { map, added };
}

export function serializeIndexes(map) {
  const sorted = Object.entries(map).sort((a, b) => a[1] - b[1]);
  return `${JSON.stringify(Object.fromEntries(sorted), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

function toPem(text) {
  const body = text.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new UsageError('certificate is not base64');
  return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}

/** Keycloak's key id (`kid`, the KeyName of its descriptors): SHA-256 of the public key's SubjectPublicKeyInfo. */
function keyId(publicKey) {
  return createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64url');
}

/** Facts about a certificate given as PEM or as the bare base64 DER of the secrets. */
export function certificateInfo(text, now = new Date()) {
  let cert;
  try {
    cert = new X509Certificate(toPem(text));
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`not an X.509 certificate: ${error.message}`);
  }
  const key = cert.publicKey;
  if (key.asymmetricKeyType !== 'rsa') throw new UsageError('certificate does not hold an RSA key');
  const kid = keyId(key);
  const validTo = new Date(cert.validTo);
  return {
    base64: cert.raw.toString('base64'),
    kid,
    bits: key.asymmetricKeyDetails?.modulusLength ?? 0,
    validFrom: new Date(cert.validFrom),
    validTo,
    daysLeft: Math.floor((validTo.getTime() - now.getTime()) / 86_400_000),
    fingerprint256: cert.fingerprint256,
    subject: cert.subject.replace(/\n/g, ', '),
    publicKey: key,
  };
}

/** Throws if the private key (bare base64 PKCS#8 or PEM) does not belong to the certificate. */
export function assertKeyMatchesCertificate(keyText, certInfo, label) {
  let privateKey;
  try {
    const body = keyText.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
    privateKey = createPrivateKey({
      key: Buffer.from(body, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
  } catch {
    throw new UsageError(`${label}: the private key file is not a base64 PKCS#8 key`);
  }
  if (keyId(createPublicKey(privateKey)) !== certInfo.kid)
    throw new UsageError(`${label}: the private key does not match the certificate`);
}

// ---------------------------------------------------------------------------
// Configuration (identity/keycloak/sp-metadata.config.yaml)
// ---------------------------------------------------------------------------

const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;
const CONTACT_TYPES = ['technical', 'support', 'administrative', 'billing', 'other'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isHttpsUrl = (v) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

function langMap(value, label, errors, { url = false } = {}) {
  if (!isObject(value) || Object.keys(value).length === 0) {
    errors.push(`${label}: a map of language code to text is required`);
    return {};
  }
  if (typeof value.en !== 'string' || value.en.trim() === '')
    errors.push(`${label}: the "en" entry is required`);
  for (const [lang, text] of Object.entries(value)) {
    if (!LANG.test(lang)) errors.push(`${label}: "${lang}" is not a language code`);
    else if (typeof text !== 'string' || text.trim() === '')
      errors.push(`${label}.${lang}: text is required`);
    else if (url && !isHttpsUrl(text)) errors.push(`${label}.${lang}: must be an https URL`);
  }
  return value;
}

/** Validates the parsed config; returns the normalized model or throws with all problems. */
export function normalizeConfig(raw) {
  const errors = [];
  if (!isObject(raw)) throw new UsageError('config file is empty');

  const org = isObject(raw.organization) ? raw.organization : {};
  if (!isObject(raw.organization)) errors.push('organization: section is required');
  const organization = {
    name: langMap(org.name, 'organization.name', errors),
    displayName: langMap(org.displayName, 'organization.displayName', errors),
    url: langMap(org.url, 'organization.url', errors, { url: true }),
  };

  const ui = isObject(raw.mdui) ? raw.mdui : {};
  if (!isObject(raw.mdui)) errors.push('mdui: section is required');
  const logo = isObject(ui.logo) ? ui.logo : {};
  if (!isHttpsUrl(logo.url)) errors.push('mdui.logo.url: an https URL is required');
  for (const dim of ['width', 'height']) {
    if (!Number.isInteger(logo[dim]) || logo[dim] <= 0)
      errors.push(`mdui.logo.${dim}: a positive integer is required`);
  }
  const mdui = {
    displayName: langMap(ui.displayName, 'mdui.displayName', errors),
    description: langMap(ui.description, 'mdui.description', errors),
    informationUrl: langMap(ui.informationUrl, 'mdui.informationUrl', errors, { url: true }),
    privacyStatementUrl: langMap(ui.privacyStatementUrl, 'mdui.privacyStatementUrl', errors, {
      url: true,
    }),
    logo: { url: logo.url, width: logo.width, height: logo.height },
  };

  const contacts = [];
  if (!Array.isArray(raw.contacts)) errors.push('contacts: a list is required');
  for (const [i, c] of (Array.isArray(raw.contacts) ? raw.contacts : []).entries()) {
    const label = `contacts[${i}]`;
    if (!isObject(c)) {
      errors.push(`${label}: a map is required`);
      continue;
    }
    const type = c.type === 'security' ? 'security' : c.type;
    if (type !== 'security' && !CONTACT_TYPES.includes(type)) {
      errors.push(`${label}.type: one of ${[...CONTACT_TYPES, 'security'].join(', ')}`);
    }
    if (typeof c.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
      errors.push(`${label}.email: a valid address is required`);
    }
    if (typeof c.givenName !== 'string' && typeof c.company !== 'string') {
      errors.push(`${label}: givenName (with surName) or company is required`);
    }
    contacts.push({
      type,
      company: c.company ?? null,
      givenName: c.givenName ?? null,
      surName: c.surName ?? null,
      email: c.email,
    });
  }
  for (const needed of ['technical', 'support', 'security']) {
    if (!contacts.some((c) => c.type === needed))
      errors.push(`contacts: a "${needed}" contact is required (Sirtfi needs "security")`);
  }

  const categories = raw.entityCategories ?? [CATEGORY_PERSONALIZED, CATEGORY_COCO_V2];
  if (!Array.isArray(categories) || categories.some((c) => typeof c !== 'string')) {
    errors.push('entityCategories: a list of URIs');
  } else {
    if (categories.includes(CATEGORY_RS))
      errors.push('entityCategories: Research and Scholarship must not be requested (spec §4)');
    for (const required of [CATEGORY_PERSONALIZED, CATEGORY_COCO_V2]) {
      if (!categories.includes(required))
        errors.push(`entityCategories: ${required} is required (spec §4)`);
    }
  }
  const assurance = raw.assuranceCertification ?? [ASSURANCE_SIRTFI];
  if (!Array.isArray(assurance) || !assurance.includes(ASSURANCE_SIRTFI)) {
    errors.push(`assuranceCertification: must include ${ASSURANCE_SIRTFI}`);
  }

  const reserveAliases = raw.reserveAliases ?? [];
  if (
    !Array.isArray(reserveAliases) ||
    reserveAliases.some((a) => typeof a !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(a))
  ) {
    errors.push('reserveAliases: a list of IdP aliases (lowercase letters, digits, hyphens)');
  }

  if (raw.entityId !== undefined && raw.entityId !== null && !isHttpsUrl(raw.entityId)) {
    errors.push('entityId: an https URL when set');
  }

  if (errors.length > 0) throw new UsageError(`config file:\n  - ${errors.join('\n  - ')}`);
  return {
    entityId: raw.entityId ?? null,
    organization,
    mdui,
    contacts,
    entityCategories: categories,
    assuranceCertification: assurance,
    reserveAliases,
  };
}

// ---------------------------------------------------------------------------
// XML output
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const langElements = (tag, map, indent) =>
  Object.entries(map)
    .map(([lang, text]) => `${indent}<${tag} xml:lang="${esc(lang)}">${esc(text)}</${tag}>`)
    .join('\n');

function keyDescriptor(use, cert) {
  const wrapped = cert.base64.match(/.{1,76}/g).join('\n');
  const encryption =
    use === 'encryption'
      ? `
      <md:EncryptionMethod Algorithm="http://www.w3.org/2009/xmlenc11#rsa-oaep"/>
      <md:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p"/>`
      : '';
  return `    <md:KeyDescriptor use="${use}">
      <ds:KeyInfo>
        <ds:KeyName>${esc(cert.kid)}</ds:KeyName>
        <ds:X509Data>
          <ds:X509Certificate>
${wrapped}
          </ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>${encryption}
    </md:KeyDescriptor>`;
}

function contactPerson(c) {
  const type = c.type === 'security' ? 'other' : c.type;
  const extra =
    c.type === 'security'
      ? ' remd:contactType="http://refeds.org/metadata/contactType/security"'
      : '';
  const parts = [];
  if (c.company) parts.push(`      <md:Company>${esc(c.company)}</md:Company>`);
  if (c.givenName) parts.push(`      <md:GivenName>${esc(c.givenName)}</md:GivenName>`);
  if (c.surName) parts.push(`      <md:SurName>${esc(c.surName)}</md:SurName>`);
  parts.push(`      <md:EmailAddress>mailto:${esc(c.email)}</md:EmailAddress>`);
  return `  <md:ContactPerson contactType="${type}"${extra}>\n${parts.join('\n')}\n  </md:ContactPerson>`;
}

/**
 * The EntityDescriptor. `model`: { authHost, realm, config, indexes, sigCerts,
 * encCerts, aliases }, certificates as returned by certificateInfo().
 */
export function buildMetadata(model) {
  const { authHost, realm, config, indexes, sigCerts, encCerts, aliases } = model;
  const base = `https://${authHost}/realms/${realm}`;
  const entityId = config.entityId ?? base;
  const sorted = [...aliases].sort((a, b) => indexes[a] - indexes[b]);
  const acs = sorted
    .map(
      (alias, i) =>
        `    <md:AssertionConsumerService Binding="${BINDING_POST}" Location="${esc(`${base}/broker/${alias}/endpoint`)}" index="${indexes[alias]}"${i === 0 ? ' isDefault="true"' : ''}/>`,
    )
    .join('\n');
  const slo = sorted
    .flatMap((alias) =>
      [BINDING_POST, BINDING_REDIRECT].map(
        (binding) =>
          `    <md:SingleLogoutService Binding="${binding}" Location="${esc(`${base}/broker/${alias}/endpoint`)}"/>`,
      ),
    )
    .join('\n');
  const attributes = REQUESTED_ATTRIBUTES.map(
    (a) =>
      `      <md:RequestedAttribute FriendlyName="${a.friendlyName}" Name="${a.name}" NameFormat="${ATTR_NAME_FORMAT_URI}"${a.required ? ' isRequired="true"' : ''}/>`,
  ).join('\n');
  const values = (list) =>
    list.map((v) => `        <saml:AttributeValue>${esc(v)}</saml:AttributeValue>`).join('\n');
  const { mdui } = config;
  const logo = `        <mdui:Logo height="${mdui.logo.height}" width="${mdui.logo.width}">${esc(mdui.logo.url)}</mdui:Logo>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="${NS.md}" xmlns:ds="${NS.ds}" xmlns:saml="${NS.saml}" xmlns:mdattr="${NS.mdattr}" xmlns:mdui="${NS.mdui}" xmlns:remd="${NS.remd}" entityID="${esc(entityId)}">
  <md:Extensions>
    <mdattr:EntityAttributes>
      <saml:Attribute Name="http://macedir.org/entity-category" NameFormat="${ATTR_NAME_FORMAT_URI}">
${values(config.entityCategories)}
      </saml:Attribute>
      <saml:Attribute Name="urn:oasis:names:tc:SAML:attribute:assurance-certification" NameFormat="${ATTR_NAME_FORMAT_URI}">
${values(config.assuranceCertification)}
      </saml:Attribute>
    </mdattr:EntityAttributes>
  </md:Extensions>
  <md:SPSSODescriptor AuthnRequestsSigned="true" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:Extensions>
      <mdui:UIInfo>
${langElements('mdui:DisplayName', mdui.displayName, '        ')}
${langElements('mdui:Description', mdui.description, '        ')}
${langElements('mdui:InformationURL', mdui.informationUrl, '        ')}
${langElements('mdui:PrivacyStatementURL', mdui.privacyStatementUrl, '        ')}
${logo}
      </mdui:UIInfo>
    </md:Extensions>
${sigCerts.map((c) => keyDescriptor('signing', c)).join('\n')}
${encCerts.map((c) => keyDescriptor('encryption', c)).join('\n')}
${slo}
    <md:NameIDFormat>${NAMEID_TRANSIENT}</md:NameIDFormat>
${acs}
    <md:AttributeConsumingService index="0" isDefault="true">
${langElements('md:ServiceName', mdui.displayName, '      ')}
${attributes}
    </md:AttributeConsumingService>
  </md:SPSSODescriptor>
  <md:Organization>
${langElements('md:OrganizationName', config.organization.name, '    ')}
${langElements('md:OrganizationDisplayName', config.organization.displayName, '    ')}
${langElements('md:OrganizationURL', config.organization.url, '    ')}
  </md:Organization>
${config.contacts.map(contactPerson).join('\n')}
</md:EntityDescriptor>
`;
}

// ---------------------------------------------------------------------------
// Checks on the finished model
// ---------------------------------------------------------------------------

const PLACEHOLDER_HOST = /(^|\.)(invalid|test|localhost|example)(\.|$)/i;

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** Problems that make the document unfit to send to a federation (errors) or worth a look (warnings). */
export function checkModel(model, { now = new Date() } = {}) {
  const errors = [];
  const warnings = [];
  const { config, authHost } = model;
  if (model.aliases.length === 0)
    errors.push('no IdP alias: the SP descriptor needs at least one AssertionConsumerService');
  if (model.sigCerts.length === 0) errors.push('no signing certificate');
  if (model.encCerts.length === 0)
    errors.push('no encryption certificate (assertions must be encrypted, spec §4)');
  for (const [label, certs] of [
    ['signing', model.sigCerts],
    ['encryption', model.encCerts],
  ]) {
    for (const c of certs) {
      if (c.validTo < now)
        errors.push(
          `${label} certificate ${c.fingerprint256} expired on ${c.validTo.toISOString().slice(0, 10)}`,
        );
      else if (c.daysLeft < 90)
        warnings.push(`${label} certificate ${c.fingerprint256} expires in ${c.daysLeft} days`);
      if (c.validFrom > now)
        warnings.push(
          `${label} certificate ${c.fingerprint256} is not valid before ${c.validFrom.toISOString().slice(0, 10)}`,
        );
      if (c.bits < 2048)
        errors.push(
          `${label} certificate ${c.fingerprint256} has a ${c.bits}-bit key (at least 2048)`,
        );
      else if (c.bits < 3072)
        warnings.push(
          `${label} certificate ${c.fingerprint256} has a ${c.bits}-bit key (3072 recommended)`,
        );
    }
  }
  const placeholders = [];
  if (PLACEHOLDER_HOST.test(authHost)) placeholders.push(`auth host ${authHost}`);
  const urls = [
    ...Object.values(config.organization.url),
    ...Object.values(config.mdui.informationUrl),
    ...Object.values(config.mdui.privacyStatementUrl),
    config.mdui.logo.url,
  ];
  for (const url of urls) if (PLACEHOLDER_HOST.test(hostOf(url))) placeholders.push(url);
  for (const c of config.contacts)
    if (PLACEHOLDER_HOST.test(c.email.split('@')[1] ?? '')) placeholders.push(c.email);
  if (placeholders.length > 0) {
    errors.push(
      `placeholder values (use real ones or pass --allow-placeholders): ${[...new Set(placeholders)].join(', ')}`,
    );
  }
  return { errors, warnings };
}

/** Well-formedness (and, with a schema directory, XSD validation) through xmllint. */
export function runXmllint(xml, schemaDir) {
  const probe = spawnSync('xmllint', ['--version'], { encoding: 'utf8' });
  if (probe.error) return { available: false, ok: true, output: '' };
  const args = ['--noout'];
  if (schemaDir) args.push('--schema', join(schemaDir, 'saml-schema-metadata-2.0.xsd'));
  args.push('-');
  const result = spawnSync('xmllint', args, { input: xml, encoding: 'utf8' });
  return {
    available: true,
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

async function adminGet(url, token, path) {
  const response = await fetch(`${url.replace(/\/+$/, '')}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new UsageError(`Admin API ${path}: HTTP ${response.status}`);
  return response.json();
}

/**
 * Realm certificates and enabled aliases from a running Keycloak. Generated
 * providers (rsa-generated, rsa-enc-generated) are left out unless asked for:
 * their certificates change when the database is rebuilt.
 */
export async function readLiveRealm({ url, token, realm, includeGenerated }) {
  const [keys, components, idps] = await Promise.all([
    adminGet(url, token, `/admin/realms/${realm}/keys`),
    adminGet(url, token, `/admin/realms/${realm}/components?type=org.keycloak.keys.KeyProvider`),
    adminGet(url, token, `/admin/realms/${realm}/identity-provider/instances`),
  ]);
  const providerById = new Map(components.map((c) => [c.id, c.providerId]));
  const usable = (keys.keys ?? []).filter(
    (k) =>
      k.type === 'RSA' &&
      (k.status === 'ACTIVE' || k.status === 'PASSIVE') &&
      k.certificate &&
      (includeGenerated || !String(providerById.get(k.providerId)).endsWith('-generated')),
  );
  const byPriority = (a, b) => (b.providerPriority ?? 0) - (a.providerPriority ?? 0);
  return {
    sigCertificates: usable
      .filter((k) => k.use === 'SIG' && k.algorithm === 'RS256')
      .sort(byPriority)
      .map((k) => k.certificate),
    encCertificates: usable
      .filter((k) => k.use === 'ENC')
      .sort(byPriority)
      .map((k) => k.certificate),
    enabledAliases: idps.filter((i) => i.enabled).map((i) => i.alias),
  };
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

const HELP = `Usage: node tools/scripts/sp-metadata.mjs --auth-host HOST [options]

  --auth-host HOST       public auth host (or OECP_AUTH_HOST)
  --realm NAME           realm name (default oecp)
  --realm-file FILE      default identity/keycloak/realm-oecp.yaml
  --config FILE          default identity/keycloak/sp-metadata.config.yaml
  --indexes FILE         default identity/keycloak/sp-metadata.indexes.json
  --secrets-dir DIR      default deploy/compose/secrets (keycloak_saml_{sig,enc}_{cert,key})
  --sig-cert FILE        signing certificate (PEM or base64 DER); repeatable;
  --enc-cert FILE        encryption certificate; repeatable (current first, then the next one)
  --keycloak-url URL     read certificates and aliases from this Keycloak (token in
                         KEYCLOAK_ADMIN_TOKEN or --token-file FILE); --include-generated
                         also lists the generated realm keys
  --out FILE             default sp-metadata.xml; "-" for standard output
  --check                write nothing; fail if an index would be added or the output file differs
  --schema-dir DIR       directory with the SAML metadata XSDs: validate with xmllint
  --allow-placeholders   accept example hosts and addresses (tests only)
  -h, --help
`;

function parseArgs(argv) {
  const opts = { sigCerts: [], encCerts: [] };
  const valued = {
    '--auth-host': 'authHost',
    '--realm': 'realm',
    '--realm-file': 'realmFile',
    '--config': 'config',
    '--indexes': 'indexes',
    '--secrets-dir': 'secretsDir',
    '--keycloak-url': 'keycloakUrl',
    '--token-file': 'tokenFile',
    '--out': 'out',
    '--schema-dir': 'schemaDir',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--check') opts.check = true;
    else if (arg === '--allow-placeholders') opts.allowPlaceholders = true;
    else if (arg === '--include-generated') opts.includeGenerated = true;
    else if (arg === '--sig-cert' || arg === '--enc-cert' || arg in valued) {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      if (arg === '--sig-cert') opts.sigCerts.push(value);
      else if (arg === '--enc-cert') opts.encCerts.push(value);
      else opts[valued[arg]] = value;
    } else throw new UsageError(`unknown argument ${arg}`);
  }
  return opts;
}

const readText = (path, what) => {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new UsageError(`cannot read ${what} ${path}: ${error.code ?? error.message}`);
  }
};

export async function run(
  argv,
  env = process.env,
  log = (line) => process.stderr.write(`${line}\n`),
) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const at = (path) => resolve(REPO_ROOT, path);
  const authHost = opts.authHost ?? env.OECP_AUTH_HOST;
  if (!authHost || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(authHost)) {
    throw new UsageError(
      '--auth-host (or OECP_AUTH_HOST) must be a host name, without scheme or path',
    );
  }
  const realm = opts.realm ?? 'oecp';
  const realmFile = at(opts.realmFile ?? 'identity/keycloak/realm-oecp.yaml');
  const configFile = at(opts.config ?? 'identity/keycloak/sp-metadata.config.yaml');
  const indexesFile = at(opts.indexes ?? 'identity/keycloak/sp-metadata.indexes.json');
  const secretsDir = at(opts.secretsDir ?? 'deploy/compose/secrets');
  const outFile = opts.out ?? 'sp-metadata.xml';

  if (!existsSync(configFile)) {
    throw new UsageError(
      `config file ${configFile} not found: copy identity/keycloak/sp-metadata.config.example.yaml to it and fill it in`,
    );
  }
  const config = normalizeConfig(parseYamlSubset(readText(configFile, 'config file')));

  const providers = readRealmProviders(readText(realmFile, 'realm file'), env);
  const aliasSet = new Set([
    ...providers.filter((p) => p.enabled).map((p) => p.alias),
    ...config.reserveAliases,
  ]);
  const aliases = [...aliasSet];

  let existingIndexes = {};
  if (existsSync(indexesFile)) {
    try {
      existingIndexes = JSON.parse(readText(indexesFile, 'indexes file'));
    } catch (error) {
      if (error instanceof UsageError) throw error;
      throw new UsageError(`indexes file ${indexesFile} is not JSON`);
    }
    if (!isObject(existingIndexes))
      throw new UsageError(`indexes file ${indexesFile} must be an object`);
  }
  const { map: indexes, added } = assignIndexes(existingIndexes, aliases);

  // Certificates: Admin API, explicit files, or the secrets directory.
  let sigTexts = opts.sigCerts.map((f) => readText(f, 'signing certificate'));
  let encTexts = opts.encCerts.map((f) => readText(f, 'encryption certificate'));
  let liveAliases = null;
  let keyTexts = {};
  if (opts.keycloakUrl) {
    const token = opts.tokenFile
      ? readText(opts.tokenFile, 'token file').trim()
      : env.KEYCLOAK_ADMIN_TOKEN;
    if (!token) throw new UsageError('--keycloak-url needs KEYCLOAK_ADMIN_TOKEN or --token-file');
    const live = await readLiveRealm({
      url: opts.keycloakUrl,
      token,
      realm,
      includeGenerated: opts.includeGenerated,
    });
    if (sigTexts.length === 0) sigTexts = live.sigCertificates;
    if (encTexts.length === 0) encTexts = live.encCertificates;
    liveAliases = live.enabledAliases;
  } else {
    for (const [use, texts, flag] of [
      ['sig', sigTexts, '--sig-cert'],
      ['enc', encTexts, '--enc-cert'],
    ]) {
      if (texts.length > 0) continue;
      const certPath = join(secretsDir, `keycloak_saml_${use}_cert`);
      if (!existsSync(certPath)) {
        throw new UsageError(
          `${certPath} not found: run tools/scripts/gen-saml-keys.sh, pass ${flag} FILE, or use --keycloak-url`,
        );
      }
      texts.push(readText(certPath, 'certificate'));
      const keyPath = join(secretsDir, `keycloak_saml_${use}_key`);
      if (existsSync(keyPath)) keyTexts[use] = readText(keyPath, 'private key');
    }
  }
  const sigCerts = sigTexts.map((t) => certificateInfo(t));
  const encCerts = encTexts.map((t) => certificateInfo(t));
  if (keyTexts.sig) assertKeyMatchesCertificate(keyTexts.sig, sigCerts[0], 'keycloak_saml_sig_*');
  if (keyTexts.enc) assertKeyMatchesCertificate(keyTexts.enc, encCerts[0], 'keycloak_saml_enc_*');

  const model = { authHost, realm, config, indexes, sigCerts, encCerts, aliases };
  const { errors, warnings } = checkModel(model);
  if (opts.allowPlaceholders) {
    for (let i = errors.length - 1; i >= 0; i--)
      if (errors[i].startsWith('placeholder values')) errors.splice(i, 1);
  }
  if (liveAliases) {
    const missing = liveAliases.filter((a) => !aliasSet.has(a));
    if (missing.length > 0)
      errors.push(`enabled in the live realm but without an ACS here: ${missing.join(', ')}`);
    const unlisted = [...providers.filter((p) => p.enabled).map((p) => p.alias)].filter(
      (a) => !liveAliases.includes(a),
    );
    if (unlisted.length > 0)
      warnings.push(`enabled in the realm file but not in the live realm: ${unlisted.join(', ')}`);
  }

  const xml = buildMetadata(model);
  const lint = runXmllint(xml, opts.schemaDir);
  if (!lint.available) warnings.push('xmllint not found: well-formedness not checked here');
  else if (!lint.ok) errors.push(`xmllint:\n${lint.output}`);

  log(
    `Aliases (index): ${[...aliases]
      .sort((a, b) => indexes[a] - indexes[b])
      .map((a) => `${a} (${indexes[a]})`)
      .join(', ')}`,
  );
  for (const [label, certs] of [
    ['signing', sigCerts],
    ['encryption', encCerts],
  ]) {
    for (const c of certs)
      log(
        `${label} certificate: ${c.fingerprint256}, ${c.bits} bits, until ${c.validTo.toISOString().slice(0, 10)}`,
      );
  }
  for (const w of warnings) log(`warning: ${w}`);
  if (errors.length > 0) {
    for (const e of errors) log(`error: ${e}`);
    return 1;
  }

  if (opts.check) {
    if (added.length > 0) {
      log(
        `error: index file would change: new aliases ${added.join(', ')} (run without --check and commit ${indexesFile})`,
      );
      return 1;
    }
    if (outFile !== '-' && existsSync(outFile) && readFileSync(outFile, 'utf8') !== xml) {
      log(`error: ${outFile} is out of date; regenerate it`);
      return 1;
    }
    log('ok');
    return 0;
  }

  if (added.length > 0) {
    writeFileSync(indexesFile, serializeIndexes(indexes));
    log(`Indexes file updated (${added.join(', ')}): commit ${indexesFile}`);
  }
  if (outFile === '-') process.stdout.write(xml);
  else {
    writeFileSync(outFile, xml);
    log(`Written ${outFile}`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      if (error instanceof UsageError) process.stderr.write(`error: ${error.message}\n`);
      else process.stderr.write(`${error.stack ?? error}\n`);
      process.exit(error instanceof UsageError ? 2 : 1);
    },
  );
}
