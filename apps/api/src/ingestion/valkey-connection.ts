// SPDX-License-Identifier: EUPL-1.2
import type { ConnectionOptions } from 'bullmq';

/** Translates `VALKEY_URL` (redis[s]:// or valkey[s]://) into ioredis options for BullMQ. */
export function valkeyConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  const tls = u.protocol === 'rediss:' || u.protocol === 'valkeys:';
  const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    db: Number.isInteger(db) ? db : 0,
    ...(tls ? { tls: {} } : {}),
    // Required by BullMQ workers; harmless for producers.
    maxRetriesPerRequest: null,
  };
}
