<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Seats of an offering [DL 8]: "Seats available: N (as of date)" when the
// partner reported both the count and when, "Alliance seats: N" when seats are
// reserved for the alliance, both when both are set, else nothing.
import type { Offering } from '../types/catalogue';

const props = defineProps<{
  offering: Pick<Offering, 'seats_available' | 'alliance_seats' | 'seats_updated_at'> | null;
  /** Time zone used for the "as of" date (offering time zone; UTC when unknown). */
  timeZone?: string | null;
}>();
const { t, locale } = useI18n();
const info = computed(() => seatsInfo(props.offering));
const parts = computed(() => {
  const value = info.value;
  if (!value) return [];
  const list: string[] = [];
  if (value.available) {
    const { seats, asOf } = value.available;
    const date = formatDateTimeAsDate(asOf, locale.value, props.timeZone || 'UTC') ?? asOf;
    list.push(t('seats.available', { n: seats, date }));
  }
  if (value.alliance) list.push(t('seats.alliance', { n: value.alliance.seats }));
  return list;
});
</script>

<template>
  <p v-if="parts.length" class="seats">
    <template v-for="(part, index) in parts" :key="index"
      ><span v-if="index > 0" aria-hidden="true">{{ t('seats.separator') }}</span
      ><span>{{ part }}</span></template
    >
  </p>
</template>
