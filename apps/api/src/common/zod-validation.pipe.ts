// SPDX-License-Identifier: EUPL-1.2
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { issuesToProblemErrors } from '@oecp/schemas';
import type { z } from 'zod';
import type { ProblemBody } from './problem-details.filter.js';

/** Validates and transforms a request part with a Zod schema; failures become problem+json 400s. */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const body: ProblemBody = {
      type: '/problems/validation-failed',
      title: 'Request validation failed',
      errors: issuesToProblemErrors(result.error.issues, {
        fallback: 'oecp.request.validation_failed',
      }),
    };
    throw new BadRequestException(body);
  }
}
