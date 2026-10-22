// SPDX-License-Identifier: EUPL-1.2
/**
 * Language codes of the OEAPI v5 read API (spec §9): OACC stores ISO 639-1
 * primary subtags; v5 `teachingLanguage` is ISO 639-2, served in the
 * terminology (T) form. Input accepts B and T forms (`ger`, `deu`).
 */
import { normaliseLanguage } from '../ingestion/oeapi/languages.js';

/** ISO 639-1 → ISO 639-2/T. */
// prettier-ignore
const ISO_639_1_TO_2T: Readonly<Record<string, string>> = {
  af: 'afr', am: 'amh', ar: 'ara', az: 'aze', be: 'bel', bg: 'bul', bn: 'ben', br: 'bre',
  bs: 'bos', ca: 'cat', co: 'cos', cs: 'ces', cy: 'cym', da: 'dan', de: 'deu', el: 'ell',
  en: 'eng', eo: 'epo', es: 'spa', et: 'est', eu: 'eus', fa: 'fas', fi: 'fin', fo: 'fao',
  fr: 'fra', fy: 'fry', ga: 'gle', gd: 'gla', gl: 'glg', he: 'heb', hi: 'hin', hr: 'hrv',
  hu: 'hun', hy: 'hye', id: 'ind', is: 'isl', it: 'ita', ja: 'jpn', ka: 'kat', kk: 'kaz',
  ko: 'kor', ku: 'kur', la: 'lat', lb: 'ltz', lt: 'lit', lv: 'lav', mk: 'mkd', mn: 'mon',
  ms: 'msa', mt: 'mlt', nb: 'nob', nl: 'nld', nn: 'nno', no: 'nor', oc: 'oci', pl: 'pol',
  pt: 'por', rm: 'roh', ro: 'ron', ru: 'rus', se: 'sme', sk: 'slk', sl: 'slv', so: 'som',
  sq: 'sqi', sr: 'srp', sv: 'swe', sw: 'swa', th: 'tha', tl: 'tgl', tr: 'tur', uk: 'ukr',
  ur: 'urd', uz: 'uzb', vi: 'vie', yi: 'yid', zh: 'zho',
};

/**
 * ISO 639-2/T code of a stored language tag (`en`, `en-GB` → `eng`); three-letter
 * codes pass through; anything else is `und` (v5 requires `^[a-z]{3}$`).
 */
export function toIso6392T(tag: string): string {
  const primary = tag.split('-')[0]?.toLowerCase() ?? '';
  if (/^[a-z]{3}$/.test(primary)) return primary;
  return ISO_639_1_TO_2T[primary] ?? 'und';
}

/** Stored primary subtag of a v5 `teachingLanguage` filter value, or null if none. */
export function fromIso6392(code: string): string | null {
  const result = normaliseLanguage(code);
  return result.kind === 'ok' ? result.code : null;
}
