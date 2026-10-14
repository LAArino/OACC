// SPDX-License-Identifier: EUPL-1.2
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PROBLEM_CONTENT_TYPE } from '@oecp/schemas';
import type { ProblemBody } from '../common/problem-details.filter.js';

/** OEAPI v5 `Problem`: `status` is a string (`"404"`), `title` and `detail` as RFC 9457. */
export interface OeapiProblem {
  status: string;
  title: string;
  detail?: string;
}

/**
 * Renders errors of `/oeapi/v5` as v5 `Problem` objects (`application/problem+json`),
 * the shape the v5 OpenAPI document declares for 400/404/500 responses.
 */
@Catch()
export class OeapiProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(OeapiProblemFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const response = host.switchToHttp().getResponse<unknown>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (!(exception instanceof HttpException)) this.logger.error(exception);

    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const body: ProblemBody = typeof raw === 'object' && raw !== null ? (raw as ProblemBody) : {};
    const problem: OeapiProblem = {
      status: String(status),
      title:
        body.title ??
        (exception instanceof HttpException ? exception.message : 'Internal Server Error'),
    };
    // Validation errors name the offending parameter; drop entries that only repeat the title.
    const details = [
      body.detail,
      ...(body.errors ?? []).map((e) => (e.pointer ? `${e.pointer}: ${e.message}` : e.message)),
    ]
      .filter((d): d is string => !!d && d !== problem.title)
      .join('; ');
    if (details) problem.detail = details;

    httpAdapter.setHeader(response, 'Content-Type', PROBLEM_CONTENT_TYPE);
    httpAdapter.reply(response, problem, status);
  }
}
