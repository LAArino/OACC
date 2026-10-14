// SPDX-License-Identifier: EUPL-1.2
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/index.js';

describe('errors.json', () => {
  it('matches the error code table', () => {
    const file = JSON.parse(readFileSync(new URL('../errors.json', import.meta.url), 'utf8'));
    expect(file).toEqual(ERROR_CODES);
  });

  it('contains the codes named in the specification', () => {
    for (const code of [
      'oecp.csv.invalid_date',
      'oecp.content.english_missing',
      'oecp.oeapi.mass_absence',
    ]) {
      expect(ERROR_CODES).toHaveProperty([code]);
    }
  });
});
