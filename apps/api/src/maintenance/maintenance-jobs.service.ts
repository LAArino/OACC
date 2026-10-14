// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable } from '@nestjs/common';
import type { MaintenanceJobRunResponse, MaintenanceRun, MaintenanceRunList } from '@oecp/schemas';
import type { AdminPrincipal } from '../admin/auth/claims.js';
import { ProblemException } from '../common/problem.js';
import { type Db, KYSELY } from '../db/db.module.js';
import { manualJobId, ON_DEMAND_JOBS } from './maintenance.constants.js';
import {
  type MaintenanceRunRow,
  MaintenanceRunsRepository,
} from './maintenance-runs.repository.js';
import { MaintenanceQueue } from './maintenance.queue.js';

const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

export function toMaintenanceRun(row: MaintenanceRunRow): MaintenanceRun {
  const started = new Date(row.started_at);
  const finished = row.finished_at === null ? null : new Date(row.finished_at);
  return {
    id: row.id,
    job: row.job,
    trigger_kind: row.trigger_kind,
    triggered_by: row.triggered_by,
    status: row.status,
    started_at: started.toISOString(),
    finished_at: iso(finished),
    duration_ms: finished ? Math.max(0, finished.getTime() - started.getTime()) : null,
    counters: row.counters,
    details: row.details,
    error: row.error,
  };
}

/** Admin API side of the maintenance jobs (alliance_admin). */
@Injectable()
export class MaintenanceJobsService {
  constructor(
    @Inject(KYSELY) private readonly db: Db,
    private readonly runs: MaintenanceRunsRepository,
    private readonly queue: MaintenanceQueue,
  ) {}

  async listRuns(limit: number, job?: string): Promise<MaintenanceRunList> {
    return { items: (await this.runs.list(limit, job)).map(toMaintenanceRun) };
  }

  /**
   * Enqueues an on-demand run (job id `manual-{name}`: at most one waiting or
   * running per job). Unknown names are 404. Audited as `maintenance.run_requested`.
   */
  async requestRun(name: string, admin: AdminPrincipal): Promise<MaintenanceJobRunResponse> {
    if (!ON_DEMAND_JOBS.includes(name)) {
      throw new ProblemException(404, 'oecp.request.not_found', `No maintenance job "${name}"`);
    }
    const status = await this.queue.request(
      name,
      { trigger: 'manual', triggeredBy: admin.sub },
      manualJobId(name),
    );
    await this.db
      .insertInto('audit_log')
      .values({
        actor_sub: admin.sub,
        actor_org_id: admin.orgId ?? null,
        action: 'maintenance.run_requested',
        entity_type: 'maintenance_job',
        entity_id: null,
        changes: { job: name, status },
      })
      .execute();
    return { job: name, status };
  }
}
