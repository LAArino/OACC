// SPDX-License-Identifier: EUPL-1.2
// Minimal, safe Markdown renderer for the legal pages (privacy notice,
// accessibility statement) whose text the deployment provides in its branding
// directory. Safe by construction: all text is HTML-escaped first, raw HTML is
// never passed through, and the only markup produced is the subset below.
//
// Supported: headings `#`..`###` (deeper levels count as `###`), paragraphs,
// `**bold**` / `__bold__`, `*italic*` / `_italic_`, unordered (`-`, `*`, `+`) and
// ordered (`1.` / `1)`) flat lists with indented continuation lines, links
// `[text](https://...)` (http, https and mailto only; any other target leaves the
// plain text) and horizontal rules (`---`, `***`, `___`). Nothing else is
// interpreted (no code, images, tables, nested lists or block quotes).
// Pure functions, unit-tested in `test/legal-pages.test.ts`.

export interface RenderedMarkdown {
  /** Text of the first `#` heading, when present (it is not part of `html`). */
  title: string | undefined;
  /** Sanitised HTML of the rest of the document. */
  html: string;
}

/** Longest text rendered; a longer one is cut (the files are a few KB). */
const MAX_LENGTH = 200_000;

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes the five characters that are significant in HTML text and attributes. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

/** Private-use character delimiting the placeholders of rendered links. */
const MARK = '\uE000';

/** Link targets that are rendered (compared on the HTML-escaped target). */
const SAFE_LINK_RE = /^(?:https?:\/\/|mailto:)[^\s]+$/i;

/** Inline text to HTML. `input` is raw text; the result contains only the allowed tags. */
export function renderInline(input: string): string {
  // Links first, kept apart from the emphasis pass behind placeholders (the
  // marker is removed from the text, so a placeholder can never come from it).
  const links: string[] = [];
  const text = escapeHtml(input.replaceAll(MARK, '')).replace(
    /\[([^\]]+)\]\(\s*((?:[^()\s]|\([^()\s]*\))+)\s*\)/g,
    (_match, label: string, target: string) => {
      const inner = emphasis(label);
      if (!SAFE_LINK_RE.test(target)) return inner;
      const external = /^https?:/i.test(target);
      links.push(`<a href="${target}"${external ? ' rel="noopener"' : ''}>${inner}</a>`);
      return `${MARK}${links.length - 1}${MARK}`;
    },
  );
  return emphasis(text).replace(
    new RegExp(`${MARK}(\\d+)${MARK}`, 'g'),
    (_m, i: string) => links[Number(i)] ?? '',
  );
}

/** Bold and italic on already escaped text. */
function emphasis(text: string): string {
  return text
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/g, '<strong>$1</strong>')
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '<em>$1</em>')
    .replace(/(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, '<em>$1</em>');
}

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RULE_RE = /^ {0,3}(?:-[ \t]*){3,}$|^ {0,3}(?:\*[ \t]*){3,}$|^ {0,3}(?:_[ \t]*){3,}$/;
const BULLET_RE = /^ {0,3}[-*+][ \t]+(.*)$/;
const ORDERED_RE = /^ {0,3}\d{1,9}[.)][ \t]+(.*)$/;

/**
 * Renders `source`. The first `#` heading becomes `title` and is left out of
 * `html`; later `#` headings are shown as `<h2>` so that the page keeps a single
 * `<h1>` (the caller renders the title as `<h1>`), `##` as `<h2>`, `###` and
 * deeper as `<h3>`.
 */
export function renderMarkdown(source: string): RenderedMarkdown {
  const lines = source
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, MAX_LENGTH)
    .split(/\r\n|\r|\n/);

  let title: string | undefined;
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[][] } | undefined;

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((item) => `<li>${renderInline(item.join(' '))}</li>`);
      out.push(`<${list.tag}>${items.join('')}</${list.tag}>`);
    }
    list = undefined;
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      const text = heading[2]!.trim();
      if (level === 1 && title === undefined && text) {
        title = text.replace(/[*_]/g, '');
      } else if (text) {
        const tag = level >= 3 ? 'h3' : 'h2';
        out.push(`<${tag}>${renderInline(text)}</${tag}>`);
      }
      continue;
    }
    if (RULE_RE.test(line)) {
      flush();
      out.push('<hr>');
      continue;
    }
    const bullet = BULLET_RE.exec(line);
    const ordered = bullet ? null : ORDERED_RE.exec(line);
    const item = bullet ?? ordered;
    if (item) {
      flushParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push([item[1]!.trim()]);
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      // Indented continuation of the last list item.
      list.items[list.items.length - 1]!.push(line.trim());
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flush();
  return { title, html: out.join('') };
}
