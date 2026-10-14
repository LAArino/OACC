// SPDX-License-Identifier: EUPL-1.2
// Shared loading of the offering pages under `/admin/courses/{id}/offerings`:
// the signed-in administrator, the course (with its offerings) and the reference
// data of the course's organization.
import type { AdminCourse, AdminCourseReference } from '~/types/admin';

export function useAdminCoursePage() {
  const route = useRoute();
  const auth = useAuth();
  const coursesApi = useAdminCoursesApi();
  const adminOrg = useAdminOrg();
  const courseId = computed(() => String(route.params.id ?? ''));
  const course = ref<AdminCourse | null>(null);
  const reference = ref<AdminCourseReference | null>(null);
  const loading = ref(false);
  const failure = ref<AdminApiError | null>(null);

  const title = computed(() => {
    const c = course.value;
    if (!c) return '';
    return c.texts.en?.title || Object.values(c.texts)[0]?.title || c.ext_id;
  });

  async function load() {
    loading.value = true;
    failure.value = null;
    try {
      const loaded = await coursesApi.get(courseId.value);
      reference.value = await coursesApi.reference(loaded.organization_id);
      course.value = loaded;
    } catch (error) {
      failure.value = asAdminApiError(error);
    } finally {
      loading.value = false;
    }
  }

  async function init() {
    if (!auth.isAuthenticated.value) return;
    await adminOrg.load();
    if (adminOrg.canManage.value) await load();
  }

  return {
    auth,
    me: adminOrg.me,
    meFailure: adminOrg.failure,
    meLoading: adminOrg.loading,
    canManage: adminOrg.canManage,
    orgQuery: adminOrg.orgQuery,
    courseId,
    course,
    reference,
    loading,
    failure,
    title,
    load,
    init,
  };
}
