// SPDX-License-Identifier: EUPL-1.2
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
app.set('trust proxy', 1); // Traefik terminates TLS and sets X-Forwarded-*.
app.disable('x-powered-by');
// Course texts in several languages exceed the 100 kB default (spec §6.4 form saves).
app.useBodyParser('json', { limit: '1mb' });

const config = app.get<ConfigService<Env, true>>(ConfigService);
await app.listen(config.get('PORT', { infer: true }));
