#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
//
// OEAPI v5.0 mock: a simulated partner university endpoint (consumer profile
// `eduxchange`) for developing and demonstrating the OACC harvester (spec v4.0
// §6.2) without real partner credentials. Node 22, no dependencies.
//
//   node tools/oeapi-mock/server.mjs
//
// Environment (see README.md):
//   PORT                           listen port (default 8090)
//   OEAPI_MOCK_DATASET             dataset JSON (default ./data/uibk.json next to this file)
//   OEAPI_MOCK_AUTH                none | basic:<user>:<pass> | bearer:<token> | apikey:<header>:<value>
//   OEAPI_MOCK_LATENCY_MS          added delay per request (default 0)
//   OEAPI_MOCK_FAIL_RATE           probability 0..1 of a random 503 (default 0)
//   OEAPI_MOCK_RATE_LIMIT_PER_SEC  requests per second before 429 (default 0 = unlimited)
//   OEAPI_MOCK_TODAY               YYYY-MM-DD used as "today" for the default `since` (default: UTC date)

import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function fail(msg) {
  process.stderr.write(`oeapi-mock: ${msg}\n`);
  process.exit(64);
}

function parseNumber(name, value, def, { min = 0, max = Infinity } = {}) {
  if (value === undefined || value === '') return def;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    fail(`${name} must be a number in [${min}, ${max}], got "${value}"`);
  return n;
}

function parseAuth(spec) {
  if (!spec || spec === 'none') return { scheme: 'none' };
  const i = spec.indexOf(':');
  const kind = i < 0 ? spec : spec.slice(0, i);
  const rest = i < 0 ? '' : spec.slice(i + 1);
  if (kind === 'basic') {
    const j = rest.indexOf(':');
    if (j <= 0) fail('OEAPI_MOCK_AUTH basic needs basic:<user>:<pass>');
    return {
      scheme: 'basic',
      expected: Buffer.from(`${rest.slice(0, j)}:${rest.slice(j + 1)}`, 'utf8'),
    };
  }
  if (kind === 'bearer') {
    if (!rest) fail('OEAPI_MOCK_AUTH bearer needs bearer:<token>');
    return { scheme: 'bearer', expected: Buffer.from(rest, 'utf8') };
  }
  if (kind === 'apikey') {
    const j = rest.indexOf(':');
    if (j <= 0 || j === rest.length - 1)
      fail('OEAPI_MOCK_AUTH apikey needs apikey:<header>:<value>');
    return {
      scheme: 'apikey',
      header: rest.slice(0, j).toLowerCase(),
      headerName: rest.slice(0, j),
      expected: Buffer.from(rest.slice(j + 1), 'utf8'),
    };
  }
  fail(`OEAPI_MOCK_AUTH: unknown scheme "${kind}" (none | basic | bearer | apikey)`);
}

const env = process.env;
const PORT = parseNumber('PORT', env.PORT, 8090, { min: 1, max: 65535 });
const LATENCY_MS = parseNumber('OEAPI_MOCK_LATENCY_MS', env.OEAPI_MOCK_LATENCY_MS, 0, {
  max: 120_000,
});
const FAIL_RATE = parseNumber('OEAPI_MOCK_FAIL_RATE', env.OEAPI_MOCK_FAIL_RATE, 0, { max: 1 });
const RATE_LIMIT = parseNumber(
  'OEAPI_MOCK_RATE_LIMIT_PER_SEC',
  env.OEAPI_MOCK_RATE_LIMIT_PER_SEC,
  0,
);
const AUTH = parseAuth(env.OEAPI_MOCK_AUTH);
const TODAY_OVERRIDE = env.OEAPI_MOCK_TODAY || null;
if (TODAY_OVERRIDE && !isDate(TODAY_OVERRIDE)) fail('OEAPI_MOCK_TODAY must be YYYY-MM-DD');
const DATASET_PATH = env.OEAPI_MOCK_DATASET
  ? isAbsolute(env.OEAPI_MOCK_DATASET)
    ? env.OEAPI_MOCK_DATASET
    : resolve(process.cwd(), env.OEAPI_MOCK_DATASET)
  : join(here, 'data', 'uibk.json');

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

