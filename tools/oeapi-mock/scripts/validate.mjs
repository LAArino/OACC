#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
//
// Validates every response shape of the OEAPI mock against the vendored
// OEAPI v5.0 OpenAPI document (spec/oeapi-v5.0.bundled.json) with Ajv, checks
// the eduXchange profile's required attributes, and asserts the behaviour the
// harvester relies on (consumer filter, pagination, `since`).
//
//   node tools/oeapi-mock/scripts/validate.mjs                     # starts its own server (auth none)
//   node tools/oeapi-mock/scripts/validate.mjs --dataset data/uibk-next-run.json
//   node tools/oeapi-mock/scripts/validate.mjs --base-url http://127.0.0.1:8090 --basic oecp:oecp-mock-secret
//
// Development tool only: Ajv (ajv@8.20.0, ajv-formats@3.0.1, both MIT) is
// installed on first run into tools/oeapi-mock/.cache/validator (git-ignored);
// the mock server itself has no dependencies.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

// --- Ajv (dev-time download) -------------------------------------------------
const cacheDir = join(root, '.cache', 'validator');
if (!existsSync(join(cacheDir, 'node_modules', 'ajv', 'package.json'))) {
  mkdirSync(cacheDir, { recursive: true });
  process.stderr.write(`installing ajv into ${cacheDir} ...\n`);
  execFileSync(
    'npm',
    [
      'install',
      '--prefix',
      cacheDir,
      '--no-audit',
      '--no-fund',
      '--silent',
      'ajv@8.20.0',
      'ajv-formats@3.0.1',
    ],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
}
const req = createRequire(join(cacheDir, 'package.json'));
const Ajv = req('ajv').default;
const addFormats = req('ajv-formats').default;

const spec = JSON.parse(readFileSync(join(root, 'spec', 'oeapi-v5.0.bundled.json'), 'utf8'));

// OpenAPI 3.0 Schema Objects are a JSON Schema dialect: translate `nullable`
// and keep everything else (unknown keywords such as `example` or
// `x-ooapi-extensible-enum` are ignored with strict: false).
function toJsonSchema(node) {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node))
    out[k] = k === 'example' || k === 'examples' ? v : toJsonSchema(v);
  if (out.nullable === true && out.type) out.type = [].concat(out.type, 'null');
  delete out.nullable;
  return out;
}

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajv);
for (const f of ['int32', 'int64', 'double', 'float', 'url']) ajv.addFormat(f, true);
ajv.addSchema(toJsonSchema(spec), 'oeapi');

