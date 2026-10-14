<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// The organization the admin modules act on. Alliance administrators choose it
// from the public reference list (`GET /api/public/v1/reference`); the choice is
// kept in the `?org=` query, which the module links carry. Others see their
// organization's name.
import type { AdminOrganization } from '~/composables/useAdminReference';
const props = defineProps<{ orgId: string | null; editable: boolean }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const reference = useAdminReference();
const selectId = useId();
const organizations = ref<AdminOrganization[]>([]);
const unavailable = ref(false);

onMounted(async () => {
  try {
    organizations.value = (await reference.load()).organizations;
  } catch {
    unavailable.value = true;
  }
});

/** Top-level organizations by name, each followed by its sub-units. */
const options = computed(() => {
  const byName = (a: AdminOrganization, b: AdminOrganization) =>
    organizationName(a).localeCompare(organizationName(b));
  const ids = new Set(organizations.value.map((o) => o.id));
  const roots = organizations.value.filter((o) => !o.parent_id || !ids.has(o.parent_id));
  const out: { id: string; label: string }[] = [];
  const visit = (org: AdminOrganization, depth: number) => {
    out.push({ id: org.id, label: `${'— '.repeat(depth)}${organizationName(org)}` });
    organizations.value
      .filter((o) => o.parent_id === org.id)
      .sort(byName)
      .forEach((child) => visit(child, depth + 1));
  };
  [...roots].sort(byName).forEach((org) => visit(org, 0));
  return out;
});

const currentName = computed(() => {
  const org = organizations.value.find((o) => o.id === props.orgId);
  return org ? organizationName(org) : props.orgId;
});

async function onChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  const query = { ...route.query };
  if (value) query.org = value;
  else delete query.org;
  await router.replace({ query });
}
</script>

<template>
  <div class="admin-field admin-org-picker">
    <template v-if="props.editable && !unavailable">
      <label :for="selectId">{{ t('admin.org.select') }}</label>
      <select :id="selectId" :value="props.orgId ?? ''" @change="onChange">
        <option value="">
          {{ t('admin.org.choose') }}
        </option>
        <option v-for="o in options" :key="o.id" :value="o.id">
          {{ o.label }}
        </option>
      </select>
    </template>
    <p v-else-if="props.orgId">
      <strong>{{ t('admin.organization') }}:</strong> {{ currentName }}
    </p>
    <p v-else>
      {{ t('admin.org.none') }}
    </p>
  </div>
</template>
