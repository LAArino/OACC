// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorPage from '../app/error.vue';
import CoursePage from '../app/pages/(public)/courses/[id].vue';
import CataloguePage from '../app/pages/(public)/courses/index.vue';
import HomePage from '../app/pages/(public)/index.vue';
import {
  axeViolations,
  COURSE_ID,
  fixtureHandler,
  fixtures,
  type Handler,
  notImplemented,
} from './helpers/catalogue';

const api = vi.hoisted(() => ({
  handler: undefined as undefined | ((url: string, options?: unknown) => Promise<unknown>),
  calls: [] as { url: string; options?: { query?: Record<string, unknown> } }[],
}));

mockNuxtImport(
  'useApi',
  () => () => (url: string, options?: { query?: Record<string, unknown> }) => {
    api.calls.push({ url, options });
    return api.handler!(url, options);
  },
);

// Pages answer API failures by throwing `createError` during setup (rendered as
// the error page with that status during SSR); record what they create.
const errors = vi.hoisted(() => ({ created: [] as { statusCode?: number }[] }));
mockNuxtImport(
  'createError',
  (original: (input: { statusCode?: number }) => unknown) => (input: { statusCode?: number }) => {
    errors.created.push(input);
    return original(input);
  },
);

async function mountFailing(component: unknown, route: string) {
  errors.created.length = 0;
  // The thrown error aborts setup; the test only checks which error was raised.
  await mountSuspended(component as never, { route }).catch(() => undefined);
  return errors.created.map((e) => e.statusCode);
}

