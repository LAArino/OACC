// SPDX-License-Identifier: EUPL-1.2
/**
 * Language code normalisation for OEAPI input (spec §6.2.4 "Languages"): ISO
 * 639-2 bibliographic (B) and terminology (T) codes map to the ISO 639-1 code
 * where one exists; other three-letter codes stay as they are.
 */

/** ISO 639-2 (B and T) → ISO 639-1, for European and other frequent teaching languages. */
const ISO_639_2_TO_1: Readonly<Record<string, string>> = {
  // EU official languages
  bul: 'bg',
  cze: 'cs',
  ces: 'cs',
  dan: 'da',
  ger: 'de',
  deu: 'de',
  gre: 'el',
  ell: 'el',
  eng: 'en',
  spa: 'es',
  est: 'et',
  fin: 'fi',
  fre: 'fr',
  fra: 'fr',
  gle: 'ga',
  hrv: 'hr',
  hun: 'hu',
  ita: 'it',
  lit: 'lt',
  lav: 'lv',
  mlt: 'mt',
  dut: 'nl',
  nld: 'nl',
  pol: 'pl',
  por: 'pt',
  rum: 'ro',
  ron: 'ro',
  slo: 'sk',
  slk: 'sk',
  slv: 'sl',
  swe: 'sv',
  // Other languages of EU/EEA countries and candidates
  ice: 'is',
  isl: 'is',
  nor: 'no',
  nob: 'nb',
  nno: 'nn',
  cat: 'ca',
  baq: 'eu',
  eus: 'eu',
  glg: 'gl',
  wel: 'cy',
  cym: 'cy',
  gla: 'gd',
  bre: 'br',
  cos: 'co',
  oci: 'oc',
  ltz: 'lb',
  fao: 'fo',
  fry: 'fy',
  roh: 'rm',
  sme: 'se',
  alb: 'sq',
  sqi: 'sq',
  mac: 'mk',
  mkd: 'mk',
  srp: 'sr',
  bos: 'bs',
  ukr: 'uk',
  bel: 'be',
  rus: 'ru',
  tur: 'tr',
  arm: 'hy',
  hye: 'hy',
  geo: 'ka',
  kat: 'ka',
  lat: 'la',
  epo: 'eo',
  // Frequent world languages
  ara: 'ar',
  heb: 'he',
  chi: 'zh',
  zho: 'zh',
  jpn: 'ja',
  kor: 'ko',
  hin: 'hi',
  urd: 'ur',
  ben: 'bn',
  per: 'fa',
  fas: 'fa',
  kur: 'ku',
  aze: 'az',
  kaz: 'kk',
  uzb: 'uz',
  mon: 'mn',
  ind: 'id',
  may: 'ms',
  msa: 'ms',
  vie: 'vi',
  tha: 'th',
  tgl: 'tl',
  swa: 'sw',
  afr: 'af',
  amh: 'am',
  som: 'so',
  yid: 'yi',
};

/** ISO 639-2 special codes that name no single language; dropped with a warning. */
export const NON_LANGUAGE_CODES: ReadonlySet<string> = new Set(['mul', 'und', 'zxx', 'mis']);

export type LanguageNormalisation =
  { kind: 'ok'; code: string } | { kind: 'dropped'; code: string } | { kind: 'invalid' };

/**
 * Normalises a language code (ISO 639-1, ISO 639-2/B or /T, or the primary subtag
 * of a BCP 47 / RFC 3066 tag): `ger` → `de`, `en-GB` → `en`, `mul` → dropped.
 */
export function normaliseLanguage(input: string): LanguageNormalisation {
  const primary = input.trim().split(/[-_]/)[0]?.toLowerCase() ?? '';
  if (!/^[a-z]{2,3}$/.test(primary)) return { kind: 'invalid' };
  if (NON_LANGUAGE_CODES.has(primary)) return { kind: 'dropped', code: primary };
  if (primary.length === 2) return { kind: 'ok', code: primary };
  return { kind: 'ok', code: ISO_639_2_TO_1[primary] ?? primary };
}
