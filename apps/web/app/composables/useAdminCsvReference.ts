// SPDX-License-Identifier: EUPL-1.2
// The lists the server checks a CSV upload of an organization against
// (`GET /api/admin/v1/reference?org=`, spec §6.3), for the browser validator of
// the CSV console. Cached per organization and access token (successes only) for
// the life of the page, and forgotten after an upload. Every network load sends
// `cache: 'no-cache'`: the server answers `Cache-Control: private, max-age=60`,
// and course codes change with every upload and every course saved in the
// editor, so a reused HTTP cache entry could reject a code that exists.
import type { AdminCsvReference } from '@oecp/schemas';

export function useAdminCsvReference() {
  const api = useAdminApi();
  const auth = useAuth();
  let cache: { key: string; promise: Promise<AdminCsvReference> } | undefined;

  return {
    load(orgId: string): Promise<AdminCsvReference> {
      const key = `${auth.accessToken.value ?? ''}|${orgId}`;
      if (cache?.key !== key) {
        const promise = api<AdminCsvReference>('/api/admin/v1/reference', {
          query: { org: orgId },
          cache: 'no-cache',
        });
        const entry = { key, promise };
        cache = entry;
        // Only successes stay cached; a failure is retried on the next load.
        promise.catch(() => {
          if (cache === entry) cache = undefined;
        });
      }
      return cache.promise;
    },
    /** After an upload of `orgId` reached the server: the next load fetches again. */
    invalidate(orgId: string): void {
      if (cache?.key.endsWith(`|${orgId}`)) cache = undefined;
    },
  };
}
