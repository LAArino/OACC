// SPDX-License-Identifier: EUPL-1.2
// Test doubles for the catalogue API (`useApi()` is replaced by a function that
// answers from the JSON fixtures) and an axe-core helper for rendered markup.
import course from '../fixtures/catalogue/course.json';
import reference from '../fixtures/catalogue/reference.json';
import search from '../fixtures/catalogue/search.json';
import suggest from '../fixtures/catalogue/suggest.json';

export const fixtures = { course, reference, search, suggest };
export const COURSE_ID = course.id;

export type FetchOptions = { query?: Record<string, unknown>; signal?: AbortSignal };
export type Handler = (url: string, options?: FetchOptions) => Promise<unknown>;

/** Error shaped like ofetch's FetchError (`statusCode`, `data`). */
export function httpError(statusCode: number, title = 'Error'): Error {
  return Object.assign(new Error(`${statusCode} ${title}`), {
    statusCode,
    status: statusCode,
    data: { type: 'about:blank', title, status: statusCode },
  });
}

const clone = <T>(value: T): T => structuredClone(value);

/** Answers the catalogue endpoints from the fixtures; `overrides` per path wins. */
export function fixtureHandler(overrides: Record<string, Handler> = {}): Handler {
  return async (url, options) => {
    const override = overrides[url];
    if (override) return override(url, options);
    if (url === '/api/public/v1/courses') return clone(search);
    if (url === '/api/public/v1/reference') return clone(reference);
    if (url === '/api/public/v1/suggest') return clone(suggest);
    if (url === `/api/public/v1/courses/${encodeURIComponent(COURSE_ID)}`) return clone(course);
    throw httpError(404, 'Not Found');
  };
}

/** A handler failing like the API does before it is implemented. */
export const notImplemented: Handler = async () => {
  throw httpError(501, 'Not Implemented');
};

export interface AxeViolation {
  id: string;
  impact: string | null | undefined;
  nodes: string[];
}

/**
 * Runs axe-core (WCAG 2.0/2.1/2.2 A and AA rules) on markup inserted into the
 * test document. Colour contrast cannot be computed without layout and is
 * covered by test/contrast.test.ts.
 */
export async function axeViolations(html: string, wrap: 'main' | 'div' = 'main') {
  const axe = (await import('axe-core')).default;
  document.documentElement.lang = 'en';
  document.title = 'Test page';
  const container = document.createElement(wrap);
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const result = await axe.run(container, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    return result.violations.map<AxeViolation>((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.html),
    }));
  } finally {
    container.remove();
  }
}
