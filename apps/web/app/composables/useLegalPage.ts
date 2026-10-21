// SPDX-License-Identifier: EUPL-1.2
// Data of a public legal page (`/{locale}/privacy`, `/{locale}/accessibility`):
// the Markdown text `<kind>.<lang>.md` of the deployment's branding directory
// (served by server/middleware/branding.ts), in the page locale when listed in
// `/branding/index.json`, else in English. Fetched during SSR from the portal's
// own origin, so the page works without JavaScript. Without a text the page is
// a short "not published yet" message answered with HTTP 404 (the privacy URL
// goes into the SAML federation metadata: it must resolve only once it is real),
// and kept out of search indexes.
export async function useLegalPage(kind: LegalKind) {
  const { t, locale } = useI18n();
  // Everything that needs the Nuxt context is called before the first `await`.
  const event = import.meta.server ? useRequestEvent() : undefined;

  const asyncData = useAsyncData(`legal-${kind}-${locale.value}`, async () => {
    const file = legalFile(await fetchBrandingIndex(), kind, locale.value);
    if (!file) return null;
    try {
      const text = await $fetch<string>(`/branding/${file.name}`, {
        responseType: 'text',
        timeout: 3000,
      });
      return typeof text === 'string' && text.trim() ? { ...file, ...renderMarkdown(text) } : null;
    } catch {
      return null;
    }
  });
  const page = computed(() => {
    const doc = asyncData.data.value;
    const published = Boolean(doc && (doc.title || doc.html));
    return {
      published,
      title: doc?.title || t(`legal.${kind}Title`),
      html: doc?.html ?? '',
      // The text language when it is not the page's (English fallback), for assistive technology.
      lang: doc && doc.lang !== locale.value ? doc.lang : undefined,
    };
  });
  useHead({
    title: () => page.value.title,
    meta: () => (page.value.published ? [] : [{ name: 'robots', content: 'noindex' }]),
  });

  await asyncData;
  if (event && !page.value.published) setResponseStatus(event, 404);
  return page;
}
