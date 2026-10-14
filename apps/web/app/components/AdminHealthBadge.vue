<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// Health of an organization's data feed in the network status (`GET
// /network-status`): ok, warning, error or unconfigured, as text with a tone.
import type { AdminNetworkHealth } from '~/types/admin';

const props = defineProps<{ health: AdminNetworkHealth }>();
const { t } = useI18n();
const TONES = { ok: 'ok', warning: 'warn', error: 'bad', unconfigured: 'neutral' } as const;
</script>

<template>
  <AdminBadge :tone="TONES[props.health]" :label="t(`admin.network.health.${props.health}`)" />
</template>