function loadDataset(path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(`cannot read dataset ${path}: ${err.message}`);
  }
  for (const key of ['service', 'organizations', 'academicSessions', 'courses', 'offerings']) {
    if (!data[key]) fail(`dataset ${path} has no "${key}"`);
  }
  const byId = (list, key) => new Map(list.map((x) => [x[key], x]));
  return {
    meta: data.meta ?? {},
    service: data.service,
    organizations: data.organizations,
    sessions: data.academicSessions,
    courses: data.courses,
    offerings: data.offerings,
    orgById: byId(data.organizations, 'organizationId'),
    sessionById: byId(data.academicSessions, 'academicSessionId'),
    courseById: byId(data.courses, 'courseId'),
    offeringById: byId(data.offerings, 'offeringId'),
  };
}

const db = loadDataset(DATASET_PATH);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVELS = new Set([
  'secondary vocational education',
  'secondary vocational education 1',
  'secondary vocational education 2',
  'secondary vocational education 3',
  'secondary vocational education 4',
  'associate degree',
  'bachelor',
  'master',
  'doctoral',
  'undefined',
  'undivided',
  'nt2-1',
  'nt2-2',
]);
const MODES = new Set(['distance-learning', 'on campus', 'online', 'hybrid', 'situated']);
const ORG_TYPES = new Set([
  'root',
  'institute',
  'department',
  'faculty',
  'branch',
  'academy',
  'school',
]);
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;

function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const today = () => TODAY_OVERRIDE ?? new Date().toISOString().slice(0, 10);

class HttpError extends Error {
  constructor(status, title, detail, headers = {}) {
    super(detail ?? title);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.headers = headers;
  }
}
const badRequest = (detail) => new HttpError(400, 'Bad Request', detail);
const notFound = (detail) => new HttpError(404, 'Not Found', detail);

