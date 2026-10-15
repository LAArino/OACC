<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// The expanded part of a maintenance run row: when and by whom it ran, the full
// error, the job-specific `details` as a definition list and, for the dormancy
// and account clean-up jobs, the listed administrators as a table so that the
// alliance can review a dry run before enabling the job (spec §2.2).
import type { AdminMaintenanceRun } from '~/types/admin';
import type { MaintenanceCandidate } from '~/utils/maintenance';

const props = defineProps<{
  run: AdminMaintenanceRun;
  /** Display names of organizations by id (unknown ids are shown as they are). */
  organizationNames: Readonly<Record<string, string>>;
}>();
const { t, te, locale } = useI18n();

const candidates = computed(() => runCandidates(props.run));
const dryRun = computed(() => runDryRun(props.run));
const dryRunSwitch = computed(() =>
  isKnownMaintenanceJob(props.run.job) ? (DRY_RUN_SWITCHES[props.run.job] ?? null) : null,
);
/** Every details member but the candidates list (shown as a table). */
const details = computed(() =>
  Object.entries(props.run.details ?? {}).filter(([key]) => key !== 'candidates'),
);
const captionId = computed(() => `run-${props.run.id}-candidates`);

const valueText = (key: string, value: unknown) => {
  if (typeof value === 'boolean') return value ? t('admin.yes') : t('admin.no');
  if (typeof value === 'string' && /_at$|_since$|^cutoff$/.test(key)) {
    return formatAdminDateTime(value, locale.value) || value;
  }
  return detailValueText(value);
};
const organizationText = (id: string | null) =>
  id ? (props.organizationNames[id] ?? id) : t('admin.none');
const actionText = (action: string | null) => {
  if (!action) return t('admin.none');
  const key = `admin.maintenance.candidateAction.${action}`;
  return te(key) ? t(key) : humanizeKey(action);
};
/** Removal audit action (`admin.revoke`, `admin.dormant_revoke`) in words. */
const removalText = (action: string | null) => {
  const key = `admin.maintenance.candidates.removal.${(action ?? '').replace(/^admin\./, '')}`;
  return action && te(key) ? t(key) : (action ?? '');
};
const rolesText = (c: MaintenanceCandidate) => {
  if (c.roles.length)
    return c.roles.map((r) => (te(`roles.${r}`) ? t(`roles.${r}`) : r)).join(', ');
  if (c.rolesRemovedAt) {
    return t('admin.maintenance.candidates.rolesRemoved', {
      date: formatAdminDateTime(c.rolesRemovedAt, locale.value),
      how: removalText(c.removalAction),
    });
  }
  return t('admin.none');
};
</script>

<template>
  <div class="admin-run-details">
    <dl class="facts">
      <dt>{{ t('admin.maintenance.details.id') }}</dt>
      <dd>
        <code>{{ props.run.id }}</code>
      </dd>
      <dt>{{ t('admin.maintenance.details.triggeredBy') }}</dt>
      <dd>
        <code v-if="props.run.triggered_by">{{ props.run.triggered_by }}</code>
        <template v-else>{{ t('admin.maintenance.details.system') }}</template>
      </dd>
      <dt>{{ t('admin.maintenance.details.finished') }}</dt>
      <dd>
        {{
          props.run.finished_at
            ? formatAdminDateTime(props.run.finished_at, locale)
            : t('admin.maintenance.details.notFinished')
        }}
      </dd>
      <template v-if="props.run.error">
        <dt>{{ t('admin.maintenance.details.error') }}</dt>
        <dd class="admin-run-details__error">{{ props.run.error }}</dd>
      </template>
      <template v-for="[key, value] in details" :key="key">
        <dt>
          <code>{{ key }}</code>
        </dt>
        <dd>
          <pre v-if="isStructuredDetail(value)">{{ detailValueText(value) }}</pre>
          <template v-else>{{ valueText(key, value) || t('admin.none') }}</template>
        </dd>
      </template>
    </dl>
    <p v-if="!details.length && !props.run.error" class="admin-hint">
      {{ t('admin.maintenance.details.empty') }}
    </p>

    <p v-if="dryRun === true && dryRunSwitch" class="admin-run-details__notice">
      {{ t('admin.maintenance.dryRun.runNotice', { variable: dryRunSwitch }) }}
    </p>

    <template v-if="candidates">
      <p v-if="!candidates.length">
        {{ t('admin.maintenance.candidates.empty') }}
      </p>
      <div v-else class="admin-table-wrap" role="region" :aria-labelledby="captionId" tabindex="0">
        <table class="admin-table">
          <caption :id="captionId">
            {{
              t(
                dryRun
                  ? 'admin.maintenance.candidates.captionDryRun'
                  : 'admin.maintenance.candidates.caption',
                { n: candidates.length },
                candidates.length,
              )
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('admin.maintenance.candidates.sub') }}</th>
              <th scope="col">{{ t('admin.maintenance.candidates.roles') }}</th>
              <th scope="col">{{ t('admin.maintenance.candidates.organization') }}</th>
              <th scope="col">{{ t('admin.maintenance.candidates.lastActivity') }}</th>
              <th scope="col" class="num">
                {{ t('admin.maintenance.candidates.inactiveDays') }}
              </th>
              <th scope="col">{{ t('admin.maintenance.candidates.action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(c, i) in candidates" :key="`${c.sub}-${i}`">
              <th scope="row">
                <code>{{ c.sub || t('admin.none') }}</code>
              </th>
              <td>{{ rolesText(c) }}</td>
              <td>{{ organizationText(c.organizationId) }}</td>
              <td>
                {{
                  c.lastActivityAt ? formatAdminDateTime(c.lastActivityAt, locale) : t('admin.none')
                }}
              </td>
              <td class="num">{{ c.inactiveDays ?? t('admin.none') }}</td>
              <td>{{ actionText(c.action) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
