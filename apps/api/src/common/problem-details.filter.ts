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
import { PROBLEM_CONTENT_TYPE, type ProblemDetails, type ProblemError } from '@oecp/schemas';

/** Exception response body that carries RFC 9457 extension members. */
export interface ProblemBody {
  type?: string;
  title?: string;
  detail?: string;
  errors?: ProblemError[];
}

/** Renders every error as RFC 9457 `application/problem+json` (spec §6.6). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<unknown>();
    const response = ctx.getResponse<unknown>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (!(exception instanceof HttpException)) this.logger.error(exception);

    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const body: ProblemBody = typeof raw === 'object' && raw !== null ? (raw as ProblemBody) : {};
    const problem: ProblemDetails = {
      type: body.type ?? 'about:blank',
      title:
        body.title ??
        (exception instanceof HttpException ? exception.message : 'Internal Server Error'),
      status,
      instance: httpAdapter.getRequestUrl(request),
    };
    if (body.detail) problem.detail = body.detail;
    if (body.errors?.length) problem.errors = body.errors;

    httpAdapter.setHeader(response, 'Content-Type', PROBLEM_CONTENT_TYPE);
    httpAdapter.reply(response, problem, status);
  }
}
