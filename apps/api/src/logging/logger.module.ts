// SPDX-License-Identifier: EUPL-1.2
import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../config/env.js';

/** Request members written to the log; never headers, query values of tokens or bodies. */
export interface LoggedRequest {
  id: unknown;
  method: string | undefined;
  url: string | undefined;
}

type RawRequest = IncomingMessage & {
  id?: unknown;
  originalUrl?: string;
  admin?: { sub?: string };
};

/**
 * Request serializer (spec §10, GDPR minimisation): method, URL and request id
 * only. No headers (so no `Authorization`, `Cookie`, `User-Agent`,
 * `X-Forwarded-For`, `X-Real-IP`), no client address, no port.
 */
export function serializeRequest(req: RawRequest): LoggedRequest {
  return { id: req.id, method: req.method, url: req.originalUrl ?? req.url };
}

/** Response serializer: the status code only (no headers). */
export function serializeResponse(res: ServerResponse | { statusCode?: number }) {
  return { statusCode: res.statusCode };
}

/**
 * Pseudonymous client address: SHA-256 of a per-process random salt and the
 * client address (first `X-Forwarded-For` entry set by Traefik, else the socket
 * address), hex, first 16 characters. The raw address is never logged; the salt
 * lives only in memory, so hashes cannot be linked across restarts or replicas.
 */
export function clientAddressHash(req: IncomingMessage, salt: Buffer): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  const address = first || req.socket?.remoteAddress;
  if (!address) return null;
  return createHash('sha256').update(salt).update(address).digest('hex').slice(0, 16);
}

/**
 * Extra members of the request log line: the JWT `sub` of authenticated admin
 * requests (set by AdminJwtGuard) and, only with `OECP_LOG_CLIENT_ADDRESSES=true`,
 * the hashed client address. Public (anonymous) requests carry neither by default.
 */
export function customProps(
  logClientAddresses: boolean,
  salt: Buffer = randomBytes(32),
): (req: IncomingMessage) => Record<string, string> {
  return (req) => {
    const props: Record<string, string> = {};
    const sub = (req as RawRequest).admin?.sub;
    if (sub) props['sub'] = sub;
    if (logClientAddresses) {
      const client = clientAddressHash(req, salt);
      if (client) props['client'] = client;
    }
    return props;
  };
}

export const AppLoggerModule = LoggerModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    pinoHttp: {
      level: config.get('LOG_LEVEL', { infer: true }),
      serializers: { req: serializeRequest, res: serializeResponse },
      customProps: customProps(config.get('OECP_LOG_CLIENT_ADDRESSES', { infer: true })),
      // Defence in depth, should headers ever be logged by other code.
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-forwarded-for"]',
        'req.headers["x-real-ip"]',
        'req.headers["user-agent"]',
      ],
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
    },
  }),
});
