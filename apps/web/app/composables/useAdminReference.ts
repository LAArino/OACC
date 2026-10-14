// SPDX-License-Identifier: EUPL-1.2
// Public reference data (`GET /api/public/v1/reference`, anonymous) for the admin
// pages: organization names for the alliance selector and the ISCED broad fields
// and delivery modes the browser CSV validator checks against. Cached per tab.
import type { ReferenceResponse } from '@oecp/schemas';

export type AdminOrganization = ReferenceResponse['organizations'][number];

let cached: Promise<ReferenceResponse> | undefined;

/** Forgets the cached reference data (tests; or after organizations changed). */
export function resetAdminReference(): void {
  cached = undefined;
}

export function useAdminReference() {
  const api = useApi();
  return {
    load(): Promise<ReferenceResponse> {
      if (!cached) {
        const pending = api<ReferenceResponse>('/api/public/v1/reference');
        cached = pending;
        // Only successes are cached; a failure is retried on the next call.
        pending.catch(() => {
          if (cached === pending) cached = undefined;
        });
      }
      return cached;
    },
  };
}

/** Display name of an organization (the English label is mandatory), else its slug. */
export function organizationName(org: Pick<AdminOrganization, 'name' | 'slug'>): string {
  return org.name.en || org.slug;
}
