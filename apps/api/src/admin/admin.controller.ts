// SPDX-License-Identifier: EUPL-1.2
import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotImplementedException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminJwtGuard } from './auth/admin-jwt.guard.js';
import type { AdminPrincipal } from './auth/claims.js';
import { AllowRoleless, CurrentAdmin } from './auth/decorators.js';

/** 256-bit random token, base64url without padding. */
const acceptInvitationBody = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

@Controller('api/admin/v1')
@UseGuards(AdminJwtGuard)
export class AdminController {
  /** The authenticated administrator as seen by the API. */
  @Get('me')
  me(@CurrentAdmin() admin: AdminPrincipal): AdminPrincipal {
    return admin;
  }

  /** The only endpoint accepting a role-less token (spec §2.1 step 4). */
  @Post('invitations/accept')
  @AllowRoleless()
  @HttpCode(204)
  acceptInvitation(
    @CurrentAdmin() _admin: AdminPrincipal,
    @Body(new ZodValidationPipe(acceptInvitationBody)) _body: z.infer<typeof acceptInvitationBody>,
  ): never {
    throw new NotImplementedException();
  }
}
