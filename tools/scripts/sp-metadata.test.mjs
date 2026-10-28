// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
//
// Tests of sp-metadata.mjs and gen-saml-keys.sh (node:test, no dependencies):
//
//   node --test "tools/scripts/**/*.test.mjs"
//
// The key pairs come from the real gen-saml-keys.sh, so the whole chain
// (secrets -> metadata) is exercised. SAML_SCHEMA_DIR, if set to a directory
// with the SAML metadata XSDs (identity/keycloak/scripts/sp-metadata.md),
// adds a schema validation of the output.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  UsageError,
  assignIndexes,
  buildMetadata,
  certificateInfo,
  normalizeConfig,
  parseYamlSubset,
  readRealmProviders,
  run,
  runXmllint,
  serializeIndexes,
} from './sp-metadata.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const realmFile = join(repo, 'identity/keycloak/realm-oecp.yaml');
const exampleConfig = join(repo, 'identity/keycloak/sp-metadata.config.example.yaml');
const hasXmllint = runXmllint('<a/>').available;

let work;
let secrets;

// Realistic hosts: the example config's hosts are refused as placeholders.
const REAL_CONFIG = readFileSync(exampleConfig, 'utf8')
  .replaceAll('example.org', 'university.eu')
  .replaceAll('portal.university.eu', 'portal.aurora-campus.eu');

