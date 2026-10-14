// SPDX-License-Identifier: EUPL-1.2

export interface LocalizedValue<T> {
  value: T;
  /** Language of `value`; render it as `lang` when it differs from the page locale. */
  lang: string;
}

/**
 * Picks content in the UI locale, falling back to English (spec §5 "Languages").
 * Texts are keyed by primary language subtag.
 */
export function pickLocalized<T>(
  byLang: Readonly<Record<string, T>>,
  locale: string,
): LocalizedValue<T> | undefined {
  const primary = locale.split('-')[0]?.toLowerCase() ?? 'en';
  const exact = byLang[primary];
  if (exact !== undefined) return { value: exact, lang: primary };
  const english = byLang['en'];
  return english === undefined ? undefined : { value: english, lang: 'en' };
}
