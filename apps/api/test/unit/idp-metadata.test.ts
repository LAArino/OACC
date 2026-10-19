// SPDX-License-Identifier: EUPL-1.2
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyChanges,
  changedKeys,
  derFingerprint,
  describeChange,
  desiredConfig,
  MetadataPolicyError,
  usableCertificates,
} from '../../src/identity/metadata-refresh/idp-config-diff.js';
import type { IdpMetadataSettings } from '../../src/identity/metadata-refresh/idp-metadata-refresh.settings.js';
import { MetadataAggregateSource } from '../../src/identity/metadata-refresh/metadata-aggregate.source.js';
import {
  checkSignature,
  loadPinnedCertificate,
  type PinnedCertificate,
} from '../../src/identity/metadata-refresh/metadata-signature.js';
import {
  extractIdpMetadata,
  parseXsDateTime,
  scanAggregate,
} from '../../src/identity/metadata-refresh/saml-metadata.js';
import { aggregateXml, type FixtureEntity, signXml } from '../support/saml-aggregate.js';
import { createTestCertificate, daysFromNow, type TestCertificate } from '../support/x509.js';

const ALPHA = 'https://idp.alpha.test/idp';
const BETA = 'https://idp.beta.test/idp';

let federation: TestCertificate;
let attacker: TestCertificate;
let alphaCert: TestCertificate;
let alphaEncryption: TestCertificate;
let expired: TestCertificate;
let pinned: PinnedCertificate;
let dir: string;
let entities: FixtureEntity[];

const write = (name: string, content: string) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'oecp-idp-md-'));
  federation = createTestCertificate('Test federation signer', daysFromNow(-30), daysFromNow(3650));
  attacker = createTestCertificate('Test federation signer', daysFromNow(-30), daysFromNow(3650));
  alphaCert = createTestCertificate('idp.alpha.test', daysFromNow(-30), daysFromNow(700));
  alphaEncryption = createTestCertificate('enc.alpha.test', daysFromNow(-30), daysFromNow(700));
  expired = createTestCertificate('idp.beta.test', daysFromNow(-800), daysFromNow(-5));
  pinned = await loadPinnedCertificate(write('federation.pem', federation.pem));
  entities = [
    {
      entityId: ALPHA,
      signing: [{ der: expired.der, use: 'signing' }, { der: alphaCert.der }],
      encryption: [alphaEncryption.der],
      sso: {
        post: 'https://idp.alpha.test/idp/profile/SAML2/POST/SSO',
        redirect: 'https://idp.alpha.test/idp/profile/SAML2/Redirect/SSO',
      },
      slo: { redirect: 'https://idp.alpha.test/idp/profile/SAML2/Redirect/SLO' },
      nameIdFormats: ['urn:oasis:names:tc:SAML:2.0:nameid-format:transient'],
    },
    {
      entityId: BETA,
      signing: [{ der: expired.der, use: 'signing' }],
      sso: { redirect: 'https://idp.beta.test/sso' },
    },
  ];
}, 60_000);

const settings = (patch: Partial<IdpMetadataSettings> = {}): IdpMetadataSettings => ({
  url: undefined,
  signingCertFile: join(dir, 'federation.pem'),
  requireValidUntil: true,
  cacheDir: join(dir, 'cache'),
  maxBytes: 1024 * 1024,
  includeDisabled: false,
  refreshOnStart: false,
  ...patch,
});
const load = (wanted: string[] = [ALPHA, BETA]) => ({ wanted: new Set(wanted), now: new Date() });

describe('aggregate signature (pinned certificate, exc-c14n, RSA-SHA256)', () => {
  it('accepts an aggregate signed by the pinned certificate', () => {
    expect(() => checkSignature(signXml(aggregateXml(entities), federation), pinned)).not.toThrow();
  });

  it('refuses a signature by another key, even with its certificate in KeyInfo', () => {
    const forged = signXml(aggregateXml(entities), attacker);
    expect(forged).toContain(attacker.der.slice(0, 40));
    expect(() => checkSignature(forged, pinned)).toThrow(/Signature verification failed/);
  });

  it('refuses a tampered aggregate', () => {
    const signed = signXml(aggregateXml(entities), federation);
    const tampered = signed.replace(
      'https://idp.alpha.test/idp/profile/SAML2/POST/SSO',
      'https://evil.test/sso',
    );
    expect(tampered).not.toBe(signed);
    expect(() => checkSignature(tampered, pinned)).toThrow(/Signature verification failed|digest/);
  });

  it('refuses an unsigned aggregate, other algorithms and other transforms', () => {
    expect(() => checkSignature(aggregateXml(entities), pinned)).toThrow(/found 0/);
    const sha1 = signXml(aggregateXml(entities), federation, {
      signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    });
    expect(() => checkSignature(sha1, pinned)).toThrow(/not RSA-SHA256/);
    const inclusive = signXml(aggregateXml(entities), federation, {
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
      ],
    });
    expect(() => checkSignature(inclusive, pinned)).toThrow(/Unexpected signature transforms/);
  });

  it('aborts on any XML parse diagnostic, warnings included', () => {
    const signed = signXml(aggregateXml(entities), federation);
    const mismatched = signed.replace('</md:IDPSSODescriptor>', '</md:IDPSSODescriptorX>');
    expect(() => checkSignature(mismatched, pinned)).toThrow(/Malformed XML: fatalError/);
    expect(() => checkSignature(`${signed}junk`, pinned)).toThrow(/Malformed XML: error/);
    const unquoted = signed.replace('Name="urn:test:federation"', 'Name=urn:test:federation');
    expect(() => checkSignature(unquoted, pinned)).toThrow(/Malformed XML: warning/);
  });

  it('accepts a literal U+FFFD in the signed content', () => {
    const xml = aggregateXml(entities).replace('urn:test:federation', 'urn:test:f�d');
    expect(() => checkSignature(signXml(xml, federation), pinned)).not.toThrow();
  });

  it('pins exactly one PEM certificate', async () => {
    await expect(
      loadPinnedCertificate(write('two.pem', federation.pem + attacker.pem)),
    ).rejects.toThrow(/exactly one PEM CERTIFICATE/);
    await expect(loadPinnedCertificate(write('key.pem', federation.keyPem))).rejects.toThrow(
      /exactly one PEM CERTIFICATE/,
    );
  });
});

