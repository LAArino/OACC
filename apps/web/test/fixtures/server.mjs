// SPDX-License-Identifier: EUPL-1.2
// Tiny fixture server for developing the public catalogue before the API is
// ready. It answers the anonymous catalogue endpoints from ./catalogue/*.json.
//
//   node apps/web/test/fixtures/server.mjs            # http://127.0.0.1:3901
//   NUXT_PUBLIC_API_BASE=http://127.0.0.1:3901 pnpm --filter @oecp/web dev
//
// FIXTURE_PORT changes the port; FIXTURE_DOWN=1 answers 501 everywhere (as the
// API does until it is implemented).
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const load = (name) =>
  JSON.parse(readFileSync(new URL(`./catalogue/${name}.json`, import.meta.url), 'utf8'));
const search = load('search');
const course = load('course');
const reference = load('reference');
const suggest = load('suggest');

const port = Number(process.env.FIXTURE_PORT ?? 3901);
const down = process.env.FIXTURE_DOWN === '1';

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function problem(res, status, title) {
  send(res, status, { type: 'about:blank', title, status }, 'application/problem+json');
}

/** Filters the fixture results a little so that facets and chips can be tried out. */
function searchResponse(params) {
  const q = (params.get('q') ?? '').toLowerCase();
  const partners = params.getAll('partner');
  const modes = params.getAll('mode');
  const langs = params.getAll('lang');
  const upcoming = params.get('upcoming') !== 'false';
  const items = search.items.filter(
    (c) =>
      (!q || c.title.toLowerCase().includes(q)) &&
      (!partners.length || partners.includes(c.organization.slug)) &&
      (!modes.length || c.delivery_modes.some((m) => modes.includes(m))) &&
      (!langs.length || c.teaching_languages.some((l) => langs.includes(l))) &&
      (!upcoming || c.next_offering !== null),
  );
  const pageSize = Number(params.get('page_size') ?? 20);
  return { ...search, items: items.slice(0, pageSize), total: items.length, page_size: pageSize };
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (down) return problem(res, 501, 'Not Implemented');
  const path = url.pathname.replace(/\/$/, '');
  if (path === '/api/public/v1/courses') return send(res, 200, searchResponse(url.searchParams));
  if (path === '/api/public/v1/reference') return send(res, 200, reference);
  if (path === '/api/public/v1/suggest') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    if (q.length < 2) return problem(res, 400, 'Bad Request');
    const items = suggest.items.filter((s) =>
      (typeof s.title === 'string' ? s.title : s.title.en).toLowerCase().includes(q),
    );
    return send(res, 200, { items });
  }
  if (path === '/api/public/v1/sitemap.xml') {
    return send(
      res,
      200,
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://oecp.localhost/en/courses/${course.id}</loc></url></urlset>\n`,
      'application/xml',
    );
  }
  const match = /^\/api\/public\/v1\/courses\/([^/]+)$/.exec(path);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const card = search.items.find((c) => c.id === id);
    if (id === course.id) return send(res, 200, course);
    if (card) {
      // Minimal detail built from the search card.
      return send(res, 200, {
        ...course,
        id: card.id,
        ext_id: card.ext_id,
        organization: card.organization,
        texts: { en: { ...course.texts.en, title: card.title, abstract: card.abstract } },
        ects: card.ects,
        level: card.level,
        offerings: [],
      });
    }
    return problem(res, 404, 'Not Found');
  }
  return problem(res, 404, 'Not Found');
}).listen(port, '127.0.0.1', () => {
  console.log(`catalogue fixtures on http://127.0.0.1:${port}${down ? ' (501 mode)' : ''}`);
});
