<!-- SPDX-License-Identifier: EUPL-1.2 -->
<script setup lang="ts">
// CSV console (spec §6.3, §8.1): template downloads, drag-and-drop selection of
// `courses.csv` and/or `offerings.csv`, validation in the browser (Web Worker,
// shared validator of @oecp/schemas) with an immediate error report, then the
// upload, which the server revalidates. File contents are never logged.
import {
  CSV_MAX_ROWS,
  type CsvFileKind,
  type CsvIssue,
  type CsvUploadResponse,
  type SyncRunDetail,
  type SyncRunStatus,
} from '@oecp/schemas';
import type { CsvUploadInlineResponse, CsvUploadProblem } from '~/types/admin';
import type { CsvValidationInput, CsvValidationSummary } from '~/utils/csvConsole';

definePageMeta({ layout: 'admin' });
const { t, locale } = useI18n();
const localePath = useLocalePath();
const auth = useAuth();
const adminApi = useAdminApi();
const adminOrg = useAdminOrg();
const {
  me,
  failure: meFailure,
  loading: meLoading,
  isAlliance,
  canManage,
  orgId,
  orgQuery,
} = adminOrg;
const reference = useAdminReference();
const validator = useCsvValidator();
const { apiBase } = useRuntimeConfig().public;
useHead({ title: () => t('admin.csv.title') });

/** Spec §8.1: the queued run is polled until it ends. */
const POLL_MS = 3000;
const TERMINAL: ReadonlySet<SyncRunStatus> = new Set([
  'succeeded',
  'partial',
  'failed',
  'cancelled',
]);
const MAX_FILES = 2;

const TEMPLATES = [
  { path: 'courses.csv', filename: 'courses.csv', label: 'admin.csv.templateCourses' },
  { path: 'offerings.csv', filename: 'offerings.csv', label: 'admin.csv.templateOfferings' },
  { path: 'schema.json', filename: 'oecp-csv-1.3.schema.json', label: 'admin.csv.templateSchema' },
] as const;

interface SelectedFile {
  id: number;
  file: File;
  kind: CsvFileKind | null;
  detectedBy: 'header' | 'name' | null;
  tooLarge: boolean;
}

type Outcome =
  | { kind: 'inline'; data: CsvUploadInlineResponse }
  | { kind: 'queued'; runId: string }
  | { kind: 'rejected'; problem: CsvUploadProblem }
  | { kind: 'failed'; error: AdminApiError };

let nextFileId = 1;
let validationRun = 0;
let pollTimer: ReturnType<typeof setTimeout> | undefined;

const files = ref<SelectedFile[]>([]);
const selectionNotice = ref<string | null>(null);
const validating = ref(false);
const report = ref<CsvValidationSummary | null>(null);
const referenceUnavailable = ref(false);
const uploading = ref(false);
const outcome = ref<Outcome | null>(null);
const queuedRun = ref<SyncRunDetail | null>(null);
const pollFailure = ref<AdminApiError | null>(null);
const templateFailure = ref<AdminApiError | null>(null);

const filesHeading = ref<HTMLElement | null>(null);
const reportHeading = ref<HTMLElement | null>(null);
const resultHeading = ref<HTMLElement | null>(null);

onMounted(() => {
  if (auth.isAuthenticated.value) void adminOrg.load();
});
onBeforeUnmount(stopPolling);
// Another organization chosen (alliance administrators): start over.
watch(orgId, (value, previous) => {
  if (value !== previous) reset(false);
});

const kindProblem = computed<'missing' | 'duplicate' | null>(() => {
  if (files.value.some((f) => !f.kind)) return 'missing';
  const kinds = files.value.map((f) => f.kind);
  return new Set(kinds).size === kinds.length ? null : 'duplicate';
});

const canUpload = computed(
  () =>
    !!orgId.value &&
    files.value.length > 0 &&
    !kindProblem.value &&
    !validating.value &&
    !uploading.value &&
    report.value !== null &&
    report.value.errorCount === 0 &&
    (outcome.value === null || outcome.value.kind === 'failed'),
);

