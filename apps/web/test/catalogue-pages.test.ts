// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorPage from '../app/error.vue';
import DefaultLayout from '../app/layouts/default.vue';
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

describe('home page header image', () => {
  const hero = () => useRuntimeConfig().public;
  const headMeta = (selector: string) =>
    document.head.querySelector(`meta[${selector}]`)?.getAttribute('content');
  afterEach(() => {
    hero().heroImage = '';
    hero().heroImageAlt = '';
  });

  it('renders a decorative banner above the title and link-preview meta', async () => {
    hero().heroImage = '/branding/hero.png';
    const w = await mountSuspended(HomePage, { route: '/en' });
    const banner = w.find('.home__hero > .home__banner');
    expect(banner.exists()).toBe(true);
    expect(banner.element.nextElementSibling?.tagName).toBe('H1');
    const img = banner.find('img');
    expect(img.attributes()).toMatchObject({
      src: '/branding/hero.png',
      alt: '',
      loading: 'eager',
      fetchpriority: 'high',
      decoding: 'async',
    });
    expect(img.html()).toContain('alt=""');
    await vi.waitFor(() =>
      expect(headMeta('property="og:image"')).toMatch(/^https?:\/\/[^/]+\/branding\/hero\.png$/),
    );
    expect(headMeta('name="twitter:card"')).toBe('summary_large_image');
    expect(await axeViolations(w.html())).toEqual([]);
    w.unmount();
  });

  it('uses the configured alt text and keeps an absolute image URL', async () => {
    hero().heroImage = 'https://cdn.example.eu/aurora/hero.webp';
    hero().heroImageAlt = 'Students on the campus lawn';
    const w = await mountSuspended(HomePage, { route: '/en' });
    expect(w.find('.home__banner img').attributes()).toMatchObject({
      src: 'https://cdn.example.eu/aurora/hero.webp',
      alt: 'Students on the campus lawn',
    });
    await vi.waitFor(() =>
      expect(headMeta('property="og:image"')).toBe('https://cdn.example.eu/aurora/hero.webp'),
    );
    w.unmount();
  });

  it('renders no banner and no image meta when unset', async () => {
    const w = await mountSuspended(HomePage, { route: '/en' });
    expect(w.find('.home__banner').exists()).toBe(false);
    expect(w.find('img').exists()).toBe(false);
    await vi.waitFor(() =>
      expect(headMeta('name="description"')).toContain('course catalogue of the alliance'),
    );
    // Head entries of the previous (unmounted) mounts are removed asynchronously.
    await vi.waitFor(() => expect(headMeta('property="og:image"')).toBeUndefined());
    expect(headMeta('name="twitter:card"')).toBeUndefined();
    w.unmount();
  });
});