const ptr = (s) => s.replace(/~/g, '~0').replace(/\//g, '~1');
const responseRef = (path, status = '200', type = 'application/json') =>
  `oeapi#/paths/${ptr(path)}/get/responses/${status}/content/${ptr(type)}/schema`;
const validators = new Map();
function validator(ref) {
  if (!validators.has(ref)) validators.set(ref, ajv.getSchema(ref) ?? ajv.compile({ $ref: ref }));
  return validators.get(ref);
}

// --- Server -----------------------------------------------------------------
let base = arg('--base-url');
let child;
const headers = { Accept: 'application/json' };
if (arg('--basic'))
  headers.Authorization = `Basic ${Buffer.from(arg('--basic')).toString('base64')}`;
if (arg('--bearer')) headers.Authorization = `Bearer ${arg('--bearer')}`;

async function startServer() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const dataset = arg('--dataset') ? resolve(arg('--dataset')) : join(root, 'data', 'uibk.json');
  child = spawn(process.execPath, [join(root, 'server.mjs')], {
    env: {
      ...process.env,
      PORT: String(port),
      OEAPI_MOCK_AUTH: 'none',
      OEAPI_MOCK_DATASET: dataset,
      OEAPI_MOCK_TODAY: '2026-10-14',
      OEAPI_MOCK_FAIL_RATE: '0',
      OEAPI_MOCK_RATE_LIMIT_PER_SEC: '0',
      OEAPI_MOCK_LATENCY_MS: '0',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let log = '';
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 50; i++) {
    if (log.includes('OEAPI v5.0 on')) return `http://127.0.0.1:${port}`;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start:\n${log}`);
}

// --- Checks -----------------------------------------------------------------
let checks = 0;
const failures = [];
const warnings = [];
const counts = {};

function check(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
}

async function get(path) {
  const r = await fetch(base + path, { headers });
  const text = await r.text();
  return {
    status: r.status,
    type: r.headers.get('content-type'),
    body: text ? JSON.parse(text) : undefined,
    headers: r.headers,
  };
}

function validate(ref, body, label) {
  const v = validator(ref);
  const ok = v(body);
  checks++;
  counts[ref] = (counts[ref] ?? 0) + 1;
  if (!ok) failures.push(`${label}: ${ajv.errorsText(v.errors, { separator: '; ' })}`);
  return ok;
}

async function getValid(path, specPath, label = path) {
  const r = await get(path);
  check(r.status === 200, `${label}: HTTP ${r.status}`);
  check(r.type === 'application/json', `${label}: Content-Type ${r.type}`);
  validate(responseRef(specPath), r.body, label);
  return r.body;
}

async function listAll(path, specPath) {
  const items = [];
  for (let page = 1; page <= 1000; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const body = await getValid(`${path}${sep}pageNumber=${page}`, specPath);
    items.push(...body.items);
    if (!body.hasNextPage) break;
  }
  return items;
}

// eduXchange profile, "required OEAPI attributes" table (documentation repo,
// technical/consumers-and-profiles/eduxchange.md).
const EDUX_REQUIRED = {
  organization: [
    'organizationId',
    'primaryCode',
    'organizationType',
    'name',
    'shortName',
    'consumers',
  ],
  course: [
    'courseId',
    'primaryCode',
    'name',
    'abbreviation',
    'description',
    'teachingLanguage',
    'level',
    'studyLoad',
    'consumers',
  ],
  offering: [
    'offeringId',
    'primaryCode',
    'offeringType',
    'name',
    'description',
    'teachingLanguage',
    'resultExpected',
    'startDate',
    'endDate',
    'consumers',
  ],
};
const PROFILE_ALLIANCES = new Set(['ewuu', 'lde', 'euroteq', 'kom']);
function eduxProfile(kind, e, label) {
  for (const k of EDUX_REQUIRED[kind])
    check(e[k] !== undefined, `${label}: eduXchange profile requires "${k}"`);
  const c = (e.consumers ?? []).find((x) => x.consumerKey === 'eduxchange');
  check(
    c && Array.isArray(c.alliances) && c.alliances.every((a) => typeof a.name === 'string'),
    `${label}: eduxchange consumer needs alliances[].name`,
  );
  for (const a of c?.alliances ?? []) {
    if (!PROFILE_ALLIANCES.has(a.name))
      warnings.push(
        `${label}: alliance "${a.name}" is not in the eduXchange profile enum (ewuu, lde, euroteq, kom) -- intended, see README`,
      );
  }
}

async function main() {
  if (!base) base = await startServer();
  console.log(`validating ${base} against OEAPI ${spec.info.version}`);

  await getValid('/', '/');

  const orgs = await listAll(
    '/organizations?organizationType=root&consumer=eduxchange',
    '/organizations',
  );
  check(orgs.length === 1, `expected 1 root organization, got ${orgs.length}`);
  for (const o of orgs) {
    eduxProfile('organization', o, `organization ${o.organizationId}`);
    await getValid(`/organizations/${o.organizationId}`, '/organizations/{organizationId}');
  }

  const sessions = await listAll('/academic-sessions', '/academic-sessions');
  check(sessions.length === 3, `expected 3 academic sessions, got ${sessions.length}`);
  for (const s of sessions) {
    await getValid(
      `/academic-sessions/${s.academicSessionId}?expand=parent,children,year`,
      '/academic-sessions/{academicSessionId}',
    );
  }

  const all = await listAll('/courses?pageSize=10', '/courses');
  const edux = await listAll('/courses?consumer=eduxchange&pageSize=7', '/courses');
  const allIds = new Set(all.map((c) => c.courseId));
  const eduxIds = new Set(edux.map((c) => c.courseId));
  check(allIds.size === all.length, 'duplicate courses across pages');
  check(eduxIds.size === edux.length, 'duplicate eduxchange courses across pages');
  const hidden = all.filter((c) => !eduxIds.has(c.courseId));
  check(
    hidden.every((c) => !(c.consumers ?? []).some((x) => x.consumerKey === 'eduxchange')),
    'consumer=eduxchange hid a tagged course',
  );
  check(
    edux.every((c) => c.consumers.some((x) => x.consumerKey === 'eduxchange')),
    'consumer=eduxchange returned an untagged course',
  );
  console.log(
    `courses: ${all.length} total, ${edux.length} with consumer=eduxchange, ${hidden.length} hidden (${hidden.map((c) => c.primaryCode.code).join(', ')})`,
  );

  // Pagination boundaries.
  const pages = Math.ceil(edux.length / 7);
  const last = await getValid(
    `/courses?consumer=eduxchange&pageSize=7&pageNumber=${pages}`,
    '/courses',
  );
  check(last.hasNextPage === false && last.hasPreviousPage === pages > 1, 'last page flags');
  const past = await getValid(
    `/courses?consumer=eduxchange&pageSize=7&pageNumber=${pages + 1}`,
    '/courses',
  );
  check(
    past.items.length === 0 && past.hasNextPage === false,
    'page past the end must be empty with hasNextPage=false',
  );
  const big = await getValid('/courses?pageSize=250', '/courses');
  check(big.pageSize === 100, `pageSize capped at 100 (got ${big.pageSize})`);

  let offeringCount = 0;
  let defaultCount = 0;
  for (const c of all) {
    const label = `course ${c.primaryCode.code}`;
    await getValid(`/courses/${c.courseId}`, '/courses/{courseId}', label);
    if (eduxIds.has(c.courseId)) eduxProfile('course', c, label);
    const offerings = await listAll(
      `/courses/${c.courseId}/offerings?since=2025-10-14&pageSize=10`,
      '/courses/{courseId}/offerings',
    );
    const future = await listAll(
      `/courses/${c.courseId}/offerings`,
      '/courses/{courseId}/offerings',
    );
    check(
      future.every((o) => o.startDate >= '2026-10-14'),
      `${label}: default since must hide started offerings`,
    );
    defaultCount += future.length;
    offeringCount += offerings.length;
    for (const o of offerings) {
      const ol = `offering ${o.primaryCode.code}`;
      // The /offerings/{id} response is oneOf CourseOffering | ComponentOffering |
      // ProgramOffering; CourseOffering and ProgramOffering share every
      // required field, so a course offering matches both and the oneOf can
      // never pass. Validate against CourseOffering directly instead.
      const r = await get(`/offerings/${o.offeringId}?expand=academicSession,course`);
      check(r.status === 200, `${ol}: HTTP ${r.status}`);
      validate('oeapi#/components/schemas/CourseOffering', r.body, `${ol} (expanded)`);
      check(
        typeof r.body.academicSession === 'object' && typeof r.body.course === 'object',
        `${ol}: expand=academicSession,course`,
      );
      if (eduxIds.has(c.courseId)) eduxProfile('offering', o, ol);
    }
  }
  console.log(
    `offerings: ${offeringCount} with since=2025-10-14, ${defaultCount} with the v5 default since=<today 2026-10-14>`,
  );

  // Errors are application/problem+json Problem objects.
  for (const [path, status] of [
    ['/courses/00000000-0000-4000-8000-000000000000', '404'],
    ['/courses/not-a-uuid', '400'],
    ['/courses?pageNumber=0', '400'],
    ['/courses?teachingLanguage=de', '400'],
    ['/courses?level=phd', '400'],
    ['/academic-sessions/00000000-0000-4000-8000-000000000000?expand=nonsense', '404'],
    ['/nope', '404'],
  ]) {
    const r = await get(path);
    check(String(r.status) === status, `${path}: expected ${status}, got ${r.status}`);
    check(r.type === 'application/problem+json', `${path}: Content-Type ${r.type}`);
    validate('oeapi#/components/schemas/Problem', r.body, `${path} problem`);
  }

  // Negative controls: the validator must reject broken copies, and the
  // ambiguity of the /offerings/{offeringId} oneOf is recorded, not assumed.
  const broken = structuredClone(all[0]);
  broken.teachingLanguage = 'en';
  broken.studyLoad.studyLoadUnit = 'credits';
  check(
    !validator('oeapi#/components/schemas/Course')(broken),
    'negative control: a broken course must fail validation',
  );
  const anOffering = await get(
    `/offerings/${(await get(`/courses/${edux[0].courseId}/offerings?since=2000-01-01`)).body.items[0].offeringId}`,
  );
  const viaPath = validator(responseRef('/offerings/{offeringId}'));
  if (!viaPath(anOffering.body)) {
    warnings.push(
      `spec: /offerings/{offeringId} 200 schema (oneOf) rejects a valid CourseOffering: ${ajv.errorsText(viaPath.errors).slice(0, 160)}`,
    );
  }

  console.log('\nschema validations per target:');
  for (const [ref, n] of Object.entries(counts))
    console.log(`  ${String(n).padStart(4)}  ${ref.replace('oeapi#', '')}`);
  const uniqueWarnings = [...new Set(warnings.map((w) => w.replace(/^[^:]+: /, '')))];
  if (uniqueWarnings.length)
    console.log(`\nwarnings (${warnings.length}):\n  ${uniqueWarnings.join('\n  ')}`);
  console.log(`\n${checks} checks, ${failures.length} failures`);
  for (const f of failures.slice(0, 50)) console.log(`  FAIL ${f}`);
  return failures.length ? 1 : 0;
}

main()
  .then((code) => {
    child?.kill();
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    child?.kill();
    process.exit(2);
  });
