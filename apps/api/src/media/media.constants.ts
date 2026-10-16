// SPDX-License-Identifier: EUPL-1.2

/** Queue of the CSV `image_url` fetches (decision 27); processed by the worker. */
export const MEDIA_QUEUE = 'media';
export const MEDIA_FETCH_JOB = 'media-fetch';
/** Per-request timeout of an image fetch (each redirect hop included in the total). */
export const MEDIA_FETCH_TIMEOUT_MS = 20_000;
/** Redirects followed by an image fetch, HTTPS to HTTPS only. */
export const MEDIA_FETCH_MAX_REDIRECTS = 3;
/** Wall-clock budget of one image decode and re-encode (sharp). */
export const MEDIA_PROCESS_TIMEOUT_SECONDS = 20;
/** `audit_log.actor_sub` of images fetched for a CSV upload. */
export const MEDIA_CSV_ACTOR = 'system:csv';

/** BullMQ refuses ':' in custom ids. One fetch per course and upload. */
export const mediaFetchJobId = (syncRunId: string, courseId: string): string =>
  `media-${syncRunId}-${courseId}`;
