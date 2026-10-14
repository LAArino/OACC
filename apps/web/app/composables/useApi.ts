// SPDX-License-Identifier: EUPL-1.2

/**
 * `$fetch` bound to the API origin. In the browser it uses NUXT_PUBLIC_API_BASE;
 * during server-side rendering it prefers the server-only NUXT_API_INTERNAL_BASE
 * (container-to-container), falling back to the public origin when unset.
 */
export function useApi() {
  const config = useRuntimeConfig();
  const internalBase = import.meta.server ? config.apiInternalBase : '';
  const baseURL = internalBase || config.public.apiBase;
  return $fetch.create({
    baseURL,
    headers: { accept: 'application/json' },
    // Public endpoints are anonymous; never forward or store cookies.
    credentials: 'omit',
  });
}
