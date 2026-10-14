// SPDX-License-Identifier: EUPL-1.2
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES } from '@oecp/schemas';
import type { ProblemBody } from '../../common/problem-details.filter.js';
import { AdminAuthError } from './admin-auth.error.js';
import { AdminTokenVerifier } from './admin-token-verifier.js';
import { type AdminPrincipal, LOCAL_IDP, REQUIRED_ACR } from './claims.js';
import { AllowRoleless } from './decorators.js';
import { ORGANIZATION_DIRECTORY, type OrganizationDirectory } from './organization-directory.js';

interface GuardedRequest {
  headers: Record<string, string | string[] | undefined>;
  admin?: AdminPrincipal;
}

interface GuardedResponse {
  setHeader(name: string, value: string): unknown;
}

/**
 * Bearer-only guard for `/api/admin` (spec §4): signature via realm JWKS, `iss`,
 * `aud ∋ oecp-api`, `azp = oecp-admin`, `acr = mfa`, non-empty OECP roles, and an
 * existing organization whose IdP alias (or `local`) equals the `idp` claim.
 */
@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(
    private readonly verifier: AdminTokenVerifier,
    @Inject(ORGANIZATION_DIRECTORY) private readonly organizations: OrganizationDirectory,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<GuardedRequest>();
    try {
      request.admin = await this.authenticate(request, context);
      return true;
    } catch (error) {
      if (!(error instanceof AdminAuthError)) throw error;
      const body: ProblemBody = { title: ERROR_CODES[error.code].message };
      body.errors = [
        { code: error.code, severity: 'error', message: ERROR_CODES[error.code].message },
      ];
      if (error.status === 403) throw new ForbiddenException(body);
      http.getResponse<GuardedResponse>().setHeader('WWW-Authenticate', challenge(error.code));
      throw new UnauthorizedException(body);
    }
  }

  private async authenticate(
    request: GuardedRequest,
    context: ExecutionContext,
  ): Promise<AdminPrincipal> {
    const token = bearerToken(request.headers['authorization']);
    const claims = await this.verifier.verify(token);
    const allowRoleless =
      this.reflector.getAllAndOverride(AllowRoleless, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    if (claims.roles.length === 0) {
      if (!allowRoleless) throw new AdminAuthError('oecp.auth.no_role', 403);
    } else {
      if (!claims.org_id) throw new AdminAuthError('oecp.auth.unknown_organization', 403);
      const organization = await this.organizations.findActive(claims.org_id);
      if (!organization) throw new AdminAuthError('oecp.auth.unknown_organization', 403);
      if ((organization.keycloak_idp_alias ?? LOCAL_IDP) !== claims.idp) {
        throw new AdminAuthError('oecp.auth.idp_mismatch', 403);
      }
    }

    return {
      sub: claims.sub,
      roles: claims.roles,
      orgId: claims.org_id,
      idp: claims.idp,
      email: claims.email,
      name: claims.name,
    };
  }
}

function bearerToken(header: string | string[] | undefined): string {
  const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header) : null;
  if (!match?.[1]) throw new AdminAuthError('oecp.auth.missing_token', 401);
  return match[1];
}

function challenge(code: string): string {
  if (code === 'oecp.auth.insufficient_acr') {
    // RFC 9470 step-up challenge.
    return `Bearer error="insufficient_user_authentication", acr_values="${REQUIRED_ACR}"`;
  }
  if (code === 'oecp.auth.missing_token') return 'Bearer';
  return 'Bearer error="invalid_token"';
}
