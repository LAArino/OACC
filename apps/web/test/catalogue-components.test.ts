// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterLink } from 'vue-router';
import CatalogueFilters from '../app/components/CatalogueFilters.vue';
import CataloguePagination from '../app/components/CataloguePagination.vue';
import CourseCard from '../app/components/CourseCard.vue';
import CourseSearchBox from '../app/components/CourseSearchBox.vue';
import FilterChips from '../app/components/FilterChips.vue';
import LanguageTabs from '../app/components/LanguageTabs.vue';
import OfferingDetails from '../app/components/OfferingDetails.vue';
import SeatsLine from '../app/components/SeatsLine.vue';
import type {
  CourseCard as CourseCardData,
  Offering,
  ReferenceData,
  SearchFacets,
} from '../app/types/catalogue';
import { emptySearchState, parseSearchState } from '../app/utils/catalogue';
import {
  axeViolations,
  fixtureHandler,
  fixtures,
  type Handler,
  httpError,
} from './helpers/catalogue';

const api = vi.hoisted(() => ({
  handler: undefined as undefined | ((url: string, options?: unknown) => Promise<unknown>),
  calls: [] as { url: string; options?: unknown }[],
}));
const navigation = vi.hoisted(() => ({ navigateTo: vi.fn() }));

mockNuxtImport('useApi', () => () => (url: string, options?: unknown) => {
  api.calls.push({ url, options });
  return api.handler!(url, options);
});
mockNuxtImport('navigateTo', () => navigation.navigateTo);
// Partner logos of the branding directory, by organization slug (useBrandingIndex).
const branding = vi.hoisted(() => ({ logos: {} as Record<string, string> }));
mockNuxtImport('useBrandingIndex', () => () => ({
  files: { value: [] as string[] },
  partnerLogo: (slug: string) => branding.logos[slug],
}));

const reference = fixtures.reference as unknown as ReferenceData;
const card = (i: number) => fixtures.search.items[i] as unknown as CourseCardData;
const offering = (i: number) => fixtures.course.offerings[i] as unknown as Offering;

beforeEach(() => {
  api.calls.length = 0;
  api.handler = fixtureHandler() as Handler;
  navigation.navigateTo.mockReset();
  branding.logos = {};
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SeatsLine [DL 8]', () => {
  const asOf = '2026-10-10T23:30:00Z';
  const seats = (
    o: {
      seats_available: number | null;
      seats_updated_at: string | null;
      alliance_seats: number | null;
    },
    timeZone?: string,
  ) => mountSuspended(SeatsLine, { props: { offering: o, timeZone } });

  it('shows available and alliance seats together, the date in the offering time zone', async () => {
    const w = await seats(
      { seats_available: 12, seats_updated_at: asOf, alliance_seats: 5 },
      'Europe/Madrid',
    );
    expect(w.text()).toBe('Seats available: 12 (as of Oct 11, 2026) · Alliance seats: 5');
    expect(w.find('[aria-hidden="true"]').text()).toBe('·');
  });

  it('shows available seats alone', async () => {
    const w = await seats({ seats_available: 12, seats_updated_at: asOf, alliance_seats: null });
    expect(w.text()).toBe('Seats available: 12 (as of Oct 10, 2026)');
  });

  it('shows alliance seats alone when the count has no timestamp', async () => {
    const w = await seats({ seats_available: 12, seats_updated_at: null, alliance_seats: 5 });
    expect(w.text()).toBe('Alliance seats: 5');
  });

  it.each([
    { seats_available: 12, seats_updated_at: null, alliance_seats: null },
    { seats_available: null, seats_updated_at: null, alliance_seats: null },
  ])('renders nothing for %o', async (o) => {
    const w = await seats(o);
    expect(w.find('p').exists()).toBe(false);
  });
});