beforeEach(() => {
  api.calls.length = 0;
  api.handler = fixtureHandler() as Handler;
  clearNuxtData();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const searchCalls = () => api.calls.filter((c) => c.url === '/api/public/v1/courses');

describe('home page', () => {
  it('introduces the catalogue with search, counts and quick links', async () => {
    const w = await mountSuspended(HomePage, { route: '/en' });
    expect(w.find('h1').text()).toBe('Find a course');
    expect(w.text()).toContain('universities of the alliance');
    const form = w.find('form[role="search"]');
    expect(form.attributes()).toMatchObject({ method: 'get', action: '/en/courses' });
    expect(form.find('input[name="q"]').attributes('role')).toBe('combobox');
    expect(w.find('.home__count a').text()).toBe('Browse 3 courses with upcoming offerings');
    expect(searchCalls()[0]!.options?.query).toEqual({ page_size: 1 });

    const fieldLinks = w.findAll('[aria-labelledby="fields-heading"] a');
    // Fields without courses are left out.
    expect(fieldLinks.map((a) => a.attributes('href'))).toEqual([
      '/en/courses?isced=05',
      '/en/courses?isced=06',
    ]);
    expect(fieldLinks[0]!.text()).toContain('Natural sciences, mathematics and statistics');
    expect(fieldLinks[0]!.text()).toContain('1 course');

    const partnerLinks = w.findAll('[aria-labelledby="partners-heading"] a');
    // Partners only (not the alliance itself), sorted by name.
    expect(partnerLinks.map((a) => a.attributes('href'))).toEqual([
      '/en/courses?partner=urv',
      '/en/courses?partner=univie',
      '/en/courses?partner=vu-amsterdam',
    ]);
    expect(partnerLinks[0]!.text()).toContain('Spain · 1 course');
  });

  it('still renders (status 200) when the catalogue API is down', async () => {
    api.handler = notImplemented;
    const w = await mountSuspended(HomePage, { route: '/en' });
    expect(w.find('form[role="search"]').exists()).toBe(true);
    expect(w.find('.notice').text()).toContain('temporarily unavailable');
    expect(w.find('.home__count').exists()).toBe(false);
  });

  it('lists every field when only the counts are unavailable', async () => {
    api.handler = fixtureHandler({ '/api/public/v1/courses': notImplemented }) as Handler;
    const w = await mountSuspended(HomePage, { route: '/en' });
    const fieldLinks = w.findAll('[aria-labelledby="fields-heading"] a');
    expect(fieldLinks).toHaveLength(4);
    expect(fieldLinks[0]!.text()).toBe('Arts and humanities');
  });

  it('has no axe violations', async () => {
    const w = await mountSuspended(HomePage, { route: '/en' });
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('catalogue page', () => {
  const route =
    '/en/courses?q=climate&partner=urv&mode=online&ects_min=3&upcoming=false&sort=title&page=1';

  it('queries the API with the URL state', async () => {
    await mountSuspended(CataloguePage, { route });
    expect(searchCalls().at(-1)!.options?.query).toEqual({
      q: 'climate',
      partner: ['urv'],
      mode: ['online'],
      ects_min: '3',
      upcoming: 'false',
      sort: 'title',
    });
  });

  it('renders results, count, chips, filters and sort from the URL', async () => {
    const w = await mountSuspended(CataloguePage, { route });
    expect(w.find('h1').text()).toBe('Courses');
    expect(w.find('#results-heading').text()).toContain('3 courses found');
    expect(w.find('#results-heading').text()).toContain('Showing 1–3 of 3');
    expect(w.findAll('.catalogue__list > li')).toHaveLength(3);
    expect(w.findAll('.catalogue__list h3').map((h) => h.text())).toEqual([
      'Climate Change and Mediterranean Ecosystems',
      'Responsible Artificial Intelligence',
      'European Philosophy of Science',
    ]);
    expect((w.find('input#q').element as HTMLInputElement).value).toBe('climate');
    expect((w.find('#filter-partner-urv').element as HTMLInputElement).checked).toBe(true);
    expect((w.find('#filter-include-past').element as HTMLInputElement).checked).toBe(true);
    expect((w.find('select#sort').element as HTMLSelectElement).value).toBe('title');
    expect(w.find('select#sort').attributes('form')).toBe('catalogue-form');
    expect(w.findAll('a.chip').map((c) => c.find('span').text())).toEqual([
      'Search: climate',
      'University: Universitat Rovira i Virgili',
      'Delivery mode: Online',
      'At least 3 ECTS',
      'Include past offerings',
    ]);
    const form = w.find('form#catalogue-form');
    expect(form.attributes()).toMatchObject({
      method: 'get',
      action: '/en/courses',
      role: 'search',
    });
    expect(w.find('[aria-labelledby="results-heading"]').attributes('aria-busy')).toBe('false');
  });

  it('paginates with links keeping the search', async () => {
    api.handler = fixtureHandler({
      '/api/public/v1/courses': async () => ({ ...fixtures.search, total: 45, page: 2 }),
    }) as Handler;
    const w = await mountSuspended(CataloguePage, { route: '/en/courses?partner=urv&page=2' });
    expect(w.find('#results-heading').text()).toContain('Showing 21–23 of 45');
    expect(w.find('a[rel="next"]').attributes('href')).toBe('/en/courses?partner=urv&page=3');
    expect(w.find('a[rel="prev"]').attributes('href')).toBe('/en/courses?partner=urv');
  });

  it('shows an empty state with ways out', async () => {
    api.handler = fixtureHandler({
      '/api/public/v1/courses': async () => ({ ...fixtures.search, items: [], total: 0 }),
    }) as Handler;
    const w = await mountSuspended(CataloguePage, { route: '/en/courses?q=zzz&partner=urv' });
    expect(w.find('#results-heading').text()).toBe('No courses found');
    const empty = w.find('.catalogue__empty');
    expect(empty.text()).toContain('No courses match your search.');
    expect(empty.findAll('a').map((a) => a.attributes('href'))).toEqual([
      '/en/courses?q=zzz',
      '/en/courses?q=zzz&partner=urv&upcoming=false',
    ]);
    expect(w.find('.pagination').exists()).toBe(false);
  });

  it('answers 503 when the catalogue API is unavailable (501 or 5xx)', async () => {
    api.handler = notImplemented;
    expect(await mountFailing(CataloguePage, '/en/courses')).toEqual([503]);
  });

  it('ignores malformed parameters instead of forwarding them', async () => {
    await mountSuspended(CataloguePage, {
      route: '/en/courses?partner=%3Cx%3E&isced=999&page=-2&sort=evil&ects_min=abc',
    });
    expect(searchCalls().at(-1)!.options?.query).toEqual({});
  });

  it('has no axe violations', async () => {
    const w = await mountSuspended(CataloguePage, { route });
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('course page', () => {
  const path = `/en/courses/${COURSE_ID}`;

  it('renders the header, breadcrumb, key facts and links', async () => {
    const w = await mountSuspended(CoursePage, { route: path });
    expect(w.find('h1').text()).toBe('Climate Change and Mediterranean Ecosystems');
    expect(w.find('h1').attributes('lang')).toBeUndefined();
    expect(w.find('.course__partner').text()).toBe('Universitat Rovira i Virgili · Spain');

    const crumbs = w.find('nav.breadcrumb');
    expect(crumbs.attributes('aria-label')).toBe('Breadcrumb');
    expect(crumbs.findAll('a').map((a) => a.attributes('href'))).toEqual(['/en', '/en/courses']);
    expect(crumbs.find('[aria-current="page"]').text()).toBe(
      'Climate Change and Mediterranean Ecosystems',
    );
    expect(w.find('.course__back a').attributes('href')).toBe('/en/courses');

    const facts = Object.fromEntries(
      w
        .findAll('.course__facts dt')
        .map((dt) => [
          dt.text(),
          (dt.element.nextElementSibling as HTMLElement).textContent?.trim(),
        ]),
    );
    expect(facts).toEqual({
      'Teaching unit': 'Faculty of Chemistry',
      'ECTS credits': '6',
      Level: 'Master, EQF level 7',
      'Teaching hours': '48',
      'Field of study': 'Natural sciences, mathematics and statistics',
      'Teaching languages': 'English, Catalan',
      'Delivery mode': 'Online, Hybrid',
      'Course code': 'URV-20345',
      Contact: 'international@urv.cat',
      'Last updated': 'Oct 12, 2026',
    });
    const info = w.find('.course__info a');
    expect(info.attributes()).toMatchObject({
      href: 'https://www.urv.cat/en/studies/climate',
      target: '_blank',
      rel: 'noopener',
    });
    expect(info.text()).toContain('More information');
  });

  it('sets title, description, canonical URL and schema.org JSON-LD in the head', async () => {
    await mountSuspended(CoursePage, { route: path });
    await vi.waitFor(() =>
      expect(document.head.querySelector('script[type="application/ld+json"]')).not.toBeNull(),
    );
    expect(document.title).toBe('Climate Change and Mediterranean Ecosystems');
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
      fixtures.course.texts.en.abstract,
    );
    const canonical = document.head.querySelector('link[rel="canonical"]')?.getAttribute('href');
    expect(canonical).toMatch(new RegExp(`^https?://[^/]+${path}$`));
    const ld = JSON.parse(
      document.head.querySelector('script[type="application/ld+json"]')!.textContent!,
    );
    expect(ld).toMatchObject({
      '@type': 'Course',
      name: 'Climate Change and Mediterranean Ecosystems',
      url: canonical,
      provider: { '@type': 'CollegeOrUniversity' },
    });
    expect(ld.hasCourseInstance).toHaveLength(2);
    expect(ld.hasCourseInstance[0].courseMode).toEqual(['Online', 'Blended']);
  });

  it('shows English texts by default with a language switcher', async () => {
    const w = await mountSuspended(CoursePage, { route: path });
    const tabs = w.findAll('[role="tab"]');
    expect(tabs.map((t) => [t.text(), t.attributes('aria-selected')])).toEqual([
      ['English', 'true'],
      ['Catalan', 'false'],
    ]);
    expect(tabs[1]!.attributes('href')).toBe(`${path}?text_lang=ca#course-texts`);
    const panel = w.find('#course-text-panel');
    expect(panel.attributes()).toMatchObject({
      lang: 'en',
      role: 'tabpanel',
      'aria-labelledby': 'text-tab-en',
    });
    expect(panel.findAll('h3').map((h) => h.text())).toEqual([
      'Summary',
      'Description',
      'Learning outcomes',
      'Prerequisites',
      'Assessment',
      'Keywords',
    ]);
    // Partner text is rendered as text, never as HTML.
    expect(panel.text()).toContain('Basic statistics. <script>alert(1)</script>');
    expect(panel.find('script').exists()).toBe(false);
    expect(panel.findAll('.tag-list li').map((li) => li.text())).toEqual([
      'climate',
      'ecology',
      'Mediterranean',
    ]);
  });

  it('switches the text language from the URL and marks it with lang', async () => {
    const w = await mountSuspended(CoursePage, { route: `${path}?text_lang=ca` });
    const panel = w.find('#course-text-panel');
    expect(panel.attributes('lang')).toBe('ca');
    expect(panel.find('h3').attributes('lang')).toBe('en');
    expect(panel.text()).toContain('This text was machine-translated.');
    expect(panel.text()).toContain('Canvi climàtic i ecosistemes mediterranis');
    expect(panel.text()).not.toContain('Learning outcomes');
    // The page title stays in the UI language.
    expect(w.find('h1').text()).toBe('Climate Change and Mediterranean Ecosystems');
  });

  it('lists offerings by start date with how to apply', async () => {
    const w = await mountSuspended(CoursePage, { route: path });
    expect(w.find('#offerings-heading').text()).toBe('Offerings (2)');
    const offerings = w.findAll('.course__offering-list > li');
    expect(offerings.map((o) => o.find('h3').text())).toEqual([
      'Spring semester 2027',
      'Sep 13, 2027 – Jan 21, 2028',
    ]);
    expect(offerings[0]!.find('a.button').text()).toContain(
      'Apply at Universitat Rovira i Virgili',
    );
    expect(offerings[0]!.text()).toContain('Application deadline passed');
    expect(offerings[1]!.find('a[href="mailto:international@urv.cat"]').exists()).toBe(true);
  });

  it('answers 404 for an unknown course and 503 when the API is down', async () => {
    expect(
      await mountFailing(CoursePage, '/en/courses/00000000-0000-4000-8000-000000000000'),
    ).toEqual([404]);
    clearNuxtData();
    api.handler = notImplemented;
    expect(await mountFailing(CoursePage, path)).toEqual([503]);
  });

  it('has no axe violations', async () => {
    const w = await mountSuspended(CoursePage, { route: path });
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('error page', () => {
  it.each([
    [503, 'Catalogue temporarily unavailable'],
    [404, 'Page not found'],
    [500, 'Something went wrong'],
  ])('explains status %i', async (statusCode, title) => {
    const w = await mountSuspended(ErrorPage, {
      props: { error: createError({ statusCode }) },
      route: '/en/courses',
    });
    expect(w.find('h1').text()).toBe(title);
    expect(w.findAll('a').map((a) => a.attributes('href'))).toContain('/en/courses');
    expect(w.text()).toContain(`Error ${statusCode}`);
  });
});
