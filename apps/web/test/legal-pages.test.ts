// SPDX-License-Identifier: EUPL-1.2
// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DefaultLayout from '../app/layouts/default.vue';
import AccessibilityPage from '../app/pages/(public)/accessibility.vue';
import PrivacyPage from '../app/pages/(public)/privacy.vue';
import { legalFile } from '../app/utils/branding';
import { escapeHtml, renderInline, renderMarkdown } from '../app/utils/markdown';
import { axeViolations } from './helpers/catalogue';

// The branding directory, as `/branding/*` would answer: the listed files with
// their texts, or 404 (feature off) when `null`.
const branding = vi.hoisted(() => ({
  texts: null as Record<string, string> | null,
  requested: [] as string[],
}));
registerEndpoint('/branding/index.json', () => {
  if (!branding.texts) throw createError({ statusCode: 404 });
  return { files: Object.keys(branding.texts).sort() };
});
for (const name of [
  'privacy.en.md',
  'privacy.ca.md',
  'accessibility.en.md',
  'accessibility.ca.md',
]) {
  registerEndpoint(`/branding/${name}`, () => {
    branding.requested.push(name);
    const text = branding.texts?.[name];
    if (text === undefined) throw createError({ statusCode: 404 });
    return text;
  });
}

// Only English is an enabled UI locale of the app; pretend the page locale is
// `locale` to exercise the language choice (the route prefix is not involved).
const page = vi.hoisted(() => ({ locale: 'en' }));
mockNuxtImport('useI18n', (original: () => Record<string, unknown>) => () => ({
  ...original(),
  locale: computed(() => page.locale),
}));

const PRIVACY_EN = [
  '# Privacy notice of the Aurora Foundation',
  '',
  'We process **only** the data _needed_ to run the portal.',
  '',
  '## What we collect',
  '',
  '- Course searches (not stored)',
  '- Sign-in data of administrators',
  '',
  'Write to [the data protection officer](mailto:dpo@example.eu) or see',
  '[the rules](https://example.eu/rules?a=1&b=2).',
  '',
  '<script>alert(1)</script>',
  '',
].join('\n');

const ACCESSIBILITY_EN = '# Accessibility statement\n\nThe portal aims at WCAG 2.2 AA.\n';

beforeEach(() => {
  branding.texts = null;
  branding.requested.length = 0;
  page.locale = 'en';
  clearNuxtData();
});

