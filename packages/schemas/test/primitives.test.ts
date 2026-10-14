// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import { ianaTimeZone, iscedCode, languageTag, localizedLabel } from '../src/index.js';

describe('primitives', () => {
  it.each(['en', 'de', 'en-GB', 'ca-ES-valencia', 'cat'])('accepts language tag %s', (tag) => {
    expect(languageTag.safeParse(tag).success).toBe(true);
  });

  it.each(['EN', 'english', 'en_GB', 'e', ''])('rejects language tag %s', (tag) => {
    expect(languageTag.safeParse(tag).success).toBe(false);
  });

  it('validates ISCED codes with 2 to 6 digits', () => {
    expect(iscedCode.safeParse('06').success).toBe(true);
    expect(iscedCode.safeParse('0613').success).toBe(true);
    expect(iscedCode.safeParse('6').success).toBe(false);
    expect(iscedCode.safeParse('0613a').success).toBe(false);
    expect(iscedCode.safeParse('1234567').success).toBe(false);
  });

  it('requires English in localized labels', () => {
    expect(localizedLabel.safeParse({ en: 'Physics', de: 'Physik' }).success).toBe(true);
    expect(localizedLabel.safeParse({ de: 'Physik' }).success).toBe(false);
    expect(localizedLabel.safeParse({ en: 'Physics', German: 'Physik' }).success).toBe(false);
  });

  it('validates IANA time zones', () => {
    expect(ianaTimeZone.safeParse('Europe/Vienna').success).toBe(true);
    expect(ianaTimeZone.safeParse('Mars/Olympus').success).toBe(false);
    expect(ianaTimeZone.safeParse('+01:00').success).toBe(false);
  });
});