const uploadHint = computed(() => {
  if (outcome.value && outcome.value.kind !== 'failed') return t('admin.csv.uploadDone');
  if (!files.value.length) return t('admin.csv.uploadNeedsFiles');
  if (kindProblem.value === 'missing') return t('admin.csv.kindMissing');
  if (kindProblem.value === 'duplicate') return t('admin.csv.kindDuplicate');
  if (validating.value || !report.value) return t('admin.csv.validating');
  if (report.value.errorCount > 0) return t('admin.csv.uploadBlocked');
  return t('admin.csv.uploadReady');
});

const statusText = computed(() => {
  if (uploading.value) return t('admin.csv.uploading');
  if (validating.value) return t('admin.csv.validating');
  if (!report.value) return '';
  const counts = { errors: report.value.errorCount, warnings: report.value.warningCount };
  return report.value.errorCount > 0
    ? t('admin.csv.statusErrors', counts)
    : t('admin.csv.statusReady', counts);
});

const reportIssues = computed(() => report.value?.issues ?? []);

function runLink(id: string) {
  return localePath({ path: `/admin/sync-runs/${id}`, query: orgQuery.value });
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function templateUrl(path: string): string {
  return `${apiBase.replace(/\/$/, '')}/api/admin/v1/csv-template/${path}`;
}

/** The template endpoints need the bearer token: fetched as a Blob, saved via an object URL. */
async function downloadTemplate(path: string, filename: string) {
  templateFailure.value = null;
  try {
    const blob = await adminApi<Blob>(`/api/admin/v1/csv-template/${path}`, {
      responseType: 'blob',
    });
    saveBlob(blob, filename);
  } catch (error) {
    templateFailure.value = asAdminApiError(error);
  }
}

// ---------------------------------------------------------------------------
// Selection and browser validation
// ---------------------------------------------------------------------------

async function onSelect(selected: File[]) {
  selectionNotice.value = null;
  const room = MAX_FILES - files.value.length;
  if (selected.length > room) selectionNotice.value = t('admin.csv.tooManyFiles');
  for (const file of selected.slice(0, Math.max(0, room))) {
    const probe = new Uint8Array(await file.slice(0, CSV_HEADER_PROBE_BYTES).arrayBuffer());
    const byHeader = detectCsvKind(readCsvHeader(probe));
    const byName = kindFromFileName(file.name);
    files.value.push({
      id: nextFileId++,
      file,
      kind: byHeader ?? byName,
      detectedBy: byHeader ? 'header' : byName ? 'name' : null,
      tooLarge: isFileTooLarge(file.size),
    });
  }
  clearOutcome();
  await validate(true);
}

async function onKindChange(entry: SelectedFile, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  entry.kind = value === 'courses' || value === 'offerings' ? value : null;
  entry.detectedBy = null;
  clearOutcome();
  await validate(false);
}

async function removeFile(entry: SelectedFile) {
  files.value = files.value.filter((f) => f.id !== entry.id);
  selectionNotice.value = null;
  clearOutcome();
  await validate(false);
  if (!files.value.length) filesHeading.value?.focus();
}

async function validate(focusReport: boolean) {
  const run = ++validationRun;
  report.value = null;
  if (!files.value.length || kindProblem.value) {
    validating.value = false;
    return;
  }
  validating.value = true;
  const input: CsvValidationInput = { files: {} };
  const oversized: CsvIssue[] = [];
  for (const entry of files.value) {
    if (!entry.kind) continue;
    if (entry.tooLarge) oversized.push(fileTooLargeIssue(entry.kind));
    else input.files[entry.kind] = new Uint8Array(await entry.file.arrayBuffer());
  }
  try {
    const data = await reference.load();
    input.reference = {
      iscedCodes: data.isced_broad_fields.map((f) => f.code),
      deliveryModes: data.delivery_modes.map((m) => m.code),
    };
    referenceUnavailable.value = false;
  } catch {
    // Validate anyway; the reference checks are left to the server.
    referenceUnavailable.value = true;
  }
  const summary: CsvValidationSummary = Object.keys(input.files).length
    ? await validator.validate(input)
    : { files: {}, rowCount: 0, errorCount: 0, warningCount: 0, issues: [] };
  if (run !== validationRun) return;
  for (const issue of oversized) {
    summary.files[issue.file] = { rows: 0, errorCount: 1, warningCount: 0 };
  }
  summary.errorCount += oversized.length;
  summary.issues = [...oversized, ...summary.issues];
  report.value = summary;
  validating.value = false;
  if (focusReport) {
    await nextTick();
    reportHeading.value?.focus();
  }
}

// ---------------------------------------------------------------------------
// Upload and result
// ---------------------------------------------------------------------------

async function upload() {
  const org = orgId.value;
  if (!canUpload.value || !org) return;
  uploading.value = true;
  clearOutcome();
  const form = new FormData();
  for (const entry of files.value) {
    if (entry.kind) form.append(entry.kind, entry.file, entry.file.name);
  }
  try {
    const response = await adminApi.raw<CsvUploadResponse | CsvUploadInlineResponse>(
      `/api/admin/v1/organizations/${encodeURIComponent(org)}/uploads`,
      { method: 'POST', body: form },
    );
    const data = response.data;
    if (response.status === 202 || !('run' in data)) {
      outcome.value = { kind: 'queued', runId: data.sync_run_id };
      schedulePoll(data.sync_run_id);
    } else {
      outcome.value = { kind: 'inline', data };
    }
  } catch (error) {
    const failure = asAdminApiError(error);
    outcome.value =
      failure.status === 422 && failure.problem
        ? { kind: 'rejected', problem: failure.problem as CsvUploadProblem }
        : { kind: 'failed', error: failure };
  } finally {
    uploading.value = false;
  }
  await nextTick();
  resultHeading.value?.focus();
}

function schedulePoll(runId: string) {
  stopPolling();
  pollTimer = setTimeout(() => void poll(runId), POLL_MS);
}

async function poll(runId: string) {
  pollTimer = undefined;
  try {
    const detail = await adminApi<SyncRunDetail>(
      `/api/admin/v1/sync-runs/${encodeURIComponent(runId)}`,
      { query: { page_size: 100 } },
    );
    if (outcome.value?.kind !== 'queued' || outcome.value.runId !== runId) return;
    queuedRun.value = detail;
    pollFailure.value = null;
    if (TERMINAL.has(detail.status)) return;
  } catch (error) {
    if (outcome.value?.kind !== 'queued' || outcome.value.runId !== runId) return;
    const failure = asAdminApiError(error);
    pollFailure.value = failure;
    // Not recoverable by waiting: signed out, no access, or the run is gone.
    if ([401, 403, 404].includes(failure.status)) return;
  }
  schedulePoll(runId);
}

function stopPolling() {
  if (pollTimer !== undefined) clearTimeout(pollTimer);
  pollTimer = undefined;
}

const queuedTerminal = computed(() =>
  queuedRun.value ? TERMINAL.has(queuedRun.value.status) : false,
);

function clearOutcome() {
  stopPolling();
  outcome.value = null;
  queuedRun.value = null;
  pollFailure.value = null;
}

function reset(focus = true) {
  validationRun++;
  clearOutcome();
  files.value = [];
  report.value = null;
  validating.value = false;
  selectionNotice.value = null;
  templateFailure.value = null;
  if (focus) void nextTick(() => filesHeading.value?.focus());
}
</script>

<template>
  <div class="admin-page">
    <NuxtLink class="admin-back" :to="localePath({ path: '/admin', query: orgQuery })">
      {{ t('admin.backToDashboard') }}
    </NuxtLink>
    <h1>{{ t('admin.csv.title') }}</h1>

    <AdminSignInPrompt v-if="!auth.isAuthenticated.value" />
    <template v-else>
      <AdminMessage v-if="meLoading" :focus="false">
        <p>{{ t('admin.loadingAccount') }}</p>
      </AdminMessage>
      <AdminProblem v-else-if="meFailure" :error="meFailure" />
      <template v-else-if="me">
        <AdminMessage v-if="!canManage" kind="alert">
          <p>{{ t('problem.forbidden') }}</p>
        </AdminMessage>
        <template v-else>
          <AdminOrgPicker :org-id="orgId" :editable="isAlliance" />
          <p v-if="!orgId">
            {{ t('admin.modules.chooseOrganization') }}
          </p>
          <template v-else>
            <p>{{ t('admin.csv.intro', { rows: CSV_MAX_ROWS }) }}</p>
            <p>{{ t('admin.csv.columnsInfo') }}</p>
            <p>{{ t('admin.csv.imageColumnsInfo') }}</p>

            <section aria-labelledby="templates-heading">
              <h2 id="templates-heading">
                {{ t('admin.csv.templatesHeading') }}
              </h2>
              <ul>
                <li v-for="tpl in TEMPLATES" :key="tpl.path">
                  <a
                    :href="templateUrl(tpl.path)"
                    @click.prevent="downloadTemplate(tpl.path, tpl.filename)"
                  >
                    {{ t(tpl.label) }}
                  </a>
                </li>
              </ul>
              <AdminProblem v-if="templateFailure" :error="templateFailure" />
            </section>

            <section aria-labelledby="files-heading">
              <h2 id="files-heading" ref="filesHeading" tabindex="-1">
                {{ t('admin.csv.filesHeading') }}
              </h2>
              <AdminDropZone
                :hint="t('admin.csv.dropHint')"
                :disabled="uploading || files.length >= MAX_FILES"
                @select="onSelect"
              />
              <AdminMessage v-if="selectionNotice" kind="alert" :focus="false">
                <p>{{ selectionNotice }}</p>
              </AdminMessage>
              <div
                v-if="files.length"
                class="admin-table-wrap"
                role="region"
                aria-labelledby="selected-caption"
                tabindex="0"
              >
                <table class="admin-table">
                  <caption id="selected-caption">
                    {{
                      t('admin.csv.selectedCaption')
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        {{ t('admin.csv.fileName') }}
                      </th>
                      <th scope="col" class="num">
                        {{ t('admin.csv.fileSize') }}
                      </th>
                      <th scope="col">
                        {{ t('admin.csv.fileKind') }}
                      </th>
                      <th scope="col">
                        {{ t('admin.csv.fileActions') }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="entry in files" :key="entry.id">
                      <th scope="row">
                        {{ entry.file.name }}
                      </th>
                      <td class="num">
                        {{ formatAdminBytes(entry.file.size, locale) }}
                        <span v-if="entry.tooLarge" class="admin-csv__too-large">
                          {{ t('admin.csv.tooLarge') }}
                        </span>
                      </td>
                      <td>
                        <label :for="`kind-${entry.id}`" class="visually-hidden">
                          {{ t('admin.csv.kindLabel', { name: entry.file.name }) }}
                        </label>
                        <select
                          :id="`kind-${entry.id}`"
                          :value="entry.kind ?? ''"
                          :aria-describedby="`kind-note-${entry.id}`"
                          :disabled="uploading"
                          @change="onKindChange(entry, $event)"
                        >
                          <option value="">
                            {{ t('admin.csv.kindChoose') }}
                          </option>
                          <option value="courses">
                            {{ t('admin.csv.kindCourses') }}
                          </option>
                          <option value="offerings">
                            {{ t('admin.csv.kindOfferings') }}
                          </option>
                        </select>
                        <span :id="`kind-note-${entry.id}`" class="admin-csv__note">
                          {{
                            entry.detectedBy === 'header'
                              ? t('admin.csv.detectedHeader')
                              : entry.detectedBy === 'name'
                                ? t('admin.csv.detectedName')
                                : entry.kind
                                  ? t('admin.csv.detectedManual')
                                  : t('admin.csv.detectedNone')
                          }}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          class="button button--secondary"
                          :disabled="uploading"
                          @click="removeFile(entry)"
                        >
                          {{ t('admin.csv.remove', { name: entry.file.name }) }}
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-if="kindProblem === 'missing'">{{ t('admin.csv.kindMissing') }}</p>
              <p v-else-if="kindProblem === 'duplicate'">{{ t('admin.csv.kindDuplicate') }}</p>
            </section>

            <p class="admin-csv__status" role="status" aria-live="polite">{{ statusText }}</p>

            <section v-if="report" aria-labelledby="report-heading">
              <h2 id="report-heading" ref="reportHeading" tabindex="-1">
                {{ t('admin.csv.reportHeading') }}
              </h2>
              <dl class="facts">
                <dt>{{ t('admin.csv.rows') }}</dt>
                <dd>{{ report.rowCount }}</dd>
                <dt>{{ t('admin.csv.errors') }}</dt>
                <dd>{{ report.errorCount }}</dd>
                <dt>{{ t('admin.csv.warnings') }}</dt>
                <dd>{{ report.warningCount }}</dd>
              </dl>
              <p v-if="referenceUnavailable" class="notice">
                {{ t('admin.csv.referenceUnavailable') }}
              </p>
              <p v-if="report.issues.length < report.errorCount + report.warningCount">
                {{ t('admin.csv.truncated', { shown: report.issues.length }) }}
              </p>
              <AdminIssuesTable
                :issues="reportIssues"
                :caption="t('admin.csv.reportCaption')"
                download-name="oecp-csv-validation-report.csv"
              />
            </section>

            <div class="admin-actions">
              <button
                type="button"
                class="button"
                :disabled="!canUpload"
                aria-describedby="upload-hint"
                @click="upload"
              >
                {{ uploading ? t('admin.csv.uploading') : t('admin.csv.upload') }}
              </button>
              <button type="button" class="button button--secondary" @click="reset()">
                {{ t('admin.csv.reset') }}
              </button>
            </div>
            <p id="upload-hint" class="admin-csv__note">{{ uploadHint }}</p>

            <section v-if="outcome" aria-labelledby="result-heading" class="admin-card">
              <h2 id="result-heading" ref="resultHeading" tabindex="-1">
                {{ t('admin.csv.resultHeading') }}
              </h2>

              <template v-if="outcome.kind === 'inline'">
                <AdminMessage :focus="false">
                  <p>
                    {{
                      t('admin.csv.processed', {
                        status: t(`admin.runStatus.${outcome.data.run.status}`),
                      })
                    }}
                  </p>
                </AdminMessage>
                <AdminRunSummary :run="outcome.data.run" :to="runLink(outcome.data.sync_run_id)" />
                <AdminIssuesTable
                  v-if="outcome.data.warnings.length"
                  :issues="issuesFromProblemErrors(outcome.data.warnings)"
                  :caption="t('admin.csv.warningsCaption')"
                />
              </template>

              <template v-else-if="outcome.kind === 'queued'">
                <AdminMessage :focus="false">
                  <p v-if="!queuedTerminal">
                    {{ t('admin.csv.queued') }}
                  </p>
                  <p v-else-if="queuedRun">
                    {{
                      t('admin.csv.queuedDone', {
                        status: t(`admin.runStatus.${queuedRun.status}`),
                      })
                    }}
                  </p>
                </AdminMessage>
                <p>
                  <NuxtLink :to="runLink(outcome.runId)">
                    {{ t('admin.run.open') }}
                  </NuxtLink>
                </p>
                <AdminProblem v-if="pollFailure" :error="pollFailure" />
                <AdminRunSummary v-if="queuedRun" :run="queuedRun" />
                <AdminIssuesTable
                  v-if="queuedRun && queuedTerminal && queuedRun.errors.items.length"
                  :issues="issuesFromSyncErrors(queuedRun.errors.items)"
                  :total="queuedRun.errors.total"
                  :caption="t('admin.run.errorsCaption')"
                />
              </template>

              <template v-else-if="outcome.kind === 'rejected'">
                <AdminMessage kind="alert" :focus="false">
                  <p>
                    {{
                      t('admin.csv.rejected', {
                        errors:
                          outcome.problem.error_count ??
                          (outcome.problem.errors ?? []).filter((e) => e.severity === 'error')
                            .length,
                        warnings:
                          outcome.problem.warning_count ??
                          (outcome.problem.errors ?? []).filter((e) => e.severity === 'warning')
                            .length,
                      })
                    }}
                  </p>
                  <p v-if="outcome.problem.detail">{{ outcome.problem.detail }}</p>
                </AdminMessage>
                <p v-if="outcome.problem.sync_run_id">
                  {{ t('admin.csv.runId') }}
                  <NuxtLink :to="runLink(outcome.problem.sync_run_id)">
                    <code>{{ outcome.problem.sync_run_id }}</code>
                  </NuxtLink>
                </p>
                <AdminIssuesTable
                  :issues="issuesFromProblemErrors(outcome.problem.errors)"
                  :caption="t('admin.csv.serverCaption')"
                  :download-name="`oecp-csv-upload-${outcome.problem.sync_run_id ?? 'report'}.csv`"
                />
              </template>

              <AdminProblem v-else :error="outcome.error" :heading="t('admin.csv.failed')" />
            </section>
          </template>
        </template>
      </template>
    </template>
  </div>
</template>

<style src="~/assets/css/admin.css"></style>
<style scoped>
.admin-csv__note {
  display: block;
  color: var(--c-muted);
  font-size: 0.9rem;
}
.admin-csv__too-large {
  display: block;
  color: var(--c-danger);
  font-weight: 600;
}
.admin-csv__status:empty {
  margin: 0;
}
</style>
