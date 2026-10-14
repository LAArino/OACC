// SPDX-License-Identifier: EUPL-1.2

/** `$fetch` bound to NUXT_PUBLIC_API_BASE; works during SSR and in the browser. */
export function useApi() {
  const { apiBase } = useRuntimeConfig().public;
  return $fetch.create({
    baseURL: apiBase,
    headers: { accept: 'application/json' },
    // Public endpoints are anonymous; never forward or store cookies.
    credentials: 'omit',
  });
}