/** Comma-separated and/or repeated query values. */
function listParam(params, name) {
  return params
    .getAll(name)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

function pathId(value, name) {
  if (!UUID_RE.test(value)) throw badRequest(`${name} must be a UUID`);
  return value.toLowerCase();
}

function parseExpand(params, allowed) {
  const values = listParam(params, 'expand');
  for (const v of values) {
    if (!allowed.includes(v))
      throw badRequest(`expand: unsupported value "${v}" (allowed: ${allowed.join(', ')})`);
  }
  return new Set(values);
}

function paginate(params, items) {
  const rawSize = params.get('pageSize');
  const rawNumber = params.get('pageNumber');
  let pageSize = DEFAULT_PAGE_SIZE;
  if (rawSize !== null) {
    if (!/^\d+$/.test(rawSize) || Number(rawSize) < 1)
      throw badRequest('pageSize must be a positive integer');
    pageSize = Math.min(Number(rawSize), MAX_PAGE_SIZE);
  }
  let pageNumber = 1;
  if (rawNumber !== null) {
    if (!/^\d+$/.test(rawNumber) || Number(rawNumber) < 1)
      throw badRequest('pageNumber must be an integer >= 1');
    pageNumber = Number(rawNumber);
  }
  const totalPages = Math.ceil(items.length / pageSize);
  const start = (pageNumber - 1) * pageSize;
  return {
    pageSize,
    pageNumber,
    hasPreviousPage: pageNumber > 1,
    hasNextPage: start + pageSize < items.length,
    totalPages,
    items: items.slice(start, start + pageSize),
  };
}

/** Best display string for sorting: English first, then the first value. */
function sortName(lts) {
  const en = lts?.find((x) => x.language?.startsWith('en'));
  return (en ?? lts?.[0])?.value ?? '';
}

function sorter(params, fields, def) {
  const keys = listParam(params, 'sort');
  const list = keys.length ? keys : [def];
  for (const k of list) {
    const f = k.replace(/^-/, '');
    if (!fields[f])
      throw badRequest(
        `sort: unsupported value "${k}" (allowed: ${Object.keys(fields).join(', ')}, prefix - for descending)`,
      );
  }
  return (a, b) => {
    for (const k of list) {
      const desc = k.startsWith('-');
      const get = fields[k.replace(/^-/, '')];
      const x = get(a);
      const y = get(b);
      const c = typeof x === 'string' ? x.localeCompare(y, 'en') : x - y;
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  };
}

function hasConsumer(entity, consumer) {
  return (entity.consumers ?? []).some((c) => c.consumerKey === consumer);
}

function matchesSearch(entity, q) {
  const needle = q.toLowerCase();
  const texts = [...(entity.name ?? []), ...(entity.description ?? [])].map((x) => x.value);
  if (entity.abbreviation) texts.push(entity.abbreviation);
  return texts.some((t) => t?.toLowerCase().includes(needle));
}

/** Shared course/offering filters: consumer, q/search, teachingLanguage, modeOfDelivery. */
function commonFilters(params) {
  const filters = [];
  const consumer = params.get('consumer');
  if (consumer) filters.push((e) => hasConsumer(e, consumer));
  const q = params.get('q') ?? params.get('search');
  if (q) filters.push((e) => matchesSearch(e, q));
  const lang = params.get('teachingLanguage');
  if (lang !== null) {
    if (!/^[a-z]{3}$/.test(lang))
      throw badRequest('teachingLanguage must be an ISO 639-2 code (three lower-case letters)');
    filters.push((e) => e.teachingLanguage === lang);
  }
  const modes = listParam(params, 'modeOfDelivery');
  for (const m of modes)
    if (!MODES.has(m)) throw badRequest(`modeOfDelivery: unsupported value "${m}"`);
  if (modes.length) filters.push((e) => (e.modeOfDelivery ?? []).some((m) => modes.includes(m)));
  return filters;
}

const clone = (x) => structuredClone(x);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function getService() {
  return clone(db.service);
}

function listOrganizations(params) {
  let items = db.organizations;
  const type = params.get('organizationType');
  if (type !== null) {
    if (!ORG_TYPES.has(type)) throw badRequest(`organizationType: unsupported value "${type}"`);
    items = items.filter((o) => o.organizationType === type);
  }
  const consumer = params.get('consumer');
  if (consumer) items = items.filter((o) => hasConsumer(o, consumer));
  const code = params.get('primaryCode');
  if (code) items = items.filter((o) => o.primaryCode?.code === code);
  const q = params.get('q') ?? params.get('search');
  if (q) items = items.filter((o) => matchesSearch(o, q));
  items = [...items].sort(
    sorter(
      params,
      { name: (o) => sortName(o.name), organizationId: (o) => o.organizationId },
      'name',
    ),
  );
  return paginate(params, items.map(clone));
}

function getOrganization(params, rawId) {
  const org = db.orgById.get(pathId(rawId, 'organizationId'));
  if (!org) throw notFound(`organization ${rawId} not found`);
  const expand = parseExpand(params, ['parent', 'children']);
  const out = clone(org);
  if (expand.has('parent') && typeof out.parent === 'string')
    out.parent = clone(db.orgById.get(out.parent));
  if (expand.has('children') && Array.isArray(out.children))
    out.children = out.children.map((c) => clone(db.orgById.get(c) ?? c));
  return out;
}

function listAcademicSessions(params) {
  let items = db.sessions;
  const type = params.get('academicSessionType');
  if (type) items = items.filter((s) => s.academicSessionType === type);
  for (const rel of ['parent', 'year']) {
    const v = params.get(rel);
    if (v !== null) {
      const want = pathId(v, rel);
      items = items.filter((s) => s[rel] === want);
    }
  }
  const consumer = params.get('consumer');
  if (consumer) items = items.filter((s) => hasConsumer(s, consumer));
  const code = params.get('primaryCode');
  if (code) items = items.filter((s) => s.primaryCode?.code === code);
  items = [...items].sort(
    sorter(
      params,
      {
        startDate: (s) => s.startDate,
        name: (s) => sortName(s.name),
        academicSessionId: (s) => s.academicSessionId,
      },
      'startDate',
    ),
  );
  return paginate(params, items.map(clone));
}

function getAcademicSession(params, rawId) {
  const s = db.sessionById.get(pathId(rawId, 'academicSessionId'));
  if (!s) throw notFound(`academic session ${rawId} not found`);
  const expand = parseExpand(params, ['parent', 'children', 'year']);
  const out = clone(s);
  for (const rel of ['parent', 'year']) {
    if (expand.has(rel) && typeof out[rel] === 'string')
      out[rel] = clone(db.sessionById.get(out[rel]));
  }
  if (expand.has('children') && Array.isArray(out.children))
    out.children = out.children.map((c) => clone(db.sessionById.get(c) ?? c));
  return out;
}

function listCourses(params) {
  const filters = commonFilters(params);
  const level = params.get('level');
  if (level !== null) {
    if (!LEVELS.has(level)) throw badRequest(`level: unsupported value "${level}"`);
    filters.push((c) => c.level === level);
  }
  const code = params.get('primaryCode');
  if (code) filters.push((c) => c.primaryCode?.code === code);
  const items = db.courses
    .filter((c) => filters.every((f) => f(c)))
    .sort(sorter(params, { name: (c) => sortName(c.name), courseId: (c) => c.courseId }, 'name'));
  return paginate(params, items.map(clone));
}

function getCourse(params, rawId) {
  const c = db.courseById.get(pathId(rawId, 'courseId'));
  if (!c) throw notFound(`course ${rawId} not found`);
  const expand = parseExpand(params, [
    'programs',
    'coordinators',
    'organization',
    'educationSpecification',
  ]);
  const out = clone(c);
  if (expand.has('organization') && typeof out.organization === 'string')
    out.organization = clone(db.orgById.get(out.organization));
  return out;
}

function listCourseOfferings(params, rawId) {
  const courseId = pathId(rawId, 'courseId');
  if (!db.courseById.has(courseId)) throw notFound(`course ${rawId} not found`);
  const filters = commonFilters(params);
  // v5: "By default only future offerings are shown (equal to ?since=<today>)".
  const since = params.get('since') ?? today();
  if (!isDate(since)) throw badRequest('since must be a full-date (YYYY-MM-DD)');
  filters.push((o) => o.startDate >= since);
  const until = params.get('until');
  if (until !== null) {
    if (!isDate(until)) throw badRequest('until must be a full-date (YYYY-MM-DD)');
    filters.push((o) => o.endDate <= until);
  }
  const resultExpected = params.get('resultExpected');
  if (resultExpected !== null) {
    if (resultExpected !== 'true' && resultExpected !== 'false')
      throw badRequest('resultExpected must be true or false');
    filters.push((o) => o.resultExpected === (resultExpected === 'true'));
  }
  const items = db.offerings
    .filter((o) => o.course === courseId && filters.every((f) => f(o)))
    .sort(
      sorter(
        params,
        {
          startDate: (o) => o.startDate,
          endDate: (o) => o.endDate,
          name: (o) => sortName(o.name),
          offeringId: (o) => o.offeringId,
        },
        'startDate',
      ),
    );
  return paginate(params, items.map(clone));
}

function getOffering(params, rawId) {
  const o = db.offeringById.get(pathId(rawId, 'offeringId'));
  if (!o) throw notFound(`offering ${rawId} not found`);
  const expand = parseExpand(params, [
    'program',
    'programOffering',
    'course',
    'courseOffering',
    'component',
    'organization',
    'academicSession',
  ]);
  const out = clone(o);
  if (expand.has('academicSession') && typeof out.academicSession === 'string') {
    const s = db.sessionById.get(out.academicSession);
    if (s) out.academicSession = clone(s);
  }
  if (expand.has('course') && typeof out.course === 'string') {
    const c = db.courseById.get(out.course);
    if (c) out.course = clone(c);
  }
  return out;
}

const ROUTES = [
  [/^\/$/, getService],
  [/^\/organizations$/, listOrganizations],
  [/^\/organizations\/([^/]+)$/, getOrganization],
  [/^\/academic-sessions$/, listAcademicSessions],
  [/^\/academic-sessions\/([^/]+)$/, getAcademicSession],
  [/^\/courses$/, listCourses],
  [/^\/courses\/([^/]+)$/, getCourse],
  [/^\/courses\/([^/]+)\/offerings$/, listCourseOfferings],
  [/^\/offerings\/([^/]+)$/, getOffering],
];

// ---------------------------------------------------------------------------
// Cross-cutting: auth, rate limit, fault injection
// ---------------------------------------------------------------------------

function safeEqual(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Returns 'none' | 'ok' | 'missing' | 'invalid'. */
function checkAuth(req) {
  if (AUTH.scheme === 'none') return 'none';
  if (AUTH.scheme === 'apikey') {
    const v = req.headers[AUTH.header];
    if (v === undefined) return 'missing';
    return safeEqual(Buffer.from(String(v), 'utf8'), AUTH.expected) ? 'ok' : 'invalid';
  }
  const h = req.headers.authorization;
  if (!h) return 'missing';
  const m = /^(\S+) (.+)$/.exec(h);
  if (!m) return 'invalid';
  const scheme = m[1].toLowerCase();
  if (AUTH.scheme === 'basic') {
    if (scheme !== 'basic') return 'invalid';
    return safeEqual(Buffer.from(m[2].trim(), 'base64'), AUTH.expected) ? 'ok' : 'invalid';
  }
  if (scheme !== 'bearer') return 'invalid';
  return safeEqual(Buffer.from(m[2].trim(), 'utf8'), AUTH.expected) ? 'ok' : 'invalid';
}

function challenge(outcome) {
  const realm = 'realm="OEAPI mock (University of Innsbruck)"';
  if (AUTH.scheme === 'basic') return `Basic ${realm}, charset="UTF-8"`;
  if (AUTH.scheme === 'bearer')
    return outcome === 'invalid' ? `Bearer ${realm}, error="invalid_token"` : `Bearer ${realm}`;
  return `ApiKey ${realm}, header="${AUTH.headerName}"`;
}

// Fixed one-second window, global (one harvester per partner, spec §6.2.1).
let windowStart = 0;
let windowCount = 0;
function rateLimited(now) {
  if (!RATE_LIMIT) return null;
  if (now - windowStart >= 1000) {
    windowStart = now;
    windowCount = 0;
  }
  windowCount += 1;
  if (windowCount <= RATE_LIMIT) return null;
  return Math.max(1, Math.ceil((windowStart + 1000 - now) / 1000));
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function send(res, status, body, contentType, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(res.req.method === 'HEAD' ? undefined : payload);
  return Buffer.byteLength(payload);
}

function sendProblem(res, err) {
  // The v5 Problem schema types `status` as a string.
  const body = { status: String(err.status), title: err.title };
  if (err.detail) body.detail = err.detail;
  return send(res, err.status, body, 'application/problem+json', err.headers);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Container healthchecks bypass rate limiting and fault injection (not auth).
const isHealthcheck = (req) =>
  req.headers['x-oeapi-mock-healthcheck'] === '1' &&
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

async function handle(req, res) {
  const started = performance.now();
  const url = new URL(req.url, 'http://mock.invalid');
  let auth = '-';
  let bytes = 0;
  try {
    if (LATENCY_MS) await sleep(LATENCY_MS);
    const health = isHealthcheck(req);
    if (!health) {
      const retry = rateLimited(Date.now());
      if (retry !== null) {
        throw new HttpError(
          429,
          'Too Many Requests',
          `rate limit of ${RATE_LIMIT} requests per second exceeded`,
          { 'Retry-After': String(retry) },
        );
      }
      if (FAIL_RATE && Math.random() < FAIL_RATE) {
        throw new HttpError(503, 'Service Unavailable', 'injected failure (OEAPI_MOCK_FAIL_RATE)', {
          'Retry-After': '1',
        });
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new HttpError(
        405,
        'Method Not Allowed',
        `${req.method} is not supported; this endpoint is read-only`,
        { Allow: 'GET, HEAD' },
      );
    }
    auth = checkAuth(req);
    if (auth === 'missing' || auth === 'invalid') {
      throw new HttpError(
        401,
        'Unauthorized',
        auth === 'missing' ? 'credentials required' : 'invalid credentials',
        {
          'WWW-Authenticate': challenge(auth),
        },
      );
    }
    const accept = req.headers.accept ?? '';
    if (/version\s*=\s*6/i.test(accept)) {
      throw new HttpError(
        406,
        'Not Acceptable',
        'this endpoint serves OEAPI v5.0 only (Accept: application/json)',
      );
    }
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    let body;
    for (const [re, fn] of ROUTES) {
      const m = re.exec(path);
      if (m) {
        body = fn(url.searchParams, ...m.slice(1).map(decodeURIComponent));
        break;
      }
    }
    if (body === undefined) throw notFound(`no route for ${path}`);
    bytes = send(res, 200, body, 'application/json');
  } catch (err) {
    let problem = err;
    if (!(err instanceof HttpError)) {
      process.stderr.write(`oeapi-mock: internal error: ${err.stack ?? err}\n`);
      problem = new HttpError(500, 'Internal Server Error');
    }
    bytes = sendProblem(res, problem);
  } finally {
    const ms = (performance.now() - started).toFixed(1);
    const who = req.socket.remoteAddress ?? '-';
    process.stderr.write(
      `${new Date().toISOString()} ${who} "${req.method} ${url.pathname}${url.search}" ${res.statusCode} ${bytes}B ${ms}ms auth=${auth}\n`,
    );
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    process.stderr.write(`oeapi-mock: unhandled: ${err.stack ?? err}\n`);
    if (!res.headersSent) res.writeHead(500).end();
  });
});
server.keepAliveTimeout = 5000;

server.listen(PORT, () => {
  const m = db.meta.counts ?? {};
  process.stderr.write(
    `oeapi-mock: OEAPI v5.0 on :${PORT} dataset=${DATASET_PATH} (${db.courses.length} courses, ${db.offerings.length} offerings${m.eduxchangeCourses !== undefined ? `, ${m.eduxchangeCourses} eduxchange` : ''}) ` +
      `auth=${AUTH.scheme} latency=${LATENCY_MS}ms failRate=${FAIL_RATE} rateLimit=${RATE_LIMIT || 'off'}/s today=${today()}${TODAY_OVERRIDE ? ' (override)' : ''}\n`,
  );
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