describe('privacy page', () => {
  it('renders the English file: heading as title and h1, list, links, escaped raw HTML', async () => {
    branding.texts = { 'privacy.en.md': PRIVACY_EN };
    const w = await mountSuspended(PrivacyPage, { route: '/en/privacy' });
    const article = w.find('article.legal');
    expect(article.exists()).toBe(true);
    expect(w.findAll('h1').map((h) => h.text())).toEqual([
      'Privacy notice of the Aurora Foundation',
    ]);
    expect(article.find('h2').text()).toBe('What we collect');
    expect(article.findAll('ul li').map((li) => li.text())).toEqual([
      'Course searches (not stored)',
      'Sign-in data of administrators',
    ]);
    expect(article.find('strong').text()).toBe('only');
    expect(article.find('em').text()).toBe('needed');
    const mail = article.find('a[href^="mailto:"]');
    expect(mail.attributes('href')).toBe('mailto:dpo@example.eu');
    expect(mail.attributes('rel')).toBeUndefined();
    const external = article.find('a[href^="https:"]');
    expect(external.attributes('href')).toBe('https://example.eu/rules?a=1&b=2');
    expect(external.attributes('rel')).toBe('noopener');
    // The raw <script> is text, not an element.
    expect(article.find('script').exists()).toBe(false);
    expect(article.html()).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(article.text()).toContain('<script>alert(1)</script>');
  });

  it('falls back to the English file when the locale has none (ca asked, only en present)', async () => {
    branding.texts = { 'privacy.en.md': PRIVACY_EN };
    page.locale = 'ca';
    const w = await mountSuspended(PrivacyPage, { route: '/en/privacy' });
    expect(branding.requested).toEqual(['privacy.en.md']);
    expect(w.find('h1').text()).toBe('Privacy notice of the Aurora Foundation');
  });

  it('shows the text in the locale when its file is listed', async () => {
    branding.texts = {
      'privacy.en.md': PRIVACY_EN,
      'privacy.ca.md': '# Avís de privadesa\n\nText.',
    };
    page.locale = 'ca';
    const w = await mountSuspended(PrivacyPage, { route: '/en/privacy' });
    expect(branding.requested).toEqual(['privacy.ca.md']);
    expect(w.find('h1').text()).toBe('Avís de privadesa');
    expect(w.find('article').attributes('lang')).toBeUndefined();
  });

  it('uses the default title when the text has no # heading', async () => {
    branding.texts = { 'privacy.en.md': 'Just a paragraph.' };
    const w = await mountSuspended(PrivacyPage, { route: '/en/privacy' });
    expect(w.find('h1').text()).toBe('Privacy notice');
    expect(w.find('article.legal p').text()).toBe('Just a paragraph.');
  });

  it('says it is not published yet when no file exists (served with status 404)', async () => {
    branding.texts = { 'accessibility.en.md': ACCESSIBILITY_EN };
    const w = await mountSuspended(PrivacyPage, { route: '/en/privacy' });
    expect(w.find('h1').text()).toBe('Privacy notice');
    expect(w.find('article.legal .notice').text()).toBe('This text has not been published yet.');
    expect(branding.requested).toEqual([]);
  });

  it('says it is not published yet when the branding feature is off', async () => {
    const w = await mountSuspended(PrivacyPage, { route: '/en/privacy' });
    expect(w.find('article.legal .notice').exists()).toBe(true);
  });

  it('has no accessibility violations', async () => {
    branding.texts = { 'privacy.en.md': PRIVACY_EN };
    const w = await mountSuspended(PrivacyPage, { route: '/en/privacy' });
    expect(await axeViolations(w.html())).toEqual([]);
    branding.texts = null;
    clearNuxtData();
    const empty = await mountSuspended(PrivacyPage, { route: '/en/privacy' });
    expect(await axeViolations(empty.html())).toEqual([]);
  });
});

describe('accessibility page', () => {
  it('renders the English file', async () => {
    branding.texts = { 'accessibility.en.md': ACCESSIBILITY_EN };
    const w = await mountSuspended(AccessibilityPage, { route: '/en/accessibility' });
    expect(w.find('h1').text()).toBe('Accessibility statement');
    expect(w.find('article.legal p').text()).toBe('The portal aims at WCAG 2.2 AA.');
    expect(await axeViolations(w.html())).toEqual([]);
  });

  it('falls back to the English file for another locale', async () => {
    branding.texts = { 'accessibility.en.md': ACCESSIBILITY_EN };
    page.locale = 'ca';
    const w = await mountSuspended(AccessibilityPage, { route: '/en/accessibility' });
    expect(branding.requested).toEqual(['accessibility.en.md']);
    // The text is English on a page in another language: marked for assistive technology.
    expect(w.find('article').attributes('lang')).toBe('en');
  });

  it('uses the default title and says it is not published yet when absent', async () => {
    branding.texts = { 'privacy.en.md': PRIVACY_EN };
    const w = await mountSuspended(AccessibilityPage, { route: '/en/accessibility' });
    expect(w.find('h1').text()).toBe('Accessibility statement');
    expect(w.find('article.legal .notice').text()).toBe('This text has not been published yet.');
  });
});

describe('footer links to the legal pages', () => {
  const slots = { default: () => 'page' };
  const footerLinks = async () => {
    const w = await mountSuspended(DefaultLayout, { route: '/en', slots });
    // Client side the index arrives after the layout (during SSR it is awaited).
    await new Promise((resolve) => setTimeout(resolve, 50));
    return w
      .findAll('footer nav[aria-label="Legal"] a')
      .map((a) => [a.text(), a.attributes('href')]);
  };

  it('links both pages when their English files are listed', async () => {
    branding.texts = { 'privacy.en.md': PRIVACY_EN, 'accessibility.en.md': ACCESSIBILITY_EN };
    expect(await footerLinks()).toEqual([
      ['Privacy notice', '/en/privacy'],
      ['Accessibility statement', '/en/accessibility'],
    ]);
  });

  it('links only the page whose English file is listed', async () => {
    branding.texts = { 'privacy.en.md': PRIVACY_EN, 'accessibility.ca.md': 'x' };
    expect(await footerLinks()).toEqual([['Privacy notice', '/en/privacy']]);
  });

  it('shows no legal navigation without files or without the branding feature', async () => {
    branding.texts = { 'hero.png': '' };
    expect(await footerLinks()).toEqual([]);
    clearNuxtData();
    branding.texts = null;
    const w = await mountSuspended(DefaultLayout, { route: '/en', slots });
    expect(w.find('footer nav').exists()).toBe(false);
  });
});

