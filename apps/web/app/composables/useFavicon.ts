// SPDX-License-Identifier: EUPL-1.2
// `<link rel="icon">`: NUXT_PUBLIC_FAVICON_IMAGE (a path such as
// /branding/favicon.svg, or an absolute https URL) or the portal's own
// public/favicon.svg. Called by app.vue and error.vue (rendered without app.vue).
export function useFavicon() {
  const config = useRuntimeConfig();
  useHead(() => ({ link: [faviconLink(config.public.faviconImage)] }));
}
