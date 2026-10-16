// SPDX-License-Identifier: EUPL-1.2
// Client for `/api/admin/v1` (client-rendered admin pages only): attaches the
// in-memory access token as `Authorization: Bearer` and turns failures into
// AdminApiError (parsed `application/problem+json`, spec §6.6).

export interface AdminRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON body, or `FormData` for `multipart/form-data` uploads (the CSV console). */
  body?: Record<string, unknown> | FormData;
  /** Arrays are sent as repeated keys (`status=a&status=b`). */
  query?: Record<string, string | number | readonly string[] | undefined>;
  /** `blob` for file downloads (CSV templates); JSON otherwise. */
  responseType?: 'json' | 'blob';
  /** Fetch cache mode, e.g. `no-cache` to revalidate a `Cache-Control: max-age` response. */
  cache?: RequestCache;
}

/** A successful response with its status (e.g. 201 processed inline vs 202 queued). */
export interface AdminRawResponse<T> {
  status: number;
  data: T;
}

/** Extracts status, parsed body and `Retry-After` from an ofetch FetchError (or anything thrown). */
function failureOf(error: unknown): {
  status: number | undefined;
  body: unknown;
  retryAfter: string | null;
} {
  if (typeof error !== 'object' || error === null) {
    return { status: undefined, body: undefined, retryAfter: null };
  }
  const e = error as {
    status?: unknown;
    response?: { status?: unknown; headers?: { get?: (name: string) => string | null } };
    data?: unknown;
  };
  const status =
    typeof e.response?.status === 'number'
      ? e.response.status
      : typeof e.status === 'number'
        ? e.status
        : undefined;
  const retryAfter =
    typeof e.response?.headers?.get === 'function' ? e.response.headers.get('retry-after') : null;
  return { status, body: e.data, retryAfter };
}

export type AdminApi = (<T>(path: string, options?: AdminRequestOptions) => Promise<T>) & {
  /** Same request, resolving to the HTTP status and the body. */
  raw<T>(path: string, options?: AdminRequestOptions): Promise<AdminRawResponse<T>>;
};

export function useAdminApi(): AdminApi {
  const { apiBase } = useRuntimeConfig().public;
  const auth = useAuth();
  const client = $fetch.create({
    baseURL: apiBase,
    headers: { accept: 'application/json, application/problem+json' },
    // Bearer tokens only: never send or store cookies.
    credentials: 'omit',
    retry: 0,
  });

  async function request<T>(
    path: string,
    options: AdminRequestOptions,
  ): Promise<AdminRawResponse<T>> {
    const token = auth.accessToken.value;
    if (!token) {
      throw new AdminApiError({
        status: 401,
        title: 'Not signed in',
        codes: ['oecp.auth.missing_token'],
      });
    }
    try {
      const response = await client.raw<T>(path, {
        method: options.method ?? 'GET',
        ...(options.body ? { body: options.body } : {}),
        ...(options.query ? { query: options.query } : {}),
        ...(options.responseType === 'blob' ? { responseType: 'blob' as const } : {}),
        ...(options.cache ? { cache: options.cache } : {}),
        headers: { authorization: `Bearer ${token}` },
      });
      return { status: response.status, data: response._data as T };
    } catch (error) {
      const { status, body, retryAfter } = failureOf(error);
      throw toAdminApiError(status, body, retryAfter);
    }
  }

  const adminApi = async <T>(path: string, options: AdminRequestOptions = {}): Promise<T> =>
    (await request<T>(path, options)).data;
  return Object.assign(adminApi, {
    raw: <T>(path: string, options: AdminRequestOptions = {}) => request<T>(path, options),
  });
}
