// SPDX-License-Identifier: EUPL-1.2
import { z } from 'zod';

/** Channel B queue: upload processing jobs and the daily retention job. */
export const CSV_QUEUE = 'csv';
export const CSV_PROCESS_JOB = 'csv-process';
export const CSV_RETENTION_JOB = 'csv-retention';
/** Job scheduler id of the daily purge of uploads older than 90 days. */
export const CSV_RETENTION_SCHEDULER_ID = 'csv-retention-daily';
export const CSV_RETENTION_CRON = '30 4 * * *';

/** Uploads with at most this many data rows (both files) are processed in the request. */
export const CSV_INLINE_MAX_ROWS = 500;
/** Spec §10: uploads are kept 90 days. */
export const UPLOAD_RETENTION_DAYS = 90;
/** `audit_log.actor_sub` of system-driven upload bookkeeping. */
export const CSV_SYSTEM_ACTOR = 'system:csv';

export const csvJobData = z.object({ syncRunId: z.uuid() });
export type CsvJobData = z.infer<typeof csvJobData>;

/** BullMQ refuses ':' in custom ids. One job per upload. */
export const csvJobId = (syncRunId: string): string => `csv-${syncRunId}`;
