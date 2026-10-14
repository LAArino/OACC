// SPDX-License-Identifier: EUPL-1.2
// State of the organization form shared by the "new" and the organization
// pages: client-side validation (after the first submit, then live), server
// field errors mapped back to fields, and the error summary entries.
import type { FormIssue } from '~/utils/adminCourseForm';
import {
  emptyOrganizationForm,
  ORGANIZATION_SERVER_CODES,
  organizationFieldId,
  organizationFieldOf,
  validateOrganizationForm,
} from '~/utils/organizationForm';

export function useAdminOrganizationForm(context: () => { creating: boolean; selfId?: string }) {
  const { t, te } = useI18n();
  const form = ref(emptyOrganizationForm());
  const issues = ref<FormIssue[]>([]);
  const submitted = ref(false);

  function issueText(issue: FormIssue): string {
    const key = issue.code.startsWith('oecp.') ? ORGANIZATION_SERVER_CODES[issue.code] : issue.code;
    if (key && te(`admin.organizations.validation.${key}`)) {
      return t(`admin.organizations.validation.${key}`);
    }
    return issue.message ?? t('admin.validation.invalid');
  }

  const errors = computed(() => {
    const out: Record<string, string> = {};
    for (const issue of issues.value) out[issue.field] ??= issueText(issue);
    return out;
  });
  const summaryIssues = computed(() =>
    issues.value.map((i) => ({ id: organizationFieldId(i.field), message: issueText(i) })),
  );

  watch(
    form,
    () => {
      if (submitted.value) issues.value = validateOrganizationForm(form.value, context());
    },
    { deep: true },
  );

  /** Runs the client checks; true when the form may be sent. */
  function validate(): boolean {
    submitted.value = true;
    issues.value = validateOrganizationForm(form.value, context());
    return issues.value.length === 0;
  }

  /** Shows a 400/409 problem's field errors (or the known codes) on the fields; true if any. */
  function applyServerError(error: AdminApiError): boolean {
    const fromPointers = serverFormIssues(error.problem)
      .filter((i) => i.field)
      .map((i) => ({ ...i, field: organizationFieldOf(i.field, form.value) }));
    const byCode = error.codes
      .filter(
        (code) => code in ORGANIZATION_SERVER_CODES && code !== 'oecp.content.duplicate_identifier',
      )
      .map((code) => ({
        field: code === 'oecp.content.invalid_parent' ? 'parent_id' : 'slug',
        code,
      }));
    const mapped = fromPointers.length ? fromPointers : byCode;
    if (!mapped.length) return false;
    issues.value = mapped;
    return true;
  }

  function reset(next = emptyOrganizationForm()) {
    form.value = next;
    issues.value = [];
    submitted.value = false;
  }

  return { form, issues, errors, summaryIssues, validate, applyServerError, reset };
}

/** Focuses the control of an error summary entry. */
export function focusFormField(id: string): void {
  document.getElementById(id)?.focus();
}