describe('aggregate loading (signature, scan, validUntil)', () => {
  it('verifies, then scans only the wanted entities of the same bytes', async () => {
    const path = write('ok.xml', signXml(aggregateXml(entities), federation));
    const loaded = await new MetadataAggregateSource(settings()).fromFile(
      path,
      true,
      load([ALPHA]),
    );
    expect(loaded).toMatchObject({ kind: 'file', verified: true, warnings: [] });
    expect(loaded.scan).toMatchObject({
      rootLocal: 'EntitiesDescriptor',
      rootId: '_agg',
      entityCount: 2,
    });
    expect([...loaded.scan.entities.keys()]).toEqual([ALPHA]);
  });

  it('refuses a past validUntil, and a missing one when required', async () => {
    const source = new MetadataAggregateSource(settings());
    const past = write(
      'past.xml',
      signXml(aggregateXml(entities, { validUntil: daysFromNow(-1) }), federation),
    );
    await expect(source.fromFile(past, true, load())).rejects.toThrow(/Aggregate expired/);
    const none = write(
      'none.xml',
      signXml(aggregateXml(entities, { validUntil: null }), federation),
    );
    await expect(source.fromFile(none, true, load())).rejects.toThrow(/no validUntil/);
    const lenient = new MetadataAggregateSource(settings({ requireValidUntil: false }));
    await expect(lenient.fromFile(none, true, load())).resolves.toMatchObject({ verified: true });
  });

  it('reads an unsigned local file only with verify=false, and says so', async () => {
    const path = write('unsigned.xml', aggregateXml(entities, { validUntil: null }));
    const source = new MetadataAggregateSource(settings());
    await expect(source.fromFile(path, true, load())).rejects.toThrow(/found 0/);
    const loaded = await source.fromFile(path, false, load());
    expect(loaded.verified).toBe(false);
    expect(loaded.warnings[0]).toMatch(/NOT verified/);
  });

  it('refuses DOCTYPEs and other roots', async () => {
    const doctype = write(
      'doctype.xml',
      `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="x"/>`,
    );
    await expect(scanAggregate(doctype, new Set())).rejects.toThrow(/DOCTYPE/);
    const other = write('other.xml', '<foo/>');
    await expect(scanAggregate(other, new Set())).rejects.toThrow(/Root element/);
  });
});

describe('entity extraction', () => {
  it('extracts signing certificates, endpoints and NameID formats', async () => {
    const path = write('x.xml', aggregateXml(entities));
    const scan = await scanAggregate(path, new Set([ALPHA, 'https://absent.test']));
    const md = extractIdpMetadata(scan.entities.get(ALPHA)!.element);
    expect(md).toEqual({
      entityId: ALPHA,
      // use="signing" and unspecified; never the encryption key.
      signingCertificates: [expired.der, alphaCert.der],
      sso: {
        post: 'https://idp.alpha.test/idp/profile/SAML2/POST/SSO',
        redirect: 'https://idp.alpha.test/idp/profile/SAML2/Redirect/SSO',
      },
      slo: { redirect: 'https://idp.alpha.test/idp/profile/SAML2/Redirect/SLO' },
      nameIdFormats: ['urn:oasis:names:tc:SAML:2.0:nameid-format:transient'],
    });
    expect(scan.entities.has('https://absent.test')).toBe(false);
    expect(scan.entities.get(ALPHA)!.validUntil?.getTime()).toBe(scan.validUntil?.getTime());
  });

  it('marks duplicate entity IDs as ambiguous', async () => {
    const path = write('dup.xml', aggregateXml([entities[0]!, entities[0]!]));
    const scan = await scanAggregate(path, new Set([ALPHA]));
    expect(scan.entities.has(ALPHA)).toBe(false);
    expect(scan.duplicates.has(ALPHA)).toBe(true);
  });

  it('reads xs:dateTime values as UTC', () => {
    expect(parseXsDateTime('2030-01-02T03:04:05Z').toISOString()).toBe('2030-01-02T03:04:05.000Z');
    expect(parseXsDateTime('2030-01-02T03:04:05').toISOString()).toBe('2030-01-02T03:04:05.000Z');
    expect(() => parseXsDateTime('tomorrow')).toThrow();
  });
});