describe('legalFile', () => {
  const files = ['privacy.ca.md', 'privacy.en.md', 'accessibility.en.md'];
  it('prefers the locale, then English, else nothing', () => {
    expect(legalFile(files, 'privacy', 'ca')).toEqual({ name: 'privacy.ca.md', lang: 'ca' });
    expect(legalFile(files, 'privacy', 'ca-ES')).toEqual({ name: 'privacy.ca.md', lang: 'ca' });
    expect(legalFile(files, 'privacy', 'de')).toEqual({ name: 'privacy.en.md', lang: 'en' });
    expect(legalFile(files, 'accessibility', 'ca')).toEqual({
      name: 'accessibility.en.md',
      lang: 'en',
    });
    expect(legalFile(['privacy.ca.md'], 'privacy', 'de')).toBeUndefined();
    expect(legalFile([], 'privacy', 'en')).toBeUndefined();
    expect(legalFile(files, 'privacy', '../x')).toEqual({ name: 'privacy.en.md', lang: 'en' });
  });
});

describe('Markdown renderer', () => {
  it('escapes raw HTML, attributes and entities instead of passing them through', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)>').html).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    );
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('renders only http, https and mailto links', () => {
    expect(renderInline('[a](https://e.eu/x)')).toBe(
      '<a href="https://e.eu/x" rel="noopener">a</a>',
    );
    expect(renderInline('[a](http://e.eu)')).toBe('<a href="http://e.eu" rel="noopener">a</a>');
    expect(renderInline('[a](mailto:x@e.eu)')).toBe('<a href="mailto:x@e.eu">a</a>');
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html;base64,AAAA',
      'vbscript:x',
      '//e.eu',
      '/relative',
      '#frag',
    ]) {
      expect(renderInline(`[click](${bad})`), bad).toBe('click');
    }
    // A quote in the target cannot leave the attribute.
    expect(renderInline('[a](https://e.eu/"onmouseover="x)')).toBe(
      '<a href="https://e.eu/&quot;onmouseover=&quot;x" rel="noopener">a</a>',
    );
  });

  it('renders headings, rules, ordered and unordered lists and continuation lines', () => {
    const { title, html } = renderMarkdown(
      [
        '# Title',
        '## Part',
        '### Sub',
        '#### Deeper',
        '# Second h1',
        '---',
        '1. one',
        '   continued',
        '2) two',
        '* a',
        '+ b',
        'Closing  line',
        'second line',
      ].join('\n'),
    );
    expect(title).toBe('Title');
    expect(html).toBe(
      '<h2>Part</h2><h3>Sub</h3><h3>Deeper</h3><h2>Second h1</h2><hr>' +
        '<ol><li>one continued</li><li>two</li></ol><ul><li>a</li><li>b</li></ul>' +
        '<p>Closing  line second line</p>',
    );
  });

  it('handles CRLF, control characters and empty input', () => {
    expect(renderMarkdown('').html).toBe('');
    expect(renderMarkdown('# T\r\n\r\ntext\u0000\u0001').html).toBe('<p>text</p>');
    expect(renderMarkdown('# **Bold** title').title).toBe('Bold title');
  });

  it('does not let a placeholder in the text forge a link', () => {
    expect(renderInline('x \uE0000\uE000 [a](https://e.eu)')).toContain('<a href="https://e.eu"');
    expect(renderMarkdown('\uE0000\uE000 [a](https://e.eu)').html).toBe(
      '<p>0 <a href="https://e.eu" rel="noopener">a</a></p>',
    );
  });
});
