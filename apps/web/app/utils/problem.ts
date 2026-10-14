// SPDX-License-Identifier: EUPL-1.2
// Admin API errors: RFC 9457 `application/problem+json` (spec §6.6) parsed into a
// typed error, and stable error codes mapped to translated messages.
import type { ProblemDetails, ProblemError } from '@oecp/schemas';

/** An admin API call that failed; `status` 0 means no HTTP response (network error). */
export class AdminApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string | undefined;
  /** Stable error codes from `errors[]`, in order (e.g. `oecp.invitation.expired`). */
  readonly codes: readonly string[];
  /** True when title/detail come from a problem+json body (server text worth showing). */
  readonly fromServer: boolean;
  /**
   * The parsed problem+json body, extension members included (e.g. the
   * `sync_run_id`, `error_count` and full `errors[]` of a failed CSV upload).
   */
  readonly problem: Readonly<ProblemDetails> | undefined;
  /** `Retry-After` in seconds (429 responses), when the server sent one. */
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    status: number;
    title: string;
    detail?: string;
    codes?: readonly string[];
    fromServer?: boolean;
    problem?: ProblemDetails;
    retryAfterSeconds?: number;
  }) {
    super(init.detail ?? init.title);
    this.name = 'AdminApiError';
    this.status = init.status;
    this.title = init.title;
    this.detail = init.detail;
    this.codes = init.codes ?? [];
    this.fromServer = init.fromServer ?? false;
    this.problem = init.problem;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  /** First stable code, the one the UI explains. */
  get code(): string | undefined {
    return this.codes[0];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codesOf(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  return errors
    .filter((e): e is Pick<ProblemError, 'code'> => isRecord(e) && typeof e.code === 'string')
    .map((e) => e.code);
}

/**
 * Builds an AdminApiError from a failed response. `body` is the parsed JSON body
 * (problem+json or anything else); non-problem bodies keep only the status.
 */
export function toAdminApiError(
  status: number | undefined,
  body: unknown,
  retryAfter?: string | null,
): AdminApiError {
  const httpStatus = typeof status === 'number' ? status : 0;
  const seconds = parseRetryAfter(retryAfter);
  const retry = seconds === undefined ? {} : { retryAfterSeconds: seconds };
  if (isRecord(body) && typeof body.title === 'string') {
    const problem = body as Partial<ProblemDetails>;
    const resolved = typeof problem.status === 'number' ? problem.status : httpStatus;
    return new AdminApiError({
      status: resolved,
      title: body.title,
      ...(typeof problem.detail === 'string' ? { detail: problem.detail } : {}),
      codes: codesOf(problem.errors),
      fromServer: true,
      problem: { ...(body as ProblemDetails), status: resolved },
      ...retry,
    });
  }
  return new AdminApiError({
    status: httpStatus,
    title: httpStatus === 0 ? 'Network error' : `HTTP ${httpStatus}`,
    ...retry,
  });
}

/** `Retry-After` as delay-seconds (an HTTP date is converted against now). */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{1,9}$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** i18n keys (under `problem.`) for the codes the admin UI explains to people. */
const MESSAGE_KEYS: Readonly<Record<string, string>> = {
  'oecp.invitation.expired': 'problem.invitationExpired',
  'oecp.invitation.invalid': 'problem.invitationInvalid',
  'oecp.invitation.mismatch': 'problem.invitationMismatch',
  'oecp.auth.missing_token': 'problem.signInAgain',
  'oecp.auth.invalid_token': 'problem.signInAgain',
  'oecp.auth.insufficient_acr': 'problem.insufficientAcr',
  'oecp.auth.no_role': 'problem.noRole',
  'oecp.auth.unknown_organization': 'problem.forbidden',
  'oecp.auth.idp_mismatch': 'problem.forbidden',
  'oecp.auth.forbidden_organization': 'problem.forbidden',
  'oecp.auth.forbidden_role': 'problem.forbidden',
  'oecp.request.not_found': 'problem.notFound',
  'oecp.sync.channel_disabled': 'problem.channelDisabled',
  'oecp.csv.file_too_large': 'problem.fileTooLarge',
  'oecp.csv.rate_limited': 'problem.uploadRateLimited',
  'oecp.csv.no_files': 'problem.noFiles',
  'oecp.csv.unexpected_file': 'problem.unexpectedFile',
  'oecp.integration.not_configured': 'problem.integrationNotConfigured',
  'oecp.content.duplicate_ext_id': 'problem.duplicateExtId',
  'oecp.content.ext_id_immutable': 'problem.extIdImmutable',
  'oecp.content.override_not_allowed': 'problem.overrideNotAllowed',
  'oecp.content.has_published_offerings': 'problem.hasPublishedOfferings',
  'oecp.content.published_not_deletable': 'problem.publishedNotDeletable',
  'oecp.content.harvested_not_deletable': 'problem.harvestedNotDeletable',
};

/** Translation key of the human message for an error (falls back on generic messages). */
export function problemMessageKey(error: Pick<AdminApiError, 'status' | 'codes'>): string {
  for (const code of error.codes) {
    const key = MESSAGE_KEYS[code];
    if (key) return key;
  }
  if (error.status === 0) return 'problem.network';
  if (error.status === 401) return 'problem.signInAgain';
  return 'problem.generic';
}

/** Any thrown value as an AdminApiError (unexpected failures become a network-less generic one). */
export function asAdminApiError(error: unknown): AdminApiError {
  return error instanceof AdminApiError ? error : toAdminApiError(undefined, undefined);
}
