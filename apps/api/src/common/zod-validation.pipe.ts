// SPDX-License-Identifier: EUPL-1.2
import {
  BadRequestException,
  type PipeTransform,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type ErrorCode, issuesToProblemErrors } from '@oecp/schemas';
import type { z } from 'zod';
import type { ProblemBody } from './problem-details.filter.js';

export interface ZodValidationOptions {
  /**
   * Content-rule codes (e.g. `CONTENT_RULE_CODES` of `@oecp/schemas`): when every
   * error has one of them, the body is well formed but breaks content rules and
   * the answer is 422 instead of 400 (spec §6.6: request shape 400, content 422).
   */
  contentRules?: readonly ErrorCode[];
}

/**
 * Validates and transforms a request part with a Zod schema; failures become
 * problem+json 400s (422 for content rules, see {@link ZodValidationOptions}).
 */
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(
    private readonly schema: T,
    private readonly options: ZodValidationOptions = {},
  ) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const errors = issuesToProblemErrors(result.error.issues, {
      fallback: 'oecp.request.validation_failed',
    });
    const rules = this.options.contentRules;
    const content =
      rules !== undefined &&
      errors.length > 0 &&
      errors.every((e) => (rules as readonly string[]).includes(e.code));
    const body: ProblemBody = {
      type: '/problems/validation-failed',
      title: content ? 'Validation failed' : 'Request validation failed',
      errors,
    };
    throw content ? new UnprocessableEntityException(body) : new BadRequestException(body);
  }
}
