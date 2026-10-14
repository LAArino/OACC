// SPDX-License-Identifier: EUPL-1.2
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/config/env.js';

/** ConfigService double returning the given environment values. */
export function configStub(values: Partial<Env>): ConfigService<Env, true> {
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}
