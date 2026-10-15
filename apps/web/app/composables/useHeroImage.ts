// SPDX-License-Identifier: EUPL-1.2
// Header image of the deployment (NUXT_PUBLIC_HERO_IMAGE): a path on the portal
// origin (normally /branding/<file>, see server/middleware/branding.ts) or an
// absolute https URL. Its alt text is empty (decorative) unless
// NUXT_PUBLIC_HERO_IMAGE_ALT is set. Shown by <BrandingBanner> on the home page
// and the course list; `heroImageUrl` is the absolute URL for link previews.
export function useHeroImage() {
  const config = useRuntimeConfig();
  const requestUrl = useRequestURL();
  const i18nBase = (config.public.i18n as { baseUrl?: string } | undefined)?.baseUrl;
  const heroImage = computed(() => config.public.heroImage);
  const heroImageAlt = computed(() => config.public.heroImageAlt);
  const heroImageUrl = computed(() => {
    const src = heroImage.value;
    if (!src || /^https?:\/\//i.test(src)) return src;
    const origin = (i18nBase || requestUrl.origin).replace(/\/$/, '');
    return `${origin}${src.startsWith('/') ? '' : '/'}${src}`;
  });
  /** `<meta>` entries for link previews (`og:image`); empty when no image is set. */
  const previewMeta = () =>
    heroImageUrl.value
      ? [
          { property: 'og:image', content: heroImageUrl.value },
          { name: 'twitter:card', content: 'summary_large_image' },
        ]
      : [];
  return { heroImage, heroImageAlt, heroImageUrl, previewMeta };
}
