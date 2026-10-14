// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { type Db, KYSELY } from '../../db/db.module.js';

/** At most one `admin_activity` write per administrator and hour. */
export const ACTIVITY_THROTTLE_MS = 60 * 60 * 1000;
/** Above this many remembered administrators, expired throttle entries are pruned. */
const MAX_TRACKED = 10_000;

export const ADMIN_ACTIVITY_CLOCK = Symbol('ADMIN_ACTIVITY_CLOCK');

/**
 * Records when an administrator last used the admin API (`admin_activity`,
 * migration 0006), read by the dormancy job (spec §2.2). Called by
 * AdminJwtGuard after every successful authentication; an in-memory throttle
 * keeps it to one upsert per `sub` and hour per API process, and the upsert
 * itself skips rows written less than an hour ago (several API replicas). Only
 * `sub`, organization and time are stored: no IP address, no user agent.
 */
@Injectable()
export class AdminActivityRecorder {
  private readonly logger = new Logger(AdminActivityRecorder.name);
  private readonly lastWrite = new Map<string, number>();
  private readonly now: () => Date;

  constructor(
    @Inject(KYSELY) private readonly db: Db,
    @Optional() @Inject(ADMIN_ACTIVITY_CLOCK) clock?: () => Date,
  ) {
    this.now = clock ?? (() => new Date());
  }

  /**
   * Resolves `true` when a write was attempted, `false` when throttled. Never
   * rejects: a failed write is logged and retried on the next request.
   */
  async record(sub: string, organizationId: string | null): Promise<boolean> {
    const now = this.now();
    const previous = this.lastWrite.get(sub);
    if (previous !== undefined && now.getTime() - previous < ACTIVITY_THROTTLE_MS) return false;
    this.lastWrite.set(sub, now.getTime());
    this.prune(now.getTime());
    try {
      await this.db
        .insertInto('admin_activity')
        .values({ sub, organization_id: organizationId, last_seen_at: now })
        .onConflict((oc) =>
          oc
            .column('sub')
            .doUpdateSet({
              last_seen_at: sql`greatest(admin_activity.last_seen_at, excluded.last_seen_at)`,
              organization_id: (eb) => eb.ref('excluded.organization_id'),
              updated_at: sql`now()`,
            })
            .where((eb) =>
              eb.or([
                eb(
                  'admin_activity.last_seen_at',
                  '<=',
                  sql<Date>`excluded.last_seen_at - make_interval(secs => ${ACTIVITY_THROTTLE_MS / 1000})`,
                ),
                eb(
                  'admin_activity.organization_id',
                  'is distinct from',
                  eb.ref('excluded.organization_id'),
                ),
              ]),
            ),
        )
        .execute();
    } catch (error) {
      this.lastWrite.delete(sub);
      this.logger.warn(`Admin activity of ${sub} not recorded: ${(error as Error).message}`);
    }
    return true;
  }

  private prune(now: number): void {
    if (this.lastWrite.size <= MAX_TRACKED) return;
    for (const [sub, at] of this.lastWrite) {
      if (now - at >= ACTIVITY_THROTTLE_MS) this.lastWrite.delete(sub);
    }
  }
}
