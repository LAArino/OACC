// SPDX-License-Identifier: EUPL-1.2
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { type Observable, tap } from 'rxjs';

/**
 * Sets `Cache-Control` on successful responses only, so errors (404 of a course
 * published a minute later, 5xx) are never cached by shared caches. `@Header()`
 * would apply to error responses too.
 */
export class CacheControlInterceptor implements NestInterceptor {
  constructor(private readonly value: string) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context
      .switchToHttp()
      .getResponse<{ setHeader(name: string, value: string): unknown }>();
    return next.handle().pipe(tap(() => response.setHeader('Cache-Control', this.value)));
  }
}