describe('FilterChips', () => {
  const state = parseSearchState({
    q: 'climate',
    partner: ['urv', 'univie'],
    mode: 'online',
    ects_min: '3',
    upcoming: 'false',
    sort: 'title',
    page: '3',
  });

  async function mountChips() {
    return mountSuspended(FilterChips, {
      props: { state, reference, listPath: '/en/courses' },
    });
  }

  it('lists every active filter with a remove link', async () => {
    const w = await mountChips();
    const chips = w.findAll('a.chip');
    expect(chips.map((c) => c.attributes('aria-label'))).toEqual([
      'Remove filter Search: climate',
      'Remove filter University: Universitat Rovira i Virgili',
      'Remove filter University: University of Vienna',
      'Remove filter Delivery mode: Online',
      'Remove filter At least 3 ECTS',
      'Remove filter Include past offerings',
    ]);
    // Visible text is part of the accessible name (WCAG 2.5.3).
    for (const chip of chips) {
      const visible = chip.find('span').text();
      expect(chip.attributes('aria-label')).toContain(visible);
    }
  });

  it('does not mark the remove links as the current page on the list path', async () => {
    const w = await mountSuspended(FilterChips, {
      props: { state, reference, listPath: '/en/courses' },
      route: '/en/courses?q=climate&partner=urv&partner=univie&mode=online',
      global: { stubs: { NuxtLink: RouterLink } },
    });
    expect(w.findAll('a.chip').length).toBeGreaterThan(1);
    expect(w.findAll('a.router-link-exact-active').length).toBeGreaterThan(0);
    expect(w.findAll('a[aria-current]')).toHaveLength(0);
  });

  it('links to the same search without that value, on page 1', async () => {
    const w = await mountChips();
    const href = (i: number) => new URL(w.findAll('a.chip')[i]!.attributes('href')!, 'http://x');
    const withoutUrv = href(1);
    expect(withoutUrv.pathname).toBe('/en/courses');
    expect(withoutUrv.searchParams.getAll('partner')).toEqual(['univie']);
    expect(withoutUrv.searchParams.get('q')).toBe('climate');
    expect(withoutUrv.searchParams.get('mode')).toBe('online');
    expect(withoutUrv.searchParams.get('sort')).toBe('title');
    expect(withoutUrv.searchParams.has('page')).toBe(false);
    expect(href(5).searchParams.has('upcoming')).toBe(false);
    expect(href(0).searchParams.has('q')).toBe(false);
  });

  it('offers to clear everything and reports navigation', async () => {
    const w = await mountChips();
    const clear = w.find('a.filter-chips__clear');
    expect(clear.text()).toBe('Clear all');
    expect(clear.attributes('href')).toBe('/en/courses?sort=title');
    await w.findAll('a.chip')[0]!.trigger('click');
    expect(w.emitted('navigate')).toHaveLength(1);
  });

  it('labels kind and attribute filters and removes them one by one [DL 18]', async () => {
    const s = parseSearchState({
      kind: 'bip',
      attr_free_course: 'true',
      attr_sdg: ['sdg_13', 'sdg_15'],
      attr_unknown_key: 'x',
      sort: 'deadline',
    });
    const w = await mountSuspended(FilterChips, {
      props: { state: s, reference, listPath: '/en/courses' },
    });
    const chips = w.findAll('a.chip');
    expect(chips.map((c) => c.find('span').text())).toEqual([
      'Type of course: Blended intensive programme (BIP)',
      'Sustainable Development Goals: SDG 13: Climate action',
      'Sustainable Development Goals: SDG 15: Life on land',
      'Free course',
      'unknown key: x',
    ]);
    const href = (i: number) => new URL(chips[i]!.attributes('href')!, 'http://x').searchParams;
    expect(href(0).has('kind')).toBe(false);
    expect(href(1).getAll('attr_sdg')).toEqual(['sdg_15']);
    expect(href(1).get('attr_free_course')).toBe('true');
    expect(href(1).get('kind')).toBe('bip');
    expect(href(1).get('sort')).toBe('deadline');
    expect(href(3).has('attr_free_course')).toBe(false);
    expect(href(3).getAll('attr_sdg')).toEqual(['sdg_13', 'sdg_15']);
    expect(w.find('a.filter-chips__clear').attributes('href')).toBe('/en/courses?sort=deadline');
  });

  it('renders nothing without filters', async () => {
    const w = await mountSuspended(FilterChips, {
      props: { state: emptySearchState(), reference, listPath: '/en/courses' },
    });
    expect(w.find('ul').exists()).toBe(false);
  });

  it('has no axe violations', async () => {
    const w = await mountChips();
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('CourseSearchBox (combobox with listbox popup)', () => {
  async function mountBox() {
    const w = await mountSuspended(CourseSearchBox, {
      props: {
        id: 'q',
        label: 'Search courses',
        debounceMs: 0,
        partnerName: (s: string) => `P:${s}`,
      },
      attachTo: document.body,
    });
    const input = w.find('input');
    return { w, input };
  }

  async function typeText(
    input: ReturnType<Awaited<ReturnType<typeof mountBox>>['w']['find']>,
    value: string,
  ) {
    await input.setValue(value);
    await vi
      .waitFor(() => expect(api.calls.length).toBeGreaterThan(0), { timeout: 1000 })
      .catch(() => undefined);
    await flushPromises();
    await new Promise((r) => setTimeout(r, 5));
    await flushPromises();
  }

  it('exposes the combobox pattern once hydrated', async () => {
    const { w, input } = await mountBox();
    expect(input.attributes()).toMatchObject({
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': 'false',
      'aria-controls': 'q-listbox',
      name: 'q',
      type: 'search',
    });
    expect(w.find('label').attributes('for')).toBe('q');
    expect(w.find('#q-listbox').attributes('role')).toBe('listbox');
    w.unmount();
  });

  it('does not query below two characters', async () => {
    const { w, input } = await mountBox();
    await input.setValue('c');
    await new Promise((r) => setTimeout(r, 10));
    expect(api.calls).toHaveLength(0);
    w.unmount();
  });

  it('shows suggestions, announces them and navigates with the keyboard', async () => {
    const { w, input } = await mountBox();
    await typeText(input, 'cli');
    expect(api.calls[0]).toMatchObject({ url: '/api/public/v1/suggest' });
    expect((api.calls[0]!.options as { query: unknown }).query).toEqual({ q: 'cli' });
    expect(input.attributes('aria-expanded')).toBe('true');
    const options = w.findAll('[role="option"]');
    expect(options).toHaveLength(3);
    expect(options[0]!.text()).toContain('Climate Change and Mediterranean Ecosystems');
    expect(options[0]!.text()).toContain('P:urv');
    expect(w.find('[role="status"]').text()).toBe(
      '3 suggestions available, use the up and down arrow keys to review them',
    );
    expect(input.attributes('aria-activedescendant')).toBeUndefined();

    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(input.attributes('aria-activedescendant')).toBe('q-option-0');
    expect(w.find('#q-option-0').attributes('aria-selected')).toBe('true');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(input.attributes('aria-activedescendant')).toBe('q-option-2');
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(input.attributes('aria-activedescendant')).toBe('q-option-0');
    await input.trigger('keydown', { key: 'ArrowUp' });
    expect(input.attributes('aria-activedescendant')).toBe('q-option-2');
    expect(w.find('#q-option-0').attributes('aria-selected')).toBe('false');

    await input.trigger('keydown', { key: 'Enter' });
    expect(navigation.navigateTo).toHaveBeenCalledWith(
      '/en/courses/6f1d2c3b-0000-4000-8000-000000000005',
    );
    expect(input.attributes('aria-expanded')).toBe('false');
    w.unmount();
  });

  it('closes with Escape, then clears the field', async () => {
    const { w, input } = await mountBox();
    await typeText(input, 'cli');
    expect(input.attributes('aria-expanded')).toBe('true');
    await input.trigger('keydown', { key: 'Escape' });
    expect(input.attributes('aria-expanded')).toBe('false');
    expect((input.element as HTMLInputElement).value).toBe('cli');
    await input.trigger('keydown', { key: 'Escape' });
    expect((input.element as HTMLInputElement).value).toBe('');
    w.unmount();
  });

  it('lets Enter submit the form when no option is active', async () => {
    const { w, input } = await mountBox();
    await typeText(input, 'cli');
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    input.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(navigation.navigateTo).not.toHaveBeenCalled();
    w.unmount();
  });

  it('chooses an option with the mouse', async () => {
    const { w, input } = await mountBox();
    await typeText(input, 'cli');
    await w.findAll('[role="option"]')[1]!.trigger('click');
    expect(navigation.navigateTo).toHaveBeenCalledWith(
      '/en/courses/6f1d2c3b-0000-4000-8000-000000000004',
    );
    w.unmount();
  });

  it('stays closed when suggestions fail', async () => {
    api.handler = async () => {
      throw httpError(501);
    };
    const { w, input } = await mountBox();
    await typeText(input, 'cli');
    expect(input.attributes('aria-expanded')).toBe('false');
    expect(w.findAll('[role="option"]')).toHaveLength(0);
    w.unmount();
  });

  it('has no axe violations while open', async () => {
    const { w, input } = await mountBox();
    await typeText(input, 'cli');
    await input.trigger('keydown', { key: 'ArrowDown' });
    const html = w.html();
    w.unmount();
    expect(await axeViolations(html)).toEqual([]);
  });
});

describe('CataloguePagination', () => {
  async function pagesOf(total: number, page: number) {
    const state = { ...parseSearchState({ partner: 'urv' }), page };
    const w = await mountSuspended(CataloguePagination, {
      props: { state, total, pageSize: 20, listPath: '/en/courses' },
    });
    return w;
  }

  it('marks only the current page as current on the list path itself', async () => {
    // On /en/courses the router marks every link to it as the current page,
    // whatever the query. The test router's NuxtLink never marks links active:
    // the router's own RouterLink stands in for it.
    const state = { ...parseSearchState({ partner: 'urv' }), page: 2 };
    const w = await mountSuspended(CataloguePagination, {
      props: { state, total: 95, pageSize: 20, listPath: '/en/courses' },
      route: '/en/courses?partner=urv&page=2',
      global: { stubs: { NuxtLink: RouterLink } },
    });
    expect(w.findAll('a.router-link-exact-active').length).toBeGreaterThan(0);
    const current = w.findAll('[aria-current]');
    expect(current).toHaveLength(1);
    expect(current[0]!.element.tagName).toBe('SPAN');
    expect(current[0]!.text()).toContain('Page 2');
  });

  it('renders nothing for a single page', async () => {
    const w = await pagesOf(20, 1);
    expect(w.find('nav').exists()).toBe(false);
  });

  it('marks the current page and links the others with the search kept', async () => {
    const w = await pagesOf(95, 3);
    expect(w.find('nav').attributes('aria-label')).toBe('Result pages');
    const items = w
      .findAll('li')
      .map((li) =>
        li.find('.visually-hidden').exists() ? li.find('.visually-hidden').text() : li.text(),
      );
    expect(items).toEqual([
      '‹ Previous',
      'Page 1',
      'Page 2',
      'Page 3',
      'Page 4',
      'Page 5',
      'Next ›',
    ]);
    expect(w.find('[aria-current="page"] .visually-hidden').text()).toBe('Page 3');
    expect(w.find('a[rel="prev"]').attributes('href')).toBe('/en/courses?partner=urv&page=2');
    expect(w.find('a[rel="next"]').attributes('href')).toBe('/en/courses?partner=urv&page=4');
    expect(
      w
        .findAll('a')
        .find((a) => a.text() === 'Page 11')!
        .attributes('href'),
    ).toBe('/en/courses?partner=urv');
  });

  it('elides distant pages', async () => {
    const w = await pagesOf(300, 7);
    const items = w
      .findAll('li')
      .map((li) =>
        li.find('.visually-hidden').exists() ? li.find('.visually-hidden').text() : li.text(),
      );
    expect(items).toEqual([
      '‹ Previous',
      'Page 1',
      '…',
      'Page 6',
      'Page 7',
      'Page 8',
      '…',
      'Page 15',
      'Next ›',
    ]);
  });
});

describe('LanguageTabs', () => {
  async function mountTabs() {
    return mountSuspended(LanguageTabs, {
      props: {
        languages: ['en', 'ca', 'de'],
        active: 'en',
        label: 'Language of the course description',
        panelId: 'panel',
        hrefFor: (lang: string) => `/en/courses/x?text_lang=${lang}`,
      },
      attachTo: document.body,
    });
  }

  it('follows the tabs pattern with link fallbacks', async () => {
    const w = await mountTabs();
    expect(w.find('[role="tablist"]').attributes('aria-label')).toBe(
      'Language of the course description',
    );
    const tabs = w.findAll('[role="tab"]');
    expect(tabs.map((t) => t.text())).toEqual(['English', 'Catalan', 'German']);
    expect(tabs.map((t) => t.attributes('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((t) => t.attributes('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(tabs[1]!.attributes('href')).toBe('/en/courses/x?text_lang=ca');
    expect(tabs[1]!.attributes('aria-controls')).toBe('panel');
    w.unmount();
  });

  it('selects with arrow keys, Home and End', async () => {
    const w = await mountTabs();
    const tabs = w.findAll('[role="tab"]');
    await tabs[0]!.trigger('keydown', { key: 'ArrowRight' });
    await tabs[0]!.trigger('keydown', { key: 'ArrowLeft' });
    await tabs[0]!.trigger('keydown', { key: 'End' });
    await tabs[2]!.trigger('keydown', { key: 'Home' });
    await tabs[1]!.trigger('click');
    expect(w.emitted('select')).toEqual([['ca'], ['de'], ['de'], ['en'], ['ca']]);
    w.unmount();
  });
});

describe('OfferingDetails', () => {
  async function mountOffering(o: Offering, contactEmail: string | null = 'international@urv.cat') {
    return mountSuspended(OfferingDetails, {
      props: { offering: o, partner: 'Universitat Rovira i Virgili', contactEmail, reference },
    });
  }

  it('shows dates, enrolment window, deadline (passed), modes, languages, campus and seats', async () => {
    const w = await mountOffering(offering(0));
    const text = w.text();
    expect(w.find('h3').text()).toBe('Spring semester 2027');
    expect(text).toContain('Application deadline passed');
    expect(text).toContain('Feb 8, 2027 – Jun 11, 2027');
    expect(text).toContain('Sep 1, 2026 – Oct 1, 2026');
    expect(w.find('.is-passed').text()).toBe('Oct 1, 2026 (deadline passed)');
    expect(text).toContain('Europe/Madrid');
    expect(text).toContain('Online, Hybrid');
    expect(text).toContain('English, Catalan');
    expect(text).toContain('Campus Catalunya, Tarragona');
    expect(text).toContain('Seats available: 12 (as of Oct 10, 2026) · Alliance seats: 5');
  });

  it('links to the application in a new tab and shows its host', async () => {
    const w = await mountOffering(offering(0));
    const apply = w.find('a.button');
    expect(apply.attributes()).toMatchObject({
      href: 'https://apply.urv.cat/aurora/20345',
      target: '_blank',
      rel: 'noopener',
    });
    expect(apply.text()).toContain('Apply at Universitat Rovira i Virgili');
    expect(apply.text()).toContain('(apply.urv.cat)');
    expect(apply.text()).toContain('(opens in a new tab)');
  });

  it('asks to contact the partner when there is no application link', async () => {
    const w = await mountOffering(offering(1));
    expect(w.find('a.button').exists()).toBe(false);
    expect(w.find('a[href="mailto:international@urv.cat"]').exists()).toBe(true);
    expect(w.text()).toContain('To apply, contact Universitat Rovira i Virgili:');
    expect(w.text()).toContain('Alliance seats: 8');
    expect(w.text()).not.toContain('deadline passed');

    const noEmail = await mountOffering(offering(1), null);
    expect(noEmail.text()).toContain('To apply, contact Universitat Rovira i Virgili.');
  });

  it('shows how to apply above the application link, as plain text [DL 18]', async () => {
    const w = await mountOffering(offering(0));
    const section = w.find('.offering__instructions');
    expect(section.find('h4').text()).toBe('How to apply');
    expect(section.attributes('aria-labelledby')).toBe(section.find('h4').attributes('id'));
    const text = section.find('p.text-block');
    expect(text.text()).toBe(fixtures.course.offerings[0]!.application_instructions.en);
    expect(text.attributes('lang')).toBeUndefined();
    // Instructions come before the apply action.
    const html = w.html();
    expect(html.indexOf('offering__instructions')).toBeLessThan(html.indexOf('offering__apply'));
  });

  it('follows the course text language, falling back to English', async () => {
    const mountIn = (textLang: string) =>
      mountSuspended(OfferingDetails, {
        props: { offering: offering(0), partner: 'URV', reference, textLang },
      });
    const ca = await mountIn('ca');
    expect(ca.find('.offering__instructions p').attributes('lang')).toBe('ca');
    expect(ca.find('.offering__instructions p').text()).toContain("Contacta amb l'oficina Aurora");
    const de = await mountIn('de');
    expect(de.find('.offering__instructions p').attributes('lang')).toBeUndefined();
    expect(de.find('.offering__instructions p').text()).toContain('Contact the Aurora office');
  });

  it('never renders instructions as HTML', async () => {
    const w = await mountOffering({
      ...offering(0),
      application_instructions: { en: 'Write to <b>us</b>.\n<script>alert(1)</script>' },
    });
    const p = w.find('.offering__instructions p');
    expect(p.text()).toContain('Write to <b>us</b>.');
    expect(p.find('b').exists()).toBe(false);
    expect(p.find('script').exists()).toBe(false);
  });

  it('shows no instructions when there are none (or with an older API)', async () => {
    expect((await mountOffering(offering(1))).find('.offering__instructions').exists()).toBe(false);
    const { application_instructions: _omitted, ...old } = offering(0);
    const w = await mountOffering(old as Offering);
    expect(w.find('.offering__instructions').exists()).toBe(false);
    expect(w.find('a.button').exists()).toBe(true);
  });

  it('never links unsafe application URLs', async () => {
    const w = await mountOffering({ ...offering(0), application_url: 'javascript:alert(1)' });
    expect(w.find('a.button').exists()).toBe(false);
  });

  it('labels cancelled offerings and drops the apply action', async () => {
    const w = await mountOffering({ ...offering(0), status: 'cancelled' });
    expect(w.find('.offering__badge').text()).toBe('Cancelled');
    expect(w.find('a.button').exists()).toBe(false);
    expect(w.text()).not.toContain('Seats available');
    expect(w.find('.offering__instructions').exists()).toBe(false);
  });

  it('has no axe violations', async () => {
    const w = await mountOffering(offering(0));
    expect(await axeViolations(w.html())).toEqual([]);
  });
});

describe('CourseCard', () => {
  it('summarises a course and its next offering', async () => {
    const w = await mountSuspended(CourseCard, { props: { course: card(0), reference } });
    expect(w.find('h3 a').attributes('href')).toBe(
      '/en/courses/6f1d2c3b-0000-4000-8000-000000000001',
    );
    expect(w.find('h3 a').attributes('lang')).toBeUndefined();
    const text = w.text();
    expect(text).toContain('Universitat Rovira i Virgili · Spain');
    expect(text).toContain('ECTS credits6');
    expect(text).toContain('LevelsBachelor, Master');
    expect(text).toContain('Delivery modeOnline, Hybrid');
    expect(text).toContain('Teaching languagesEnglish, Catalan');
    expect(text).toContain('Next offeringFeb 8, 2027 – Jun 11, 2027');
    expect(text).toContain('Application deadlineDec 15, 2026');
    expect(text).toContain('Seats available: 12 (as of Oct 10, 2026) · Alliance seats: 5');
    expect(text).toContain('1 more offering');
  });

  it('shows a kind badge, and attribute tags capped at four with "+N" [DL 18]', async () => {
    const w = await mountSuspended(CourseCard, { props: { course: card(0), reference } });
    const badge = w.find('.course-card__kind');
    expect(badge.text()).toBe('BIP');
    // The badge follows the title in reading order.
    expect(w.html().indexOf('course-card__kind')).toBeGreaterThan(w.html().indexOf('<h3'));
    const tags = w.find('ul.course-card__tags');
    expect(tags.attributes('aria-label')).toBe('Course attributes');
    expect(tags.findAll('li').map((li) => li.text())).toEqual([
      'Sustainability',
      'SDG 13: Climate action',
      'SDG 14: Life below water',
      'Micro-credential',
      '+11 more attribute',
    ]);
    expect(tags.find('.course-card__more [aria-hidden="true"]').text()).toBe('+1');
    expect(tags.find('.course-card__more .visually-hidden').text()).toBe('1 more attribute');
  });

  it('shows no badge for plain courses, and only tag attributes', async () => {
    const w = await mountSuspended(CourseCard, { props: { course: card(1), reference } });
    expect(w.find('.course-card__kind').exists()).toBe(false);
    expect(w.findAll('.course-card__tags li').map((li) => li.text())).toEqual(['Free course']);
    expect(w.text()).toContain('LevelBachelor');
    const lecture = await mountSuspended(CourseCard, { props: { course: card(2), reference } });
    expect(lecture.find('.course-card__kind').text()).toBe('Lecture series');
    expect(lecture.find('.course-card__tags').exists()).toBe(false);
  });

  it('renders an older API card (no kind, levels or attributes)', async () => {
    const { kind: _k, levels: _l, attributes: _a, ...old } = card(0);
    const w = await mountSuspended(CourseCard, {
      props: { course: old as CourseCardData, reference },
    });
    expect(w.find('.course-card__kind').exists()).toBe(false);
    expect(w.find('.course-card__tags').exists()).toBe(false);
    expect(w.text()).toContain('LevelMaster');
    expect(w.text()).toContain('Application deadlineDec 15, 2026');
    // Without the attribute schema in the reference data there are no tags either.
    const { attribute_definitions: _d, ...oldReference } = reference;
    const noSchema = await mountSuspended(CourseCard, {
      props: { course: card(0), reference: oldReference as ReferenceData },
    });
    expect(noSchema.find('.course-card__tags').exists()).toBe(false);
    expect(noSchema.find('.course-card__kind').text()).toBe('BIP');
  });

  it('highlights the deadline when results are sorted by it', async () => {
    const plain = await mountSuspended(CourseCard, { props: { course: card(0), reference } });
    expect(plain.find('.is-highlighted').exists()).toBe(false);
    const w = await mountSuspended(CourseCard, {
      props: { course: card(0), reference, highlightDeadline: true },
    });
    expect(w.findAll('.is-highlighted').map((e) => e.text())).toEqual([
      'Application deadline',
      'Dec 15, 2026',
    ]);
  });

  it('has no axe violations', async () => {
    const w = await mountSuspended(CourseCard, {
      props: { course: card(0), reference, highlightDeadline: true },
    });
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('marks a passed deadline and alliance seats', async () => {
    const w = await mountSuspended(CourseCard, { props: { course: card(1), reference } });
    expect(w.find('.is-passed').text()).toBe('Oct 1, 2026 (deadline passed)');
    expect(w.text()).toContain('Alliance seats: 20');
    expect(w.text()).toContain('COIL (virtual exchange)');
  });

  it('says when nothing is scheduled', async () => {
    const w = await mountSuspended(CourseCard, { props: { course: card(2), reference } });
    expect(w.text()).toContain('No upcoming offering scheduled.');
    expect(w.text()).toContain('University of Vienna · Austria');
    expect(w.find('.seats').exists()).toBe(false);
  });

  it("shows the partner's logo next to its name, decorative, when the branding has one", async () => {
    branding.logos = { urv: '/branding/partner-urv.svg' };
    const w = await mountSuspended(CourseCard, { props: { course: card(0), reference } });
    const partner = w.find('.course-card__partner');
    const img = partner.find('img.course-card__logo');
    expect(img.attributes()).toMatchObject({
      src: '/branding/partner-urv.svg',
      alt: '',
      height: '24',
      loading: 'lazy',
    });
    // Next to the name, not instead of it.
    expect(partner.text()).toBe('Universitat Rovira i Virgili · Spain');
    expect(await axeViolations(w.html())).toEqual([]);
    // Another partner without a logo file shows none.
    const other = await mountSuspended(CourseCard, { props: { course: card(2), reference } });
    expect(other.find('.course-card__partner img').exists()).toBe(false);
  });

  it('shows no logo when the branding has none', async () => {
    const w = await mountSuspended(CourseCard, { props: { course: card(0), reference } });
    expect(w.find('.course-card__partner img').exists()).toBe(false);
    expect(w.find('.course-card__partner').text()).toBe('Universitat Rovira i Virgili · Spain');
  });

  it('shows the course image as a 16:9 thumbnail, after the text in reading order [DL 27]', async () => {
    const w = await mountSuspended(CourseCard, { props: { course: card(0), reference } });
    const media = w.find('.course-card__media');
    expect(w.find('article').classes()).toContain('has-image');
    // Last in the markup (shown above the text by CSS): the title stays first.
    expect(w.find('article').element.lastElementChild).toBe(media.element);
    const img = media.find('img');
    expect(img.attributes()).toMatchObject({
      src: '/media/courses/6f1d2c3b-0000-4000-8000-000000000001/3f9a1c0d2b4e6a81.sm.webp',
      alt: 'Pine forest on a rocky Mediterranean coastline at sunset',
      width: '640',
      height: '360',
      loading: 'lazy',
      decoding: 'async',
    });
    expect(img.attributes('lang')).toBeUndefined();
    // Not a link: the title link remains the only way into the course.
    expect(media.find('a').exists()).toBe(false);
    expect(w.findAll('a').map((a) => a.text())).toEqual([
      'Climate Change and Mediterranean Ecosystems',
    ]);
    // The partner line is unchanged.
    expect(w.find('.course-card__partner').text()).toBe('Universitat Rovira i Virgili · Spain');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('gives a decorative image an empty alt, and renders no box without an image', async () => {
    const decorative = await mountSuspended(CourseCard, { props: { course: card(1), reference } });
    const img = decorative.find('.course-card__media img');
    expect(img.html()).toContain('alt=""');
    expect(img.attributes()).toMatchObject({ width: '640', height: '640' });
    expect(await axeViolations(decorative.html())).toEqual([]);

    const none = await mountSuspended(CourseCard, { props: { course: card(2), reference } });
    expect(none.find('.course-card__media').exists()).toBe(false);
    expect(none.find('article').classes()).not.toContain('has-image');
    // An older API without the member renders the same.
    const { image: _i, ...old } = card(0);
    const older = await mountSuspended(CourseCard, {
      props: { course: old as CourseCardData, reference },
    });
    expect(older.find('.course-card__media').exists()).toBe(false);
    expect(await axeViolations(none.html())).toEqual([]);
  });

  it('marks texts that fell back to another language', async () => {
    const w = await mountSuspended(CourseCard, {
      props: { course: { ...card(0), title_lang: 'ca', abstract_lang: 'ca' }, reference },
    });
    expect(w.find('h3 a').attributes('lang')).toBe('ca');
    expect(w.find('.course-card__abstract').attributes('lang')).toBe('ca');
  });
});

describe('CatalogueFilters', () => {
  const facets = fixtures.search.facets as unknown as SearchFacets;

  it('renders real form controls with counts, owned by the GET form', async () => {
    const state = parseSearchState({
      partner: ['urv', 'aurora'],
      ects_max: '6',
      upcoming: 'false',
    });
    const w = await mountSuspended(CatalogueFilters, {
      props: { state, facets, reference, formId: 'catalogue-form' },
    });
    const partners = w.findAll('input[name="partner"]');
    expect(partners.map((p) => p.attributes('value'))).toEqual([
      'urv',
      'vu-amsterdam',
      'univie',
      'aurora',
    ]);
    expect(partners.map((p) => (p.element as HTMLInputElement).checked)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    for (const input of w.findAll('input, button[type="submit"]')) {
      expect(input.attributes('form')).toBe('catalogue-form');
    }
    expect(w.find('label[for="filter-partner-urv"]').text()).toBe(
      'Universitat Rovira i Virgili (1), 1 course',
    );
    expect(w.findAll('fieldset legend').map((l) => l.text())).toEqual([
      'University',
      'Type of course',
      'Delivery mode',
      'Teaching language',
      'Field of study',
      'Level',
      'Educational hub',
      'Sustainable Development Goals',
      'Target audience',
      'Course features',
      'ECTS credits',
    ]);
    expect((w.find('input[name="ects_max"]').element as HTMLInputElement).value).toBe('6');
    const past = w.find('input[name="upcoming"]');
    expect(past.attributes('value')).toBe('false');
    expect((past.element as HTMLInputElement).checked).toBe(true);
    expect(w.find('h2').text()).toBe('Filters 4 active');
  });

  it('offers kinds and filterable attributes with counts, checked from the URL [DL 18]', async () => {
    const state = parseSearchState({
      kind: 'bip',
      attr_sdg: ['sdg_14', 'sdg_15'],
      attr_free_course: 'true',
    });
    const w = await mountSuspended(CatalogueFilters, {
      props: { state, facets, reference, formId: 'catalogue-form' },
    });
    const kinds = w.findAll('input[name="kind"]');
    expect(kinds.map((k) => k.attributes('value'))).toEqual(['bip', 'course', 'lecture_series']);
    expect(w.find('label[for="filter-kind-bip"]').text()).toBe(
      'Blended intensive programme (BIP) (1), 1 course',
    );
    expect((kinds[0]!.element as HTMLInputElement).checked).toBe(true);

    const sdg = w.findAll('input[name="attr_sdg"]');
    // Facet values, plus a selected value without results (count 0).
    expect(sdg.map((i) => i.attributes('value'))).toEqual(['sdg_13', 'sdg_14', 'sdg_15']);
    expect(sdg.map((i) => (i.element as HTMLInputElement).checked)).toEqual([false, true, true]);
    expect(w.find('label[for="filter-attr_sdg-sdg_15"]').text()).toBe(
      'SDG 15: Life on land (0), no courses',
    );
    expect(w.find('label[for="filter-attr_target_audience-phd"]').text()).toBe(
      'Doctoral candidates (1), 1 course',
    );
    // Not filterable: no group.
    expect(w.find('input[name="attr_competence_framework"]').exists()).toBe(false);
    expect(w.find('input[name="attr_faculty"]').exists()).toBe(false);

    const hub = w.find('input[name="attr_educational_hub"]').element.closest('fieldset')!;
    expect(hub.getAttribute('aria-describedby')).toBe('filter-attr_educational_hub-hint');
    expect(w.find('#filter-attr_educational_hub-hint').text()).toBe(
      'Aurora hub the course belongs to.',
    );

    const features = w
      .findAll('fieldset')
      .find((f) => f.find('legend').text() === 'Course features')!;
    const booleans = features.findAll('input');
    expect(booleans.map((b) => [b.attributes('name'), b.attributes('value')])).toEqual([
      ['attr_micro_credential', 'true'],
      ['attr_free_course', 'true'],
      ['attr_only_enrolled', 'true'],
    ]);
    expect(booleans.map((b) => (b.element as HTMLInputElement).checked)).toEqual([
      false,
      true,
      false,
    ]);
    expect(features.find('label[for="filter-attr_free_course-true"]').text()).toBe(
      'Free course (2), 2 courses',
    );
    for (const input of w.findAll('input')) {
      expect(input.attributes('form')).toBe('catalogue-form');
    }
    expect(w.find('h2').text()).toBe('Filters 4 active');
  });

  it('lists attribute options from the schema when there are no facets', async () => {
    const w = await mountSuspended(CatalogueFilters, {
      props: { state: emptySearchState(), facets: null, reference, formId: 'f' },
    });
    expect(
      w.findAll('input[name="attr_educational_hub"]').map((i) => i.attributes('value')),
    ).toEqual(['sustainability', 'digital_society', 'social_inclusion']);
    expect(w.find('label[for="filter-attr_micro_credential-true"]').text()).toBe(
      'Micro-credential',
    );
    expect(w.findAll('input[name="kind"]')).toHaveLength(4);
  });

  it('shows no kind or attribute groups with an older API', async () => {
    const { kind: _k, attributes: _a, ...oldFacets } = facets;
    const { kinds: _kinds, attribute_definitions: _d, ...oldReference } = reference;
    const w = await mountSuspended(CatalogueFilters, {
      props: {
        state: emptySearchState(),
        facets: oldFacets as SearchFacets,
        reference: oldReference as ReferenceData,
        formId: 'f',
      },
    });
    expect(w.findAll('fieldset legend').map((l) => l.text())).toEqual([
      'University',
      'Delivery mode',
      'Teaching language',
      'Field of study',
      'Level',
      'ECTS credits',
    ]);
  });

  it('applies checkbox changes at once but not typing in the ECTS range', async () => {
    const w = await mountSuspended(CatalogueFilters, {
      props: { state: emptySearchState(), facets, reference, formId: 'f' },
    });
    await w.find('input[name="mode"]').setValue(true);
    expect(w.emitted('apply')).toHaveLength(1);
    await w.find('input[name="ects_min"]').setValue('3');
    await w.find('input[name="ects_min"]').trigger('change');
    expect(w.emitted('apply')).toHaveLength(1);
  });

  it('falls back to the reference lists without counts', async () => {
    const w = await mountSuspended(CatalogueFilters, {
      props: { state: emptySearchState(), facets: null, reference, formId: 'f' },
    });
    expect(w.findAll('input[name="partner"]').map((p) => p.attributes('value'))).toEqual([
      'urv',
      'vu-amsterdam',
      'univie',
    ]);
    expect(w.find('label[for="filter-lang-nl"]').text()).toBe('Dutch');
  });

  it('has no axe violations', async () => {
    const w = await mountSuspended(CatalogueFilters, {
      props: {
        state: parseSearchState({ lang: 'en', attr_sdg: 'sdg_13', attr_free_course: 'true' }),
        facets,
        reference,
        formId: 'f',
      },
    });
    expect(await axeViolations(`<form id="f"></form>${w.html()}`)).toEqual([]);
  });
});
