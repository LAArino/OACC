// SPDX-License-Identifier: EUPL-1.2
/** In-process OEAPI v5 endpoint behind the harvester's HttpTransport seam. */
import {
  type HttpTransport,
  type PinnedRequest,
  type Resolver,
  TransportError,
  type TransportResponse,
} from '../../src/ingestion/oeapi/http-transport.js';
import {
  COURSES,
  expandedOffering,
  type FixtureCourse,
  listedOffering,
  ROOT_ORGANIZATION,
  servedCourse,
  SUB_UNIT,
} from './oeapi-fixtures.js';

export const MOCK_HOST = 'oeapi.uibk.example';
export const MOCK_BASE_URL = `https://${MOCK_HOST}/oeapi/v5`;
export const MOCK_USER = 'oecp';
export const MOCK_PASSWORD = 'oecp-mock-secret';
export const PUBLIC_ADDRESS = '93.184.216.34';

export interface FakeOeapiOptions {
  courses?: FixtureCourse[];
  /** Path prefix (after the base path) → status to return instead of data. */
  failures?: Map<string, number>;
  /** Paths whose requests fail with a network error. */
  networkFailures?: Set<string>;
}

export interface FakeOeapi {
  transport: HttpTransport;
  resolve: Resolver;
  requests: PinnedRequest[];
  options: Required<Omit<FakeOeapiOptions, 'networkFailures'>> & {
    networkFailures: Set<string>;
  };
}

const json = (body: unknown, status = 200): TransportResponse => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: Buffer.from(JSON.stringify(body)),
});

function page(items: unknown[], url: URL): TransportResponse {
  const size = Number(url.searchParams.get('pageSize') ?? 10);
  const number = Number(url.searchParams.get('pageNumber') ?? 1);
  const slice = items.slice((number - 1) * size, number * size);
  return json({
    pageSize: size,
    pageNumber: number,
    hasPreviousPage: number > 1,
    hasNextPage: number * size < items.length,
    items: slice,
  });
}

export function createFakeOeapi(options: FakeOeapiOptions = {}): FakeOeapi {
  const state = {
    courses: options.courses ?? COURSES,
    failures: options.failures ?? new Map<string, number>(),
    networkFailures: options.networkFailures ?? new Set<string>(),
  };
  const requests: PinnedRequest[] = [];
  const expectedAuth = `Basic ${Buffer.from(`${MOCK_USER}:${MOCK_PASSWORD}`).toString('base64')}`;

  const transport: HttpTransport = async (request) => {
    requests.push(request);
    const url = request.url;
    const path = url.pathname.replace(/^\/oeapi\/v5/, '') || '/';
    if (state.networkFailures.has(path)) throw new TransportError('network', 'ECONNRESET');
    if (request.headers['authorization'] !== expectedAuth) {
      return json({ status: 401, title: 'Unauthorized' }, 401);
    }
    for (const [prefix, status] of state.failures) {
      if (path.startsWith(prefix)) return json({ status, title: 'Failure' }, status);
    }
    if (path === '/') {
      return json({
        contactEmail: 'oeapi@uibk.example',
        specification: 'https://open-education-api.github.io/specification/v5/docs.html',
        documentation: 'https://uibk.example/oeapi',
      });
    }
    if (path === '/organizations') {
      const all = [ROOT_ORGANIZATION, SUB_UNIT];
      const type = url.searchParams.get('organizationType');
      return page(
        all.filter((o) => !type || o.organizationType === type),
        url,
      );
    }
    if (path === '/courses') return page(state.courses.map(servedCourse), url);
    const offeringsOf = /^\/courses\/([^/]+)\/offerings$/.exec(path);
    if (offeringsOf) {
      const course = state.courses.find(
        (c) => c.courseId === decodeURIComponent(offeringsOf[1] ?? ''),
      );
      if (!course) return json({ status: 404 }, 404);
      const since = url.searchParams.get('since') ?? new Date().toISOString().slice(0, 10);
      return page(
        course.offerings.filter((o) => o.startDate >= since).map((o) => listedOffering(course, o)),
        url,
      );
    }
    const offering = /^\/offerings\/([^/]+)$/.exec(path);
    if (offering) {
      const id = decodeURIComponent(offering[1] ?? '');
      for (const course of state.courses) {
        const found = course.offerings.find((o) => o.offeringId === id);
        if (found) {
          return json(
            url.searchParams.get('expand') === 'academicSession'
              ? expandedOffering(course, found)
              : listedOffering(course, found),
          );
        }
      }
      return json({ status: 404 }, 404);
    }
    return json({ status: 404 }, 404);
  };

  const resolve: Resolver = async () => [{ address: PUBLIC_ADDRESS, family: 4 }];
  return { transport, resolve, requests, options: state };
}
