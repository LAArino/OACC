// SPDX-License-Identifier: EUPL-1.2
/** RFC 9457 `application/problem+json` shape used by admin and ingestion errors (spec §6.6). */
import { z } from 'zod';
import { ERROR_CODES, type ErrorCode, isErrorCode } from './error-codes.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export const problemError = z.object({
  code: z.string().regex(/^oecp(\.[a-z0-9_]+)+$/),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  file: z.enum(['courses', 'offerings']).optional(),
  /** 1-based CSV row; the header is row 1. */
  row: z.int().positive().optional(),
  column: z.string().optional(),
  /** RFC 6901 JSON Pointer into the submitted or harvested document. */
  pointer: z.string().optional(),
  ext_id: z.string().optional(),
});
export type ProblemError = z.infer<typeof problemError>;

export const problemDetails = z.looseObject({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(problemError).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetails>;

function toPointer(path: readonly PropertyKey[]): string {
  return path.map((p) => '/' + String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

/**
 * Converts Zod issues to problem errors. Issue messages that are stable codes are
 * used as codes; anything else falls back to `fallback`.
 */
export function issuesToProblemErrors(
  issues: readonly z.core.$ZodIssue[],
  options: { fallback?: ErrorCode; file?: 'courses' | 'offerings'; row?: number } = {},
): ProblemError[] {
  const fallback = options.fallback ?? 'oecp.content.invalid_value';
  return issues.flatMap((issue) => {
    const known = isErrorCode(issue.message);
    const code = known ? issue.message : fallback;
    const message = known ? ERROR_CODES[code].message : issue.message;
    const paths =
      issue.code === 'unrecognized_keys' ? issue.keys.map((k) => [...issue.path, k]) : [issue.path];
    return paths.map((path) => {
      const error: ProblemError = { code, severity: 'error', message };
      if (options.file) {
        error.file = options.file;
        if (options.row !== undefined) error.row = options.row;
        if (path.length > 0) error.column = String(path[0]);
      } else if (path.length > 0) {
        error.pointer = toPointer(path);
      }
      return error;
    });
  });
}
