// SPDX-License-Identifier: EUPL-1.2
// Index of the deployment's branding directory (`/branding/index.json`, see
// server/middleware/branding.ts), fetched once per app: during SSR Nitro answers
// its own route, the client reuses the payload. Any failure (feature off: 404,
// network, unexpected body) lists no files; it never fails the page.
// `partnerLogo(slug)` is the path of `partner-<slug>.svg`, `.png` or `.webp`
// (first present), shown next to the partner name on cards and the course page.

const KEY = 'branding-index';

/** The listed files of the branding directory; none on any failure. */
export async function fetchBrandingIndex(): Promise<string[]> {
  try {
    return parseBrandingIndex(await $fetch<unknown>('/branding/index.json', { timeout: 3000 }));
  } catch {
    return [];
  }
}

export function useBrandingIndex() {
  const { data } = useAsyncData(KEY, fetchBrandingIndex, {
    default: () => [] as string[],
    getCachedData: (key, nuxtApp) => nuxtApp.payload.data[key] ?? nuxtApp.static.data[key],
  });
  const files = computed(() => data.value ?? []);
  const partnerLogo = (slug: string) => partnerLogoPath(files.value, slug);
  return { files, partnerLogo };
}
