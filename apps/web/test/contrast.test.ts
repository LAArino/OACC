// SPDX-License-Identifier: EUPL-1.2
// WCAG 2.1 AA contrast of the colour tokens in main.css (1.4.3 text 4.5:1,
// 1.4.11 control boundaries and focus indicators 3:1).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../app/assets/css/main.css', import.meta.url), 'utf8');
const root = /:root\s*{([^}]*)}/.exec(css)?.[1] ?? '';
const tokens = Object.fromEntries(
  [...root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
);

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT: [string, string][] = [
  ['c-text', 'c-bg'],
  ['c-text', 'c-surface'],
  ['c-muted', 'c-bg'],
  ['c-muted', 'c-surface'],
  ['c-primary', 'c-bg'],
  ['c-primary', 'c-surface'],
  ['c-primary', 'c-chip'],
  ['c-primary-hover', 'c-chip'],
  ['c-on-primary', 'c-primary'],
  ['c-on-primary', 'c-primary-hover'],
  ['c-chip-text', 'c-chip'],
  ['c-danger', 'c-bg'],
  ['c-danger', 'c-danger-bg'],
  ['c-text', 'c-notice-bg'],
  // Deadline highlighted on cards when sorting by deadline (passed: danger).
  ['c-danger', 'c-notice-bg'],
];
const NON_TEXT: [string, string][] = [
  ['c-border', 'c-bg'],
  ['c-focus', 'c-bg'],
  ['c-focus', 'c-chip'],
  ['c-notice-border', 'c-notice-bg'],
];

describe('colour tokens', () => {
  it('are all defined', () => {
    for (const [a, b] of [...TEXT, ...NON_TEXT]) {
      expect(tokens[a], a).toMatch(/^#/);
      expect(tokens[b], b).toMatch(/^#/);
    }
  });

  it.each(TEXT)('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT)('%s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(3);
  });
});
