// SPDX-License-Identifier: EUPL-1.2
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminPrincipal } from './claims.js';

/** Marks the single endpoint that accepts a token without OECP roles (invitation acceptance). */
export const AllowRoleless = Reflector.createDecorator<void, true>({ transform: () => true });

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminPrincipal =>
    ctx.switchToHttp().getRequest<{ admin: AdminPrincipal }>().admin,
);
