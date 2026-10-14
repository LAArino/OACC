// SPDX-License-Identifier: EUPL-1.2
/** Query contracts of the anonymous APIs (spec §7 and §9). */
import { z } from 'zod';
import { deliveryModeCode, primaryLanguage, slug } from './primitives.js';

const list = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(item).max(50));

/** `GET /api/public/v1/courses` */
export const courseSearchQuery = z.object({
  q: z.string().trim().max(200).optional(),
  partner: list(slug),
  mode: list(deliveryModeCode),
  ectsMin: z.coerce.number().positive().max(120).optional(),
  ectsMax: z.coerce.number().positive().max(120).optional(),
  lang: list(primaryLanguage),
  isced: list(z.string().regex(/^\d{2}$/)),
  sort: z.enum(['relevance', 'title', 'start_date']).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  includeUnscheduled: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type CourseSearchQuery = z.infer<typeof courseSearchQuery>;

/** `GET /api/public/v1/suggest` */
export const suggestQuery = z.object({ q: z.string().trim().min(2).max(100) });

/** OEAPI v5 paging; `pageSize` is capped at 250 (spec §9). */
export const oeapiPagingQuery = z.object({
  pageSize: z.coerce.number().int().min(1).max(250).default(10),
  pageNumber: z.coerce.number().int().min(1).default(1),
});
export type OeapiPagingQuery = z.infer<typeof oeapiPagingQuery>;
