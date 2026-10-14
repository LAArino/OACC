// SPDX-License-Identifier: EUPL-1.2
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.js';

export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  cache: true,
  validate: validateEnv,
});
