<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Result pages as plain links carrying the whole search in the query string
// (crawlable, shareable, no JavaScript needed).
import type { SearchState } from '../types/catalogue';

const props = defineProps<{
  state: SearchState;
  total: number;
  pageSize: number;
  listPath: string;
}>();
const emit = defineEmits<{ navigate: [] }>();
const { t } = useI18n();

const pageCount = computed(() =>
  Math.min(PAGE_MAX, Math.max(1, Math.ceil(props.total / Math.max(1, props.pageSize)))),
);
const current = computed(() => Math.min(props.state.page, pageCount.value));
const to = (page: number) => ({
  path: props.listPath,
  query: toRouteQuery(withPage(props.state, page)),
});

/** Page numbers to show, with `null` for a gap: 1 … p-1 p p+1 … last. */
const pages = computed<(number | null)[]>(() => {
  const last = pageCount.value;
  const p = current.value;
  const wanted = new Set([1, last, p - 1, p, p + 1].filter((n) => n >= 1 && n <= last));
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && n - prev > 1) out.push(n - prev === 2 ? n - 1 : null);
    out.push(n);
  });
  return out;
});
</script>

<template>
  <nav v-if="pageCount > 1" class="pagination" :aria-label="t('pagination.label')">
    <ul>
      <li v-if="current > 1">
        <NuxtLink :to="to(current - 1)" rel="prev" @click="emit('navigate')">
          <span aria-hidden="true">‹ </span>{{ t('pagination.previous') }}
        </NuxtLink>
      </li>
      <li v-for="(page, index) in pages" :key="page ?? `gap-${index}`">
        <span v-if="page === null" class="pagination__gap" aria-hidden="true">…</span>
        <span v-else-if="page === current" class="pagination__current" aria-current="page">
          <span class="visually-hidden">{{ t('pagination.page', { n: page }) }}</span>
          <span aria-hidden="true">{{ page }}</span>
        </span>
        <NuxtLink v-else :to="to(page)" @click="emit('navigate')">
          <span class="visually-hidden">{{ t('pagination.page', { n: page }) }}</span>
          <span aria-hidden="true">{{ page }}</span>
        </NuxtLink>
      </li>
      <li v-if="current < pageCount">
        <NuxtLink :to="to(current + 1)" rel="next" @click="emit('navigate')">
          {{ t('pagination.next') }}<span aria-hidden="true"> ›</span>
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.pagination ul {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  list-style: none;
  margin: 1.5rem 0 0;
  padding: 0;
}
.pagination a,
.pagination__current,
.pagination__gap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding: 0 0.6rem;
  border-radius: var(--radius);
}
.pagination a {
  border: 1px solid var(--c-border);
  text-decoration: none;
}
.pagination a:hover {
  background: var(--c-chip);
}
.pagination__current {
  background: var(--c-primary);
  color: var(--c-on-primary);
  font-weight: 700;
}
</style>
