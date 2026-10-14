// SPDX-License-Identifier: EUPL-1.2
import type { ErrorCode } from '@oecp/schemas';

export class AdminAuthError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: 401 | 403,
  ) {
    super(code);
    this.name = 'AdminAuthError';
  }
}
