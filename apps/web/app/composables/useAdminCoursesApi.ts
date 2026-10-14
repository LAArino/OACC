// SPDX-License-Identifier: EUPL-1.2
// Course wizard client (spec §6.4, §8.1): courses, offerings, overrides, status
// changes and history of `/api/admin/v1`, plus the organization's reference data
// for the form (cached per organization and access token, successes only).
import type {
  AdminCourse,
  AdminCourseList,
  AdminCourseListQuery,
  AdminCourseReference,
  AdminHistory,
  AdminLifecycleStatus,
  AdminOffering,
  CourseInput,
  OfferingInput,
  OverridesPatch,
} from '~/types/admin';

const BASE = '/api/admin/v1';
const seg = (value: string) => encodeURIComponent(value);

let referenceCache: { key: string; promise: Promise<AdminCourseReference> } | undefined;

/** Forgets the cached reference data (e.g. after the organization's settings changed). */
export function resetAdminCourseReference(): void {
  referenceCache = undefined;
}

export function useAdminCoursesApi() {
  const api = useAdminApi();
  const auth = useAuth();

  function reference(orgId: string): Promise<AdminCourseReference> {
    const key = `${auth.accessToken.value ?? ''}|${orgId}`;
    if (referenceCache?.key !== key) {
      const promise = api<AdminCourseReference>(`${BASE}/organizations/${seg(orgId)}/reference`);
      const entry = { key, promise };
      referenceCache = entry;
      promise.catch(() => {
        if (referenceCache === entry) referenceCache = undefined;
      });
    }
    return referenceCache.promise;
  }

  function list(orgId: string, query: AdminCourseListQuery): Promise<AdminCourseList> {
    const q: Record<string, string | number | readonly string[] | undefined> = {};
    if (query.q) q.q = query.q;
    if (query.status?.length) q.status = query.status;
    if (query.kind?.length) q.kind = query.kind;
    if (query.source_channel?.length) q.source_channel = query.source_channel;
    if (query.page) q.page = query.page;
    if (query.page_size) q.page_size = query.page_size;
    return api<AdminCourseList>(`${BASE}/organizations/${seg(orgId)}/courses`, { query: q });
  }

  const body = (value: object) => value as Record<string, unknown>;

  return {
    reference,
    list,
    get: (id: string) => api<AdminCourse>(`${BASE}/courses/${seg(id)}`),
    create: (orgId: string, input: CourseInput) =>
      api<AdminCourse>(`${BASE}/organizations/${seg(orgId)}/courses`, {
        method: 'POST',
        body: body(input),
      }),
    update: (id: string, input: CourseInput) =>
      api<AdminCourse>(`${BASE}/courses/${seg(id)}`, { method: 'PUT', body: body(input) }),
    patchOverrides: (id: string, patch: OverridesPatch) =>
      api<AdminCourse>(`${BASE}/courses/${seg(id)}/overrides`, {
        method: 'PATCH',
        body: body(patch),
      }),
    setStatus: (id: string, status: AdminLifecycleStatus) =>
      api<AdminCourse>(`${BASE}/courses/${seg(id)}/status`, {
        method: 'POST',
        body: { status },
      }),
    remove: (id: string) => api<unknown>(`${BASE}/courses/${seg(id)}`, { method: 'DELETE' }),
    history: (id: string, limit = 50) =>
      api<AdminHistory>(`${BASE}/courses/${seg(id)}/history`, { query: { limit } }),

    createOffering: (courseId: string, input: OfferingInput) =>
      api<AdminOffering>(`${BASE}/courses/${seg(courseId)}/offerings`, {
        method: 'POST',
        body: body(input),
      }),
    updateOffering: (id: string, input: OfferingInput) =>
      api<AdminOffering>(`${BASE}/offerings/${seg(id)}`, { method: 'PUT', body: body(input) }),
    patchOfferingOverrides: (id: string, patch: OverridesPatch) =>
      api<AdminOffering>(`${BASE}/offerings/${seg(id)}/overrides`, {
        method: 'PATCH',
        body: body(patch),
      }),
    setOfferingStatus: (id: string, status: AdminLifecycleStatus) =>
      api<AdminOffering>(`${BASE}/offerings/${seg(id)}/status`, {
        method: 'POST',
        body: { status },
      }),
    removeOffering: (id: string) =>
      api<unknown>(`${BASE}/offerings/${seg(id)}`, { method: 'DELETE' }),
  };
}

export type AdminCoursesApi = ReturnType<typeof useAdminCoursesApi>;
