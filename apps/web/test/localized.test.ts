// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { pickLocalized } from '../app/utils/localized';

describe('pickLocalized', () => {
  const texts = { en: 'Physics', de: 'Physik' };

  it('uses the page locale when available', () => {
    expect(pickLocalized(texts, 'de')).toEqual({ value: 'Physik', lang: 'de' });
  });

  it('matches on the primary subtag', () => {
    expect(pickLocalized(texts, 'de-AT')).toEqual({ value: 'Physik', lang: 'de' });
  });

  it('falls back to English, marked as such', () => {
    expect(pickLocalized(texts, 'ca')).toEqual({ value: 'Physics', lang: 'en' });
  });

  it('returns undefined when neither is present', () => {
    expect(pickLocalized({ fr: 'Physique' }, 'ca')).toBeUndefined();
  });
});
