// SPDX-License-Identifier: EUPL-1.2
import { HttpException } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@oecp/schemas';
import type { ProblemBody } from './problem-details.filter.js';

/** Problem body with one stable error code (spec §6.6). */
export function problemBody(
  code: ErrorCode,
  detail?: string,
  extensions?: Record<string, unknown>,
): ProblemBody {
  const { message, severity } = ERROR_CODES[code];
  const body: ProblemBody = { title: message, errors: [{ code, severity, message }] };
  if (detail) body.detail = detail;
  if (extensions) body.extensions = extensions;
  return body;
}

/** HttpException rendered by ProblemDetailsFilter as `application/problem+json`. */
export class ProblemException extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    detail?: string,
    /** RFC 9457 extension members (e.g. `reason`), rendered at the top level. */
    extensions?: Record<string, unknown>,
  ) {
    super(problemBody(code, detail, extensions), status);
    this.message = detail ?? ERROR_CODES[code].message;
  }
}
