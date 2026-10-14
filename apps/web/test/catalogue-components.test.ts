// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const reference = fixtures.reference as unknown as ReferenceData;
const card = (i: number) => fixtures.search.items[i] as unknown as CourseCardData;
const offering = (i: number) => fixtures.course.offerings[i] as unknown as Offering;

beforeEach(() => {
  api.calls.length = 0;
  api.handler = fixtureHandler() as Handler;
  navigation.navigateTo.mockReset();
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

  it('never links unsafe application URLs', async () => {
    const w = await mountOffering({ ...offering(0), application_url: 'javascript:alert(1)' });
    expect(w.find('a.button').exists()).toBe(false);
  });

  it('labels cancelled offerings and drops the apply action', async () => {
    const w = await mountOffering({ ...offering(0), status: 'cancelled' });
    expect(w.find('.offering__badge').text()).toBe('Cancelled');
    expect(w.find('a.button').exists()).toBe(false);
    expect(w.text()).not.toContain('Seats available');
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
    expect(text).toContain('LevelMaster');
    expect(text).toContain('Delivery modeOnline, Hybrid');
    expect(text).toContain('Teaching languagesEnglish, Catalan');
    expect(text).toContain('Next offeringFeb 8, 2027 – Jun 11, 2027');
    expect(text).toContain('Application deadlineDec 15, 2026');
    expect(text).toContain('Seats available: 12 (as of Oct 10, 2026) · Alliance seats: 5');
    expect(text).toContain('1 more offering');
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
      'Delivery mode',
      'Teaching language',
      'Field of study',
      'Level',
      'ECTS credits',
    ]);
    expect((w.find('input[name="ects_max"]').element as HTMLInputElement).value).toBe('6');
    const past = w.find('input[name="upcoming"]');
    expect(past.attributes('value')).toBe('false');
    expect((past.element as HTMLInputElement).checked).toBe(true);
    expect(w.find('h2').text()).toBe('Filters 4 active');
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
      props: { state: parseSearchState({ lang: 'en' }), facets, reference, formId: 'f' },
    });
    expect(await axeViolations(`<form id="f"></form>${w.html()}`)).toEqual([]);
  });
});
