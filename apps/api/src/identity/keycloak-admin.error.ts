// SPDX-License-Identifier: EUPL-1.2
import { ProblemException } from '../common/problem.js';

/**
 * Failure of a Keycloak Admin API call, rendered as problem+json:
 * 504 on timeout, 409 on an upstream conflict, 502 otherwise.
 * The detail names the operation and upstream status only, never tokens or secrets.
 */
export class KeycloakAdminError extends ProblemException {
  constructor(
    readonly operation: string,
    /** Upstream HTTP status, or undefined for network errors and timeouts. */
    readonly upstreamStatus: number | undefined,
    readonly timedOut = false,
  ) {
    const status = timedOut ? 504 : upstreamStatus === 409 ? 409 : 502;
    const detail = timedOut
      ? `Keycloak Admin API timed out (${operation})`
      : upstreamStatus === undefined
        ? `Keycloak Admin API unreachable (${operation})`
        : `Keycloak Admin API returned ${upstreamStatus} (${operation})`;
    super(
      status,
      upstreamStatus === 409 ? 'oecp.identity.conflict' : 'oecp.identity.unavailable',
      detail,
    );
    this.name = 'KeycloakAdminError';
  }
}
