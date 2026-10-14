#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño
// SPDX-License-Identifier: EUPL-1.2
//
// Container healthcheck: GET / (service document) with the credentials from
// OEAPI_MOCK_AUTH. Exit 0 on HTTP 200, 1 otherwise. The marker header lets the
// server skip rate limiting and fault injection for loopback healthchecks.

const port = process.env.PORT || '8090';
const spec = process.env.OEAPI_MOCK_AUTH || 'none';
const headers = { Accept: 'application/json', 'X-OEAPI-Mock-Healthcheck': '1' };
const [kind, ...rest] = spec.split(':');
if (kind === 'basic')
  headers.Authorization = `Basic ${Buffer.from(rest.join(':')).toString('base64')}`;
else if (kind === 'bearer') headers.Authorization = `Bearer ${rest.join(':')}`;
else if (kind === 'apikey') headers[rest[0]] = rest.slice(1).join(':');

fetch(`http://127.0.0.1:${port}/`, { headers, signal: AbortSignal.timeout(4000) }).then(
  (r) => process.exit(r.status === 200 ? 0 : 1),
  () => process.exit(1),
);