describe('site header logo', () => {
  const pub = () => useRuntimeConfig().public;
  const slots = { default: () => 'page' };
  afterEach(() => {
    pub().logoImage = '';
  });

  it('shows the text brand when no logo is configured', async () => {
    const w = await mountSuspended(DefaultLayout, { route: '/en', slots });
    const brand = w.find('a.site-header__brand');
    expect(brand.text()).toBe('Open European Campus');
    expect(brand.find('img').exists()).toBe(false);
  });

  it('replaces the text brand with the logo, named after the alliance', async () => {
    pub().logoImage = '/branding/logo.svg';
    const w = await mountSuspended(DefaultLayout, { route: '/en', slots });
    const brand = w.find('a.site-header__brand');
    expect(brand.attributes('href')).toBe('/en');
    expect(brand.text()).toBe('');
    expect(brand.find('img.site-header__logo').attributes()).toMatchObject({
      src: '/branding/logo.svg',
      alt: pub().allianceName,
      height: '40',
      decoding: 'async',
    });
    expect(pub().allianceName).not.toBe('');
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

  it('sends kind and attribute filters from the URL, dropping the ones not offered [DL 18]', async () => {
    await mountSuspended(CataloguePage, {
      route:
        '/en/courses?kind=bip&attr_sdg=sdg_13&attr_sdg=sdg_99&attr_free_course=true' +
        '&attr_faculty=Chemistry&attr_nope=1&sort=deadline',
    });
    expect(searchCalls().at(-1)!.options?.query).toEqual({
      kind: ['bip'],
      attr_free_course: ['true'],
      attr_sdg: ['sdg_13'],
      sort: 'deadline',
    });
  });

  it('renders attribute filters, chips and the deadline sort from the URL', async () => {
    const w = await mountSuspended(CataloguePage, {
      route: '/en/courses?kind=bip&attr_sdg=sdg_13&attr_free_course=true&sort=deadline',
    });
    expect((w.find('#filter-kind-bip').element as HTMLInputElement).checked).toBe(true);
    expect((w.find('#filter-attr_sdg-sdg_13').element as HTMLInputElement).checked).toBe(true);
    expect((w.find('#filter-attr_free_course-true').element as HTMLInputElement).checked).toBe(
      true,
    );
    expect(w.find('#filter-attr_sdg-sdg_13').attributes('form')).toBe('catalogue-form');
    expect(w.findAll('a.chip').map((c) => c.find('span').text())).toEqual([
      'Type of course: Blended intensive programme (BIP)',
      'Sustainable Development Goals: SDG 13: Climate action',
      'Free course',
    ]);
    // The server-rendered markup selects the option (happy-dom's `select.value`
    // does not follow `selected` set on a later option).
    expect(w.findAll('select#sort option[selected]').map((o) => o.attributes('value'))).toEqual([
      'deadline',
    ]);
    const sort = w.find('select#sort').element as HTMLSelectElement;
    expect([...sort.options].map((o) => o.text)).toEqual([
      'Best match',
      'Title (A–Z)',
      'Next start date',
      'Application deadline',
    ]);
    // Cards with a deadline emphasise it.
    expect(w.findAll('.catalogue__list dd.is-highlighted').map((d) => d.text())).toEqual([
      'Dec 15, 2026',
      'Oct 1, 2026 (deadline passed)',
    ]);
    expect(w.find('.course-card__kind').text()).toBe('BIP');
  });

  it('renders an older API without kinds, levels or attributes', async () => {
    const { kinds: _k, attribute_definitions: _d, ...oldReference } = fixtures.reference;
    const oldSearch = {
      ...fixtures.search,
      items: fixtures.search.items.map((item) => {
        const { kind: _kind, levels: _levels, attributes: _attributes, ...card } = item;
        return card;
      }),
      facets: { ...fixtures.search.facets, kind: undefined, attributes: undefined },
    };
    api.handler = fixtureHandler({
      '/api/public/v1/reference': async () => oldReference,
      '/api/public/v1/courses': async () => oldSearch,
    }) as Handler;
    const w = await mountSuspended(CataloguePage, {
      route: '/en/courses?attr_sdg=sdg_13&kind=bip',
    });
    // No attribute schema: attribute filters are not sent.
    expect(searchCalls().at(-1)!.options?.query).toEqual({ kind: ['bip'] });
    expect(w.findAll('.catalogue__list > li')).toHaveLength(3);
    expect(w.find('.course-card__kind').exists()).toBe(false);
    expect(w.find('.course-card__tags').exists()).toBe(false);
    expect(w.find('input[name^="attr_"]').exists()).toBe(false);
    expect(w.text()).toContain('LevelMaster');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('has no axe violations', async () => {
    const w = await mountSuspended(CataloguePage, { route });
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('has no axe violations with attribute filters and the deadline sort', async () => {
    const w = await mountSuspended(CataloguePage, {
      route: '/en/courses?kind=bip&attr_sdg=sdg_13&attr_free_course=true&sort=deadline',
    });
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
        .findAll('.course__facts dl')[0]!
        .findAll('dt')
        .map((dt) => [
          dt.text(),
          (dt.element.nextElementSibling as HTMLElement).textContent?.trim(),
        ]),
    );
    expect(facts).toEqual({
      'Teaching unit': 'Faculty of Chemistry',
      'ECTS credits': '6',
      Type: 'Blended intensive programme (BIP)',
      Levels: 'Bachelor, Master (EQF level 7)',
      'Teaching hours': '48',
      'Field of study': 'Natural sciences, mathematics and statistics',
      'Teaching languages': 'English, Catalan',
      'Delivery mode': 'Online, Hybrid',
      'Course code': 'URV-20345',
      Instructors: 'Dr. Marta PuigDr. Joan Ferrer',
      Contact: 'international@urv.cat',
      'Last updated': 'Oct 12, 2026',
    });
    expect(w.findAll('.course__instructors li').map((li) => li.text())).toEqual([
      'Dr. Marta Puig',
      'Dr. Joan Ferrer',
    ]);
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
      educationalLevel: ['bachelor', 'master'],
    });
    expect(ld.hasCourseInstance).toHaveLength(2);
    expect(ld.hasCourseInstance[0].courseMode).toEqual(['Online', 'Blended']);
    // Instructors (names the page already shows) as schema.org Person on each instance.
    expect(ld.hasCourseInstance[0].instructor).toEqual([
      { '@type': 'Person', name: 'Dr. Marta Puig' },
      { '@type': 'Person', name: 'Dr. Joan Ferrer' },
    ]);
    expect(ld.instructor).toBeUndefined();
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
      'Methods',
      'Mode of repetition',
      'Literature',
      'Keywords',
      'Privacy notice',
    ]);
    // Line breaks kept (pre-line), plain text only; the privacy notice comes last, muted.
    const methods = panel.findAll('.course__text-section')[5]!;
    expect(methods.find('p').classes()).toContain('text-block');
    expect(methods.find('p').text()).toBe(
      'Lectures, seminars and field work.\nTeam projects in international groups.',
    );
    const privacy = panel.findAll('.course__text-section').at(-1)!;
    expect(privacy.classes()).toContain('course__privacy');
    expect(privacy.text()).toContain('<b>Not HTML</b>');
    expect(privacy.find('b').exists()).toBe(false);
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
    // The Catalan texts have none of the optional IT Handbook texts.
    expect(panel.text()).not.toContain('Methods');
    expect(panel.find('.course__privacy').exists()).toBe(false);
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

  it('lists every attribute of the course with labels [DL 18]', async () => {
    const w = await mountSuspended(CoursePage, { route: path });
    expect(w.find('#attributes-heading').text()).toBe('Course attributes');
    const list = w.findAll('.course__facts dl')[1]!;
    const pairs = list
      .findAll('dt')
      .map((dt) => [dt.text(), (dt.element.nextElementSibling as HTMLElement).textContent?.trim()]);
    expect(pairs).toEqual([
      ['Educational hub', 'Sustainability'],
      ['Sustainable Development Goals', 'SDG 13: Climate action, SDG 14: Life below water'],
      ['Target audience', 'Students, Doctoral candidates'],
      ['Aurora competence framework', 'LOUIS'],
      ['Micro-credential', 'Yes'],
      ['Free course', 'Yes'],
      ['Only for enrolled students', 'No'],
      ['Faculty', 'Faculty of Chemistry; Faculty of Tourism and Geography'],
    ]);
  });

  it('shows how to apply in the course text language', async () => {
    const w = await mountSuspended(CoursePage, { route: path });
    const first = w.findAll('.course__offering-list > li')[0]!;
    expect(first.find('.offering__instructions h4').text()).toBe('How to apply');
    expect(first.find('.offering__instructions p').text()).toBe(
      fixtures.course.offerings[0]!.application_instructions.en,
    );
    expect(
      w.findAll('.course__offering-list > li')[1]!.find('.offering__instructions').exists(),
    ).toBe(false);
    clearNuxtData();
    const ca = await mountSuspended(CoursePage, { route: `${path}?text_lang=ca` });
    const p = ca.find('.offering__instructions p');
    expect(p.attributes('lang')).toBe('ca');
    expect(p.text()).toBe(fixtures.course.offerings[0]!.application_instructions.ca);
  });

  it('renders a course from an older API (no kind, levels, attributes or instructions)', async () => {
    const { kind: _k, levels: _l, attributes: _a, instructors: _n, ...old } = fixtures.course;
    const oldCourse = {
      ...old,
      texts: {
        ...old.texts,
        en: {
          title: old.texts.en.title,
          abstract: old.texts.en.abstract,
          description: old.texts.en.description,
          learning_outcomes: old.texts.en.learning_outcomes,
          prerequisites: old.texts.en.prerequisites,
          assessment: old.texts.en.assessment,
          keywords: old.texts.en.keywords,
          is_machine_translated: false,
        },
      },
      offerings: old.offerings.map(({ application_instructions: _i, ...o }) => o),
    };
    api.handler = fixtureHandler({
      [`/api/public/v1/courses/${COURSE_ID}`]: async () => oldCourse,
    }) as Handler;
    const w = await mountSuspended(CoursePage, { route: path });
    const dts = w.findAll('.course__facts dt').map((dt) => dt.text());
    expect(dts).toContain('Level');
    expect(dts).not.toContain('Type');
    expect(w.findAll('.course__facts dl')).toHaveLength(1);
    expect(w.find('#attributes-heading').exists()).toBe(false);
    expect(w.find('.offering__instructions').exists()).toBe(false);
    expect(w.find('.course__offering-list a.button').exists()).toBe(true);
    // No instructors and none of the optional texts of DL 21.
    expect(dts).not.toContain('Instructors');
    expect(w.find('.course__instructors').exists()).toBe(false);
    expect(w.findAll('#course-text-panel h3').map((h) => h.text())).toEqual([
      'Summary',
      'Description',
      'Learning outcomes',
      'Prerequisites',
      'Assessment',
      'Keywords',
    ]);
    expect(await axeViolations(w.html())).toEqual([]);
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
