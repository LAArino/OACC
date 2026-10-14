// SPDX-License-Identifier: EUPL-1.2
// Client for `/api/admin/v1` (client-rendered admin pages only): attaches the
// in-memory access token as `Authorization: Bearer` and turns failures into
// AdminApiError (parsed `application/problem+json`, spec §6.6).

export interface AdminRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
}

/** Extracts status and parsed body from an ofetch FetchError (or anything thrown). */
function failureOf(error: unknown): { status: number | undefined; body: unknown } {
  if (typeof error !== 'object' || error === null) return { status: undefined, body: undefined };
  const e = error as { status?: unknown; response?: { status?: unknown }; data?: unknown };
  const status =
    typeof e.response?.status === 'number'
      ? e.response.status
      : typeof e.status === 'number'
        ? e.status
        : undefined;
  return { status, body: e.data };
}

export function useAdminApi() {
  const { apiBase } = useRuntimeConfig().public;
  const auth = useAuth();
  const client = $fetch.create({
    baseURL: apiBase,
    headers: { accept: 'application/json, application/problem+json' },
    // Bearer tokens only: never send or store cookies.
    credentials: 'omit',
    retry: 0,
  });

  return async function adminApi<T>(path: string, options: AdminRequestOptions = {}): Promise<T> {
    const token = auth.accessToken.value;
    if (!token) {
      throw new AdminApiError({
        status: 401,
        title: 'Not signed in',
        codes: ['oecp.auth.missing_token'],
      });
    }
    try {
      return await client<T>(path, {
        method: options.method ?? 'GET',
        ...(options.body ? { body: options.body } : {}),
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      const { status, body } = failureOf(error);
      throw toAdminApiError(status, body);
    }
  };
}
