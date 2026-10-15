// SPDX-License-Identifier: EUPL-1.2
// Stylesheet rules found in the 2026-10 accessibility audit
// (docs/production/accessibility-audit-2026-10.md); regressions are invisible to
// the axe runs on mounted components, which have no layout.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('../app/assets/css/main.css');
const admin = read('../app/assets/css/admin.css');

/** Declarations of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|})\\s*${escaped}\\s*{([^}]*)}`, 'm').exec(css);
  return match?.[1] ?? '';
}

describe('accessibility rules of the stylesheets', () => {
  it('keeps the skip link global, so the error page (rendered without app.vue) has it', () => {
    expect(rule(main, '.skip-link')).toMatch(/top:\s*-3rem/);
    expect(rule(main, '.skip-link:focus')).toMatch(/top:\s*0\.5rem/);
  });

  it('lets the facts lists reflow at 320 px (1.4.10)', () => {
    expect(rule(main, '.facts')).toMatch(
      /grid-template-columns:\s*fit-content\(50%\) minmax\(0, 1fr\)/,
    );
  });

  it('makes table scroll areas the containing block of their hidden texts (1.4.10)', () => {
    expect(rule(admin, '.admin-table-wrap')).toMatch(/position:\s*relative/);
  });

  it('gives danger-text buttons their own background (1.4.3)', () => {
    const declarations = rule(admin, 'button.button.button--danger-text');
    expect(declarations).toMatch(/background:\s*var\(--c-bg\)/);
    expect(declarations).toMatch(/color:\s*var\(--c-danger\)/);
    expect(rule(admin, 'button.button.button--danger-text:hover')).toMatch(
      /background:\s*var\(--c-danger-bg\)/,
    );
  });
});
