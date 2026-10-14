// SPDX-License-Identifier: EUPL-1.2
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { NetworkStatus } from '@oecp/schemas';
import { AdminJwtGuard } from '../auth/admin-jwt.guard.js';
import { RequireRoles } from '../auth/decorators.js';
import { NetworkStatusService } from './network-status.service.js';

/** Network status of every organization (spec §8 "Network status"), alliance_admin only. */
@Controller('api/admin/v1')
@UseGuards(AdminJwtGuard)
@RequireRoles(['alliance_admin'])
export class NetworkStatusController {
  constructor(private readonly network: NetworkStatusService) {}

  @Get('network-status')
  status(): Promise<NetworkStatus> {
    return this.network.status();
  }
}
