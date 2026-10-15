// SPDX-License-Identifier: EUPL-1.2
// Header images of the deployment: NUXT_PUBLIC_HERO_IMAGE (home page) and
// NUXT_PUBLIC_HERO_IMAGE_COURSES (course list; empty = the home image), each a
// path on the portal origin (normally /branding/<file>, see
// server/middleware/branding.ts) or an absolute https URL. The alt texts
// (NUXT_PUBLIC_HERO_IMAGE_ALT, NUXT_PUBLIC_HERO_IMAGE_COURSES_ALT) are empty
// (decorative) by default; the course list's alt follows its own image. Shown
// by <BrandingBanner>; `heroImageUrl` is the absolute URL for link previews.
export type HeroVariant = 'home' | 'courses';

export function useHeroImage(variant: HeroVariant = 'home') {
  const config = useRuntimeConfig();
  const requestUrl = useRequestURL();
  const i18nBase = (config.public.i18n as { baseUrl?: string } | undefined)?.baseUrl;
  const own = computed(() => (variant === 'courses' ? config.public.heroImageCourses : ''));
  const heroImage = computed(() => own.value || config.public.heroImage);
  const heroImageAlt = computed(() =>
    own.value ? config.public.heroImageCoursesAlt : config.public.heroImageAlt,
  );
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
