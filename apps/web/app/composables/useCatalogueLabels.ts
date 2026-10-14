// SPDX-License-Identifier: EUPL-1.2
// Human labels for catalogue codes, in the UI locale. Partner names, delivery
// modes, ISCED fields and attribute definitions come from `/reference` (or a
// facet label); levels and course kinds are translated in the UI catalogue;
// languages and countries come from Intl.
import type { AttributeDefinition, Label, ReferenceData } from '../types/catalogue';
import { countryName, labelText, languageName } from '../utils/catalogue';

export type MaybeReference = ReferenceData | null | undefined;

export function useCatalogueLabels(reference: () => MaybeReference) {
  const { t, te, locale } = useI18n();

  function partnerName(slug: string, fallback?: Label): string {
    const org = reference()?.organizations.find((o) => o.slug === slug);
    return labelText(fallback, locale.value) ?? labelText(org?.name, locale.value) ?? slug;
  }

  function modeLabel(code: string, fallback?: Label): string {
    const mode = reference()?.delivery_modes.find((m) => m.code === code);
    return (
      labelText(fallback, locale.value) ??
      labelText(mode?.label, locale.value) ??
      code.replace(/^x-/, '').replace(/[_-]+/g, ' ')
    );
  }

  function iscedLabel(code: string, fallback?: Label): string {
    const field = reference()?.isced_broad_fields.find((f) => f.code === code);
    return labelText(fallback, locale.value) ?? labelText(field?.label, locale.value) ?? code;
  }

  function levelLabel(code: string, fallback?: Label): string {
    const key = `level.${code}`;
    return te(key) ? t(key) : (labelText(fallback, locale.value) ?? code);
  }

  /** Full name of a course kind (filters, chips, course page). */
  function kindLabel(code: string, fallback?: Label): string {
    const key = `kind.${code}`;
    if (te(key)) return t(key);
    const kind = reference()?.kinds?.find((k) => k.code === code);
    return (
      labelText(fallback, locale.value) ??
      labelText(kind?.label, locale.value) ??
      code.replace(/[_-]+/g, ' ')
    );
  }

  /** Short name of a course kind for the badge on search cards. */
  function kindBadge(code: string): string {
    const key = `kindBadge.${code}`;
    return te(key) ? t(key) : kindLabel(code);
  }

  function attributeDefinition(key: string): AttributeDefinition | undefined {
    return reference()?.attribute_definitions?.find((d) => d.key === key);
  }

  /** Name of an attribute (its definition label). */
  function attributeLabel(key: string, fallback?: Label): string {
    return (
      labelText(attributeDefinition(key)?.label, locale.value) ??
      labelText(fallback, locale.value) ??
      key.replace(/[_-]+/g, ' ')
    );
  }

  /** Label of one attribute value: the option label, else the given label, else the value. */
  function attributeValueLabel(key: string, value: string, fallback?: Label): string {
    const def = attributeDefinition(key);
    if (def?.value_type === 'boolean' && value === 'true') return attributeLabel(key, fallback);
    const option = def?.options?.find((o) => o.value === value);
    return labelText(option?.label, locale.value) ?? labelText(fallback, locale.value) ?? value;
  }

  function languageLabel(code: string, fallback?: Label): string {
    return labelText(fallback, locale.value) ?? languageName(code, locale.value);
  }

  function countryLabel(code: string | null | undefined): string | undefined {
    return countryName(code, locale.value);
  }

  /** Display name of an organization object embedded in a response. */
  function organizationName(org: { slug: string; name: Label }): string {
    return labelText(org.name, locale.value) ?? partnerName(org.slug);
  }

  return {
    partnerName,
    modeLabel,
    iscedLabel,
    levelLabel,
    kindLabel,
    kindBadge,
    attributeDefinition,
    attributeLabel,
    attributeValueLabel,
    languageLabel,
    countryLabel,
    organizationName,
  };
}

/**
 * Reference data shared by the catalogue pages, fetched once per page load and
 * reused on client-side navigation. Failure yields `null` (pages degrade to
 * codes instead of labels).
 */
export function useCatalogueReference() {
  const api = useCatalogueApi();
  return useAsyncData('catalogue-reference', () => api.reference({ timeout: 3000 }), {
    default: () => null,
    getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
  });
}
