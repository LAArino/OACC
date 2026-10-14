// SPDX-License-Identifier: EUPL-1.2
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AdminMe } from '@oecp/schemas';
import { AdminJwtGuard } from './auth/admin-jwt.guard.js';
import type { AdminPrincipal } from './auth/claims.js';
import { AllowRoleless, CurrentAdmin } from './auth/decorators.js';

@Controller('api/admin/v1')
@UseGuards(AdminJwtGuard)
export class AdminController {
  /**
   * The signed-in administrator as seen by the API. Role-less tokens are allowed
   * so that the invitation acceptance page can show who is signed in.
   */
  @Get('me')
  @AllowRoleless()
  me(@CurrentAdmin() admin: AdminPrincipal): AdminMe {
    return {
      sub: admin.sub,
      email: admin.email ?? null,
      name: admin.name ?? null,
      roles: admin.roles,
      org_id: admin.orgId ?? null,
      idp: admin.idp,
    };
  }
}
