// SPDX-License-Identifier: EUPL-1.2
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRole } from '@oecp/schemas';
import type { AdminPrincipal } from './claims.js';

/**
 * Marks the endpoints that accept a token without OACC roles: invitation
 * acceptance (spec §2.1 step 4) and the read-only `GET /me` used by its page.
 */
export const AllowRoleless = Reflector.createDecorator<void, true>({ transform: () => true });

/** Restricts a handler (or controller) to principals holding at least one of the roles. */
export const RequireRoles = Reflector.createDecorator<AdminRole[]>();

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminPrincipal =>
    ctx.switchToHttp().getRequest<{ admin: AdminPrincipal }>().admin,
);
