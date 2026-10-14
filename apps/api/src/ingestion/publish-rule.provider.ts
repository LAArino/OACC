// SPDX-License-Identifier: EUPL-1.2
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PublishRuleMode } from '@oecp/schemas';
import type { Env } from '../config/env.js';
import { PUBLISH_RULE } from './canonical-writer.service.js';

/** `OECP_PUBLISH_RULE` for {@link PUBLISH_RULE} (decision 21c; default `warn`). */
export const publishRuleProvider: Provider = {
  provide: PUBLISH_RULE,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): PublishRuleMode =>
    config.get('OECP_PUBLISH_RULE', { infer: true }) ?? 'warn',
};