function sh(command, args, input) {
  const r = spawnSync(command, args, { encoding: 'utf8', input });
  assert.equal(r.status, 0, `${command} ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** Runs the generator in a private copy of the indexes file; returns {code, log, xml, indexes}. */
async function generate(extraArgs = [], { configText = REAL_CONFIG, indexes, env = {} } = {}) {
  const dir = mkdtempSync(join(work, 'run-'));
  const config = join(dir, 'config.yaml');
  const indexesFile = join(dir, 'indexes.json');
  const out = join(dir, 'sp-metadata.xml');
  writeFileSync(config, configText);
  if (indexes) writeFileSync(indexesFile, JSON.stringify(indexes));
  const log = [];
  const code = await run(
    [
      '--auth-host',
      'auth.aurora-campus.eu',
      '--config',
      config,
      '--indexes',
      indexesFile,
      '--secrets-dir',
      secrets,
      '--out',
      out,
      ...extraArgs,
    ],
    { ...env },
    (line) => log.push(line),
  );
  const read = (f) => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return null;
    }
  };
  return {
    code,
    log: log.join('\n'),
    xml: read(out),
    indexes: read(indexesFile),
    dir,
    out,
    indexesFile,
  };
}

before(() => {
  work = mkdtempSync(join(tmpdir(), 'sp-metadata-test-'));
  secrets = join(work, 'secrets');
  mkdirSync(secrets);
  sh('bash', [join(here, 'gen-saml-keys.sh'), '--dir', secrets]);
});

after(() => rmSync(work, { recursive: true, force: true }));

describe('gen-saml-keys.sh', () => {
  it('writes four one-line base64 files without trailing newline', () => {
    for (const name of ['sig_key', 'sig_cert', 'enc_key', 'enc_cert']) {
      const text = readFileSync(join(secrets, `keycloak_saml_${name}`), 'utf8');
      assert.match(text, /^[A-Za-z0-9+/]+={0,2}$/, name);
    }
  });

  it('makes RSA 3072 certificates valid for ten years', () => {
    const cert = certificateInfo(readFileSync(join(secrets, 'keycloak_saml_sig_cert'), 'utf8'));
    assert.equal(cert.bits, 3072);
    assert.ok(cert.daysLeft > 3640 && cert.daysLeft <= 3650, `daysLeft ${cert.daysLeft}`);
  });

  it('refuses to overwrite without --force', () => {
    const r = spawnSync('bash', [join(here, 'gen-saml-keys.sh'), '--dir', secrets], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--force/);
  });

  it('refuses keys shorter than 3072 bits', () => {
    const r = spawnSync(
      'bash',
      [join(here, 'gen-saml-keys.sh'), '--dir', secrets, '--bits', '2048'],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 2);
  });
});

describe('parseYamlSubset', () => {
  it('reads maps, lists of maps, quoting, flow lists and comments', () => {
    const parsed = parseYamlSubset(`# head
a:
  b: "x # not a comment"   # a comment
  c: 'it''s'
  d: [1, two, "three, 3"]
list:
  - type: technical
    email: a@b.eu
  - plain
  - key: v
n: 80
flag: true
empty:
`);
    assert.deepEqual(parsed, {
      a: { b: 'x # not a comment', c: "it's", d: [1, 'two', 'three, 3'] },
      list: [{ type: 'technical', email: 'a@b.eu' }, 'plain', { key: 'v' }],
      n: 80,
      flag: true,
      empty: null,
    });
  });

  it('parses the example config', () => {
    const parsed = parseYamlSubset(readFileSync(exampleConfig, 'utf8'));
    assert.equal(parsed.contacts.length, 3);
    assert.equal(parsed.mdui.logo.width, 200);
    assert.deepEqual(parsed.reserveAliases, ['urv']);
  });

  it('rejects what it cannot read faithfully', () => {
    assert.throws(() => parseYamlSubset('a: |\n  text\n'), UsageError);
    assert.throws(() => parseYamlSubset('a: 1\na: 2\n'), /duplicate/);
    assert.throws(() => parseYamlSubset('\ta: 1\n'), /tabs/);
    assert.throws(() => parseYamlSubset('a: "open\n'), /unterminated/);
  });
});

describe('readRealmProviders', () => {
  const realm = readFileSync(realmFile, 'utf8');

  it('lists the IdPs of the realm file with their enabled state', () => {
    const providers = readRealmProviders(realm, {});
    assert.deepEqual(providers, [
      { alias: 'example-partner', enabled: false },
      { alias: 'urv', enabled: false },
      { alias: 'sir2', enabled: false },
    ]);
  });

  it('applies keycloak-config-cli variable substitution', () => {
    const providers = readRealmProviders(realm, { OECP_DEV_IDP_ENABLED: 'true' });
    assert.equal(providers.find((p) => p.alias === 'urv').enabled, true);
    assert.equal(providers.find((p) => p.alias === 'sir2').enabled, false);
    const hub = readRealmProviders(realm, { OECP_SIR2_IDP_ENABLED: 'true' });
    assert.equal(hub.find((p) => p.alias === 'sir2').enabled, true);
  });

  it('treats a missing "enabled" as enabled and reads quoted aliases', () => {
    const providers = readRealmProviders(
      `identityProviders:\n  - alias: "ku"\n    providerId: saml\n    config:\n      enabled: false\n  - alias: cbs\n    enabled: true\nnext: 1\n`,
      {},
    );
    assert.deepEqual(providers, [
      { alias: 'ku', enabled: true },
      { alias: 'cbs', enabled: true },
    ]);
  });

  it('fails on a value that is not a boolean', () => {
    assert.throws(
      () => readRealmProviders('identityProviders:\n  - alias: a\n    enabled: maybe\n', {}),
      /true or false/,
    );
  });
});

describe('assignIndexes', () => {
  it('appends after the highest index and never renumbers', () => {
    const first = assignIndexes({}, ['urv', 'ku']);
    assert.deepEqual(first.map, { urv: 0, ku: 1 });
    assert.deepEqual(first.added, ['urv', 'ku']);
    // "ku" is dropped from the aliases and "cbs" added: "ku" keeps 1, "cbs" gets 2.
    const second = assignIndexes(first.map, ['cbs', 'urv']);
    assert.deepEqual(second.map, { urv: 0, ku: 1, cbs: 2 });
    assert.deepEqual(second.added, ['cbs']);
    assert.equal(serializeIndexes(second.map), '{\n  "urv": 0,\n  "ku": 1,\n  "cbs": 2\n}\n');
  });

  it('rejects a corrupt file', () => {
    assert.throws(() => assignIndexes({ a: 1, b: 1 }, []), /share an index/);
    assert.throws(() => assignIndexes({ a: -1 }, []), /invalid index/);
  });
});

describe('normalizeConfig', () => {
  const base = () => parseYamlSubset(REAL_CONFIG);

  it('accepts the example config', () => {
    const model = normalizeConfig(base());
    assert.deepEqual(model.reserveAliases, ['urv']);
    assert.equal(model.contacts.length, 3);
  });

  it('requires the three contacts, English texts and logo dimensions', () => {
    const raw = base();
    raw.contacts = raw.contacts.filter((c) => c.type !== 'security');
    delete raw.mdui.logo.width;
    raw.organization.name = { ca: 'Universitat' };
    assert.throws(
      () => normalizeConfig(raw),
      (error) =>
        error instanceof UsageError &&
        /"security" contact is required/.test(error.message) &&
        /mdui\.logo\.width/.test(error.message) &&
        /organization\.name: the "en" entry/.test(error.message),
    );
  });

  it('refuses Research and Scholarship and a missing CoCo v2 or Sirtfi', () => {
    const raw = base();
    raw.entityCategories = ['http://refeds.org/category/research-and-scholarship'];
    raw.assuranceCertification = [];
    assert.throws(
      () => normalizeConfig(raw),
      (error) =>
        /Research and Scholarship/.test(error.message) &&
        /code-of-conduct\/v2 is required/.test(error.message) &&
        /sirtfi/.test(error.message),
    );
  });
});

describe('generator', () => {
  it('builds one EntityDescriptor from the secrets, valid XML', async () => {
    const r = await generate();
    assert.equal(r.code, 0, r.log);
    const xml = r.xml;
    assert.match(
      xml,
      /<md:EntityDescriptor [^>]*entityID="https:\/\/auth\.aurora-campus\.eu\/realms\/oecp"/,
    );
    assert.match(
      xml,
      /<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2\.0:bindings:HTTP-POST" Location="https:\/\/auth\.aurora-campus\.eu\/realms\/oecp\/broker\/urv\/endpoint" index="0" isDefault="true"\/>/,
    );
    assert.equal((xml.match(/<md:AssertionConsumerService /g) ?? []).length, 1);
    assert.match(xml, /AuthnRequestsSigned="true" WantAssertionsSigned="true"/);
    assert.match(xml, /<saml:AttributeValue>https:\/\/refeds\.org\/category\/personalized</);
    assert.match(xml, /<saml:AttributeValue>https:\/\/refeds\.org\/category\/code-of-conduct\/v2</);
    assert.match(xml, /<saml:AttributeValue>https:\/\/refeds\.org\/sirtfi</);
    assert.doesNotMatch(xml, /research-and-scholarship/);
    assert.match(
      xml,
      /contactType="other" remd:contactType="http:\/\/refeds\.org\/metadata\/contactType\/security"/,
    );
    assert.match(
      xml,
      /<md:EncryptionMethod Algorithm="http:\/\/www\.w3\.org\/2009\/xmlenc11#rsa-oaep"\/>/,
    );
    assert.equal((xml.match(/<md:RequestedAttribute /g) ?? []).length, 7);
    assert.equal(r.indexes, '{\n  "urv": 0\n}\n');
    if (hasXmllint) {
      const lint = runXmllint(xml, process.env.SAML_SCHEMA_DIR);
      assert.ok(lint.ok, lint.output);
    }
  });

  it('puts the certificates of the secret files in the document, with Keycloak key ids', async () => {
    const r = await generate();
    for (const [use, element] of [
      ['sig', 'signing'],
      ['enc', 'encryption'],
    ]) {
      const b64 = readFileSync(join(secrets, `keycloak_saml_${use}_cert`), 'utf8');
      const der = Buffer.from(b64, 'base64');
      const spki = sh('openssl', ['x509', '-inform', 'DER', '-noout', '-pubkey'], der);
      const kid = createHash('sha256')
        .update(Buffer.from(spki.replace(/-----[^-]+-----|\s/g, ''), 'base64'))
        .digest('base64url');
      const block = new RegExp(
        `<md:KeyDescriptor use="${element}">[\\s\\S]*?</md:KeyDescriptor>`,
      ).exec(r.xml)[0];
      assert.ok(block.includes(`<ds:KeyName>${kid}</ds:KeyName>`), `${use} KeyName`);
      assert.ok(block.replace(/\s+/g, '').includes(b64), `${use} certificate`);
    }
  });

  it('gives enabled realm aliases stable indexes and appends new ones', async () => {
    const first = await generate([], {
      indexes: { urv: 0 },
      env: { OECP_DEV_IDP_ENABLED: 'true' },
    });
    assert.equal(first.code, 0, first.log);
    assert.deepEqual(JSON.parse(first.indexes), { urv: 0 });

    const config = `${REAL_CONFIG}`.replace('  - urv', '  - urv\n  - ku');
    const second = await generate([], { configText: config, indexes: { urv: 0 } });
    assert.equal(second.code, 0, second.log);
    assert.equal(second.indexes, '{\n  "urv": 0,\n  "ku": 1\n}\n');
    assert.match(second.xml, /broker\/ku\/endpoint" index="1"\/>/);
    assert.match(second.log, /Indexes file updated \(ku\)/);

    // An alias that drops out keeps its reserved index; a later one does not reuse it.
    const third = await generate([], {
      configText: config.replace('  - urv\n  - ku', '  - ku\n  - cbs'),
      indexes: { urv: 0, ku: 1 },
    });
    assert.equal(third.code, 0, third.log);
    assert.equal(third.indexes, '{\n  "urv": 0,\n  "ku": 1,\n  "cbs": 2\n}\n');
    assert.doesNotMatch(third.xml, /broker\/urv\//);
    assert.match(third.xml, /broker\/ku\/endpoint" index="1" isDefault="true"\/>/);
  });

  it('--check writes nothing and fails when an index would change or the file is stale', async () => {
    const fresh = await generate(['--check'], { indexes: {} });
    assert.equal(fresh.code, 1);
    assert.match(fresh.log, /index file would change: new aliases urv/);
    assert.equal(fresh.xml, null);

    const ok = await generate(['--check'], { indexes: { urv: 0 } });
    assert.equal(ok.code, 0, ok.log);
    assert.match(ok.log, /\nok$/);

    const written = await generate([], { indexes: { urv: 0 } });
    writeFileSync(written.out, `${written.xml}<!-- stale -->`);
    const stale = await run(
      [
        '--auth-host',
        'auth.aurora-campus.eu',
        '--config',
        join(written.dir, 'config.yaml'),
        '--indexes',
        written.indexesFile,
        '--secrets-dir',
        secrets,
        '--out',
        written.out,
        '--check',
      ],
      {},
      () => {},
    );
    assert.equal(stale, 1);
  });

  it('refuses placeholder hosts and addresses', async () => {
    const r = await generate([], { configText: readFileSync(exampleConfig, 'utf8') });
    assert.equal(r.code, 1);
    assert.match(r.log, /placeholder values/);
    assert.equal(r.xml, null);
  });

  it('fails without a config file, with a hint', async () => {
    await assert.rejects(
      run(
        [
          '--auth-host',
          'auth.aurora-campus.eu',
          '--config',
          join(work, 'missing.yaml'),
          '--secrets-dir',
          secrets,
        ],
        {},
        () => {},
      ),
      /sp-metadata\.config\.example\.yaml/,
    );
  });

  it('detects a private key that does not belong to its certificate', async () => {
    const mixed = join(work, 'mixed');
    mkdirSync(mixed);
    for (const name of ['sig_cert', 'enc_cert', 'enc_key'])
      copyFileSync(join(secrets, `keycloak_saml_${name}`), join(mixed, `keycloak_saml_${name}`));
    copyFileSync(join(secrets, 'keycloak_saml_enc_key'), join(mixed, 'keycloak_saml_sig_key'));
    await assert.rejects(generate(['--secrets-dir', mixed]), /does not match the certificate/);
  });

  it('takes explicit certificate files, several for a rollover, in the given order', async () => {
    const other = join(work, 'rollover');
    mkdirSync(other);
    sh('bash', [join(here, 'gen-saml-keys.sh'), '--dir', other]);
    const r = await generate([
      '--sig-cert',
      join(secrets, 'keycloak_saml_sig_cert'),
      '--sig-cert',
      join(other, 'keycloak_saml_sig_cert'),
      '--enc-cert',
      join(secrets, 'keycloak_saml_enc_cert'),
    ]);
    assert.equal(r.code, 0, r.log);
    assert.equal((r.xml.match(/<md:KeyDescriptor use="signing">/g) ?? []).length, 2);
    const first = r.xml.indexOf(
      readFileSync(join(secrets, 'keycloak_saml_sig_cert'), 'utf8').slice(0, 60),
    );
    const second = r.xml.indexOf(
      readFileSync(join(other, 'keycloak_saml_sig_cert'), 'utf8').slice(0, 60),
    );
    assert.ok(first > 0 && second > first);
  });

  it('escapes XML in configured texts', () => {
    const raw = parseYamlSubset(REAL_CONFIG);
    raw.organization.name.en = 'A & B <Uni> "x"';
    const cert = certificateInfo(readFileSync(join(secrets, 'keycloak_saml_sig_cert'), 'utf8'));
    const xml = buildMetadata({
      authHost: 'auth.aurora-campus.eu',
      realm: 'oecp',
      config: normalizeConfig(raw),
      indexes: { urv: 0 },
      sigCerts: [cert],
      encCerts: [cert],
      aliases: ['urv'],
    });
    assert.match(xml, /A &amp; B &lt;Uni&gt; &quot;x&quot;/);
    if (hasXmllint) assert.ok(runXmllint(xml).ok);
  });
});

describe('Admin API mode', () => {
  let server;
  let url;
  let payload;

  before(async () => {
    server = createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer t0ken') {
        res.writeHead(401).end();
        return;
      }
      const route = {
        '/admin/realms/oecp/keys': payload.keys,
        '/admin/realms/oecp/components?type=org.keycloak.keys.KeyProvider': payload.components,
        '/admin/realms/oecp/identity-provider/instances': payload.idps,
      }[req.url];
      if (!route) res.writeHead(404).end();
      else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(route));
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => server.close());

  const cert = (use) => readFileSync(join(secrets, `keycloak_saml_${use}_cert`), 'utf8');
  const generated = certificateInfo(
    readFileSync(join(secrets, 'keycloak_saml_enc_cert'), 'utf8'),
  ).base64;

  function realm(idps) {
    payload = {
      keys: {
        keys: [
          {
            providerId: 'p-gen',
            type: 'RSA',
            use: 'SIG',
            algorithm: 'RS256',
            status: 'ACTIVE',
            providerPriority: 100,
            certificate: generated,
          },
          {
            providerId: 'p-sig',
            type: 'RSA',
            use: 'SIG',
            algorithm: 'RS256',
            status: 'ACTIVE',
            providerPriority: 200,
            certificate: cert('sig'),
          },
          {
            providerId: 'p-enc',
            type: 'RSA',
            use: 'ENC',
            algorithm: 'RSA-OAEP',
            status: 'ACTIVE',
            providerPriority: 200,
            certificate: cert('enc'),
          },
          {
            providerId: 'p-off',
            type: 'RSA',
            use: 'SIG',
            algorithm: 'RS256',
            status: 'DISABLED',
            providerPriority: 300,
            certificate: generated,
          },
          {
            providerId: 'p-hmac',
            type: 'OCT',
            use: 'SIG',
            algorithm: 'HS512',
            status: 'ACTIVE',
            providerPriority: 100,
          },
        ],
      },
      components: [
        { id: 'p-gen', providerId: 'rsa-generated' },
        { id: 'p-sig', providerId: 'rsa' },
        { id: 'p-enc', providerId: 'rsa' },
      ],
      idps,
    };
  }

  const api = (extra = []) =>
    generate(['--keycloak-url', url, '--secrets-dir', join(work, 'nowhere'), ...extra], {
      env: { KEYCLOAK_ADMIN_TOKEN: 't0ken' },
    });

  it('reads the stable certificates and leaves out generated and disabled keys', async () => {
    realm([{ alias: 'urv', enabled: true }]);
    const r = await api();
    assert.equal(r.code, 0, r.log);
    assert.equal((r.xml.match(/<md:KeyDescriptor /g) ?? []).length, 2);
    assert.ok(r.xml.replace(/\s+/g, '').includes(cert('sig')));
  });

  it('lists the generated keys on request', async () => {
    realm([{ alias: 'urv', enabled: true }]);
    const r = await api(['--include-generated']);
    assert.equal(r.code, 0, r.log);
    assert.equal((r.xml.match(/<md:KeyDescriptor use="signing">/g) ?? []).length, 2);
  });

  it('fails for an enabled live alias that has no ACS here', async () => {
    realm([
      { alias: 'urv', enabled: true },
      { alias: 'ku', enabled: true },
    ]);
    const r = await api();
    assert.equal(r.code, 1);
    assert.match(r.log, /enabled in the live realm but without an ACS here: ku/);
  });

  it('rejects a wrong token without leaking it', async () => {
    realm([]);
    await assert.rejects(
      generate(['--keycloak-url', url], { env: { KEYCLOAK_ADMIN_TOKEN: 'wrong' } }),
      (error) =>
        error instanceof UsageError &&
        /HTTP 401/.test(error.message) &&
        !/wrong/.test(error.message),
    );
  });
});
