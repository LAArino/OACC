// SPDX-License-Identifier: EUPL-1.2
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../config/env.js';

export const AppLoggerModule = LoggerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    pinoHttp: {
      level: config.get('LOG_LEVEL', { infer: true }),
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
    },
  }),
});
