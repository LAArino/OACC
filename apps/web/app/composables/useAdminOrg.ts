// SPDX-License-Identifier: EUPL-1.2
// The organization the admin modules act on (spec §8): `?org=` when present
// (alliance administrators choose any organization; partner administrators may
// open a sub-unit, the API enforces the scope), else the `org_id` of the signed-in
// administrator as `GET /api/admin/v1/me` reports it from the token.
import type { AdminMe } from '@oecp/schemas';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/me` per access token: one request per sign-in, shared by every admin page of the tab. */
let meCache: { token: string; promise: Promise<AdminMe> } | undefined;

export function useAdminOrg() {
  const auth = useAuth();
  const adminApi = useAdminApi();
  const route = useRoute();
  const me = ref<AdminMe | null>(null);
  const failure = ref<AdminApiError | null>(null);
  const loading = ref(false);

  async function load(): Promise<AdminMe | null> {
    const token = auth.accessToken.value;
    if (!token) return null;
    if (meCache?.token !== token) {
      meCache = { token, promise: adminApi<AdminMe>('/api/admin/v1/me') };
    }
    const pending = meCache;
    loading.value = true;
    failure.value = null;
    try {
      me.value = await pending.promise;
      return me.value;
    } catch (error) {
      if (meCache === pending) meCache = undefined;
      failure.value = asAdminApiError(error);
      return null;
    } finally {
      loading.value = false;
    }
  }

  const roles = computed(() => me.value?.roles ?? []);
  const isAlliance = computed(() => roles.value.includes('alliance_admin'));
  /** May use the partner modules (CSV console, sync monitor, integration). */
  const canManage = computed(() => isAlliance.value || roles.value.includes('partner_admin'));
  const queryOrg = computed(() => {
    const value = route.query.org;
    return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
  });
  const orgId = computed(() =>
    canManage.value ? (queryOrg.value ?? me.value?.org_id ?? null) : null,
  );
  /** Query carrying an explicitly chosen organization to the next admin page. */
  const orgQuery = computed(() => {
    const query: Record<string, string> = {};
    if (queryOrg.value) query.org = queryOrg.value;
    return query;
  });

  return { me, failure, loading, load, roles, isAlliance, canManage, orgId, orgQuery };
}