describe('desired Keycloak config and change detection', () => {
  const now = new Date();
  const alphaMd = () => ({
    entityId: ALPHA,
    signingCertificates: [expired.der, alphaCert.der],
    sso: { post: 'https://a/post', redirect: 'https://a/redirect' },
    slo: { redirect: 'https://a/slo' },
    nameIdFormats: ['urn:oasis:names:tc:SAML:2.0:nameid-format:transient'],
  });

  it('drops expired certificates and prefers the configured bindings', () => {
    const { desired, warnings } = desiredConfig(
      alphaMd(),
      { postBindingAuthnRequest: 'true', postBindingLogout: 'true', validateSignature: 'true' },
      now,
    );
    expect(desired).toEqual({
      signingCertificate: alphaCert.der,
      singleSignOnServiceUrl: 'https://a/post',
      postBindingAuthnRequest: 'true',
      singleLogoutServiceUrl: 'https://a/slo',
      postBindingLogout: 'false',
    });
    expect(warnings).toEqual([expect.stringMatching(/^Dropped expired signing certificate/)]);
    expect(
      desiredConfig(alphaMd(), { postBindingAuthnRequest: 'false' }, now).desired
        .singleSignOnServiceUrl,
    ).toBe('https://a/redirect');
  });

  it('switches binding when the configured one is not offered, removes a vanished SLO', () => {
    const md = { ...alphaMd(), sso: { redirect: 'https://a/redirect' }, slo: {} };
    const { desired, warnings } = desiredConfig(
      md,
      {
        postBindingAuthnRequest: 'true',
        singleLogoutServiceUrl: 'https://old/slo',
        validateSignature: 'true',
      },
      now,
    );
    expect(desired).toMatchObject({
      singleSignOnServiceUrl: 'https://a/redirect',
      postBindingAuthnRequest: 'false',
      singleLogoutServiceUrl: null,
    });
    expect(warnings).toContain(
      'SingleSignOnService: configured binding not offered, using HTTP-Redirect',
    );
  });

  it('keeps the current configuration when only expired certificates remain', () => {
    expect(() =>
      desiredConfig({ ...alphaMd(), signingCertificates: [expired.der] }, {}, now),
    ).toThrow(MetadataPolicyError);
    expect(() => desiredConfig({ ...alphaMd(), sso: {} }, {}, now)).toThrow(/SingleSignOnService/);
  });

  it('warns about certificates expiring within 30 days', () => {
    const soon = createTestCertificate('soon', daysFromNow(-10), daysFromNow(10));
    const warnings: string[] = [];
    expect(usableCertificates([soon.der], now, warnings)).toHaveLength(1);
    expect(warnings[0]).toMatch(/expires on \d{4}-\d{2}-\d{2}/);
  });

  it('detects only real changes: certificates as a set, whitespace ignored', () => {
    const other = createTestCertificate('other', daysFromNow(-1), daysFromNow(100));
    const desired = {
      signingCertificate: `${alphaCert.der},${other.der}`,
      singleSignOnServiceUrl: 'https://a/post',
      postBindingAuthnRequest: 'true',
      singleLogoutServiceUrl: null,
    };
    const current = {
      signingCertificate: `${other.der.slice(0, 50)}\n${other.der.slice(50)}, ${alphaCert.der}`,
      singleSignOnServiceUrl: 'https://a/post',
      postBindingAuthnRequest: 'true',
      principalAttribute: 'urn:oasis:names:tc:SAML:attribute:subject-id',
    };
    expect(changedKeys(current, desired)).toEqual([]);
    expect(changedKeys({ ...current, singleLogoutServiceUrl: 'https://x' }, desired)).toEqual([
      'singleLogoutServiceUrl',
    ]);
    expect(changedKeys({ ...current, signingCertificate: alphaCert.der }, desired)).toEqual([
      'signingCertificate',
    ]);
  });

  it('applies only the changed keys and describes certificates by fingerprint', () => {
    const current = {
      a: '1',
      signingCertificate: expired.der,
      singleLogoutServiceUrl: 'https://x',
    };
    const desired = { signingCertificate: alphaCert.der, singleLogoutServiceUrl: null };
    expect(
      applyChanges(current, desired, ['signingCertificate', 'singleLogoutServiceUrl']),
    ).toEqual({
      a: '1',
      signingCertificate: alphaCert.der,
    });
    expect(describeChange('signingCertificate', current, desired)).toEqual({
      before: [derFingerprint(expired.der)],
      after: [derFingerprint(alphaCert.der)],
    });
    expect(derFingerprint(alphaCert.der)).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
