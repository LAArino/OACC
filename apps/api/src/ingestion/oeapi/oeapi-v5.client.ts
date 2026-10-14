// SPDX-License-Identifier: EUPL-1.2
import { isIP } from 'node:net';
import { type ErrorCode, type OeapiV5PageEnvelope, oeapiV5PageEnvelope } from '@oecp/schemas';
import {
  type HttpTransport,
  nodeHttpTransport,
  type Resolver,
  systemResolver,
  TransportError,
  type TransportResponse,
} from './http-transport.js';
import { isAllowedAddress } from './net-guard.js';
import { TokenBucket } from './rate-limiter.js';
import { sleep as defaultSleep } from './sleep.js';

/** Spec §6.2.6 limits. */
export const OEAPI_REQUEST_TIMEOUT_MS = 30_000;
export const OEAPI_MAX_RETRIES = 5;
export const OEAPI_MAX_BODY_BYTES = 20 * 1024 * 1024;
export const OEAPI_MAX_REDIRECTS = 3;
/** Spec §6.2.3: listings stop after 1,000 pages. */
export const OEAPI_MAX_PAGES = 1000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
const RETRY_AFTER_MAX_MS = 300_000;

export type OeapiAuth =
  | { scheme: 'none' }
  | { scheme: 'basic'; username: string; password: string }
  | { scheme: 'bearer'; token: string }
  | { scheme: 'api_key_header'; headerName: string; value: string };

export interface OeapiClientConfig {
  /** `base_url` (direct) or `SURFEDUHUB_GATEWAY_URL` (surfeduhub); may carry a path prefix. */
  baseUrl: string;
  /**
   * The only `host[:port]` requests may go to: `approved_host` (direct) or the
   * gateway host (surfeduhub). Null refuses every request.
   */
  allowedHost: string | null;
  auth: OeapiAuth;
  /** Extra request headers, e.g. `X-Route: endpoint=…` for SURFeduhub. */
  headers?: Record<string, string>;
  /** `consumer` query parameter added to every request (spec §6.2.3). */
  consumer: string;
  pageSize: number;
  maxRequestsPerSecond: number;
  /** OECP_ALLOW_INSECURE_PARTNER_HTTP: http, any port, private addresses (development only). */
  allowInsecure: boolean;
  /** Run-level cancellation (2 h limit, worker shutdown). */
  signal?: AbortSignal;
}

export interface OeapiClientDeps {
  transport?: HttpTransport;
  resolve?: Resolver;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
  timeoutMs?: number;
  maxRetries?: number;
  maxBodyBytes?: number;
  maxPages?: number;
}

/** Failure of an OEAPI request; `code` is a stable error code (spec §6.6). */
export class OeapiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status?: number,
    readonly url?: string,
    /** Transient (timeout, network): retried by the client. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'OeapiError';
  }

  /** Authentication, configuration or policy failures that no later request can overcome. */
  get fatal(): boolean {
    return [
      'oecp.oeapi.unauthorized',
      'oecp.oeapi.host_not_approved',
      'oecp.oeapi.address_refused',
      'oecp.oeapi.insecure_url',
      'oecp.oeapi.unreachable',
      'oecp.oeapi.run_timeout',
    ].includes(this.code);
  }
}

export interface OeapiJson {
  /** Final URL (after redirects), without credentials. */
  url: string;
  body: unknown;
}

export interface OeapiPage {
  url: string;
  envelope: OeapiV5PageEnvelope;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const SAFE_HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;

/**
 * OEAPI v5 HTTP client for one harvest (spec §6.2.3, §6.2.6): `Accept:
 * application/json`, `consumer` on every request, `pageNumber` paging until
 * `hasNextPage = false` (≤ 1,000 pages), 30 s per request, 5 retries with
 * exponential backoff and jitter on 429/5xx and network errors honouring
 * `Retry-After`, a token bucket at `max_requests_per_second`, bodies ≤ 20 MB, and
 * SSRF protection (https:443 only, allowlisted host, DNS resolved, checked and
 * pinned per request, redirects only within the same origin, at most 3).
 */
export class OeapiV5Client {
  private readonly base: URL;
  private readonly transport: HttpTransport;
  private readonly resolve: Resolver;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxBodyBytes: number;
  private readonly maxPages: number;
  private readonly bucket: TokenBucket;
  private readonly baseHeaders: Record<string, string>;

  constructor(
    private readonly config: OeapiClientConfig,
    deps: OeapiClientDeps = {},
  ) {
    this.base = new URL(config.baseUrl);
    this.transport = deps.transport ?? nodeHttpTransport;
    this.resolve = deps.resolve ?? systemResolver;
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
    this.timeoutMs = deps.timeoutMs ?? OEAPI_REQUEST_TIMEOUT_MS;
    this.maxRetries = deps.maxRetries ?? OEAPI_MAX_RETRIES;
    this.maxBodyBytes = deps.maxBodyBytes ?? OEAPI_MAX_BODY_BYTES;
    this.maxPages = deps.maxPages ?? OEAPI_MAX_PAGES;
    this.bucket = new TokenBucket(config.maxRequestsPerSecond, deps.now, this.sleep);
    this.baseHeaders = buildHeaders(config);
  }

  /** Human-readable target without credentials. */
  get target(): string {
    const route = this.config.headers?.['X-Route'];
    return route ? `${this.base.href} (${route})` : this.base.href;
  }

  /** GET `path` (relative to the base URL) and parse JSON. */
  async getJson(path: string, query: Record<string, string | number> = {}): Promise<OeapiJson> {
    const url = this.url(path, query);
    const response = await this.fetchWithRetries(url);
    let body: unknown;
    try {
      body = JSON.parse(response.body.toString('utf8'));
    } catch {
      throw new OeapiError(
        'oecp.oeapi.invalid_payload',
        'Response is not JSON',
        response.status,
        safeUrl(url),
      );
    }
    return { url: safeUrl(response.url), body };
  }

  /**
   * Iterates a v5 collection page by page (`pageSize` from the integration). Ends
   * when `hasNextPage` is false; throws `oecp.oeapi.page_cap_reached` after the
   * 1,000th page and `oecp.oeapi.invalid_payload` on a malformed envelope, after
   * yielding the pages already read.
   */
  async *pages(
    path: string,
    query: Record<string, string | number> = {},
  ): AsyncGenerator<OeapiPage> {
    for (let pageNumber = 1; ; pageNumber += 1) {
      if (pageNumber > this.maxPages) {
        throw new OeapiError(
          'oecp.oeapi.page_cap_reached',
          `Listing ${path} stopped after ${this.maxPages} pages`,
        );
      }
      const { url, body } = await this.getJson(path, {
        ...query,
        pageSize: this.config.pageSize,
        pageNumber,
      });
      const parsed = oeapiV5PageEnvelope.safeParse(body);
      if (!parsed.success) {
        throw new OeapiError(
          'oecp.oeapi.invalid_payload',
          `Not an OEAPI v5 page: ${parsed.error.issues[0]?.path.join('.') || 'envelope'} ${parsed.error.issues[0]?.message ?? ''}`.trim(),
          200,
          url,
        );
      }
      yield { url, envelope: parsed.data };
      if (!parsed.data.hasNextPage) return;
    }
  }

  private url(path: string, query: Record<string, string | number>): URL {
    const url = new URL(this.base.href);
    const prefix = url.pathname.replace(/\/+$/, '');
    url.pathname = `${prefix}/${path.replace(/^\/+/, '')}`;
    url.search = '';
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    url.searchParams.set('consumer', this.config.consumer);
    return url;
  }

  private async fetchWithRetries(url: URL): Promise<TransportResponse & { url: URL }> {
    for (let attempt = 0; ; attempt += 1) {
      this.checkRunSignal(url);
      let response: (TransportResponse & { url: URL }) | undefined;
      let failure: OeapiError | undefined;
      try {
        response = await this.fetchFollowingRedirects(url);
      } catch (error) {
        if (!(error instanceof OeapiError)) throw error;
        failure = error;
      }
      const retryable = response
        ? response.status === 429 || (response.status >= 500 && response.status <= 599)
        : failure?.retryable === true;
      if (response && !retryable) {
        if (response.status >= 200 && response.status < 300) return response;
        if (response.status === 401 || response.status === 403) {
          throw new OeapiError(
            'oecp.oeapi.unauthorized',
            `HTTP ${response.status} from ${safeUrl(url)}`,
            response.status,
            safeUrl(url),
          );
        }
        throw new OeapiError(
          'oecp.oeapi.http_error',
          `HTTP ${response.status} from ${safeUrl(url)}`,
          response.status,
          safeUrl(url),
        );
      }
      if (!retryable || attempt >= this.maxRetries) {
        if (failure) throw failure;
        throw new OeapiError(
          'oecp.oeapi.http_error',
          `HTTP ${response?.status} from ${safeUrl(url)} after ${attempt + 1} attempts`,
          response?.status,
          safeUrl(url),
        );
      }
      await this.sleep(this.backoff(attempt, response?.headers['retry-after']), this.config.signal);
    }
  }

  /** Exponential backoff with full jitter on its upper half; `Retry-After` wins when present. */
  private backoff(attempt: number, retryAfter: string | undefined): number {
    const fromHeader = parseRetryAfter(retryAfter);
    if (fromHeader !== undefined) return Math.min(fromHeader, RETRY_AFTER_MAX_MS);
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
    return Math.round(ceiling / 2 + this.random() * (ceiling / 2));
  }

  private async fetchFollowingRedirects(start: URL): Promise<TransportResponse & { url: URL }> {
    let url = start;
    for (let hop = 0; ; hop += 1) {
      const response = await this.send(url);
      if (!REDIRECTS.has(response.status)) return { ...response, url };
      const location = response.headers['location'];
      let next: URL | undefined;
      try {
        next = location ? new URL(location, url) : undefined;
      } catch {
        next = undefined;
      }
      if (
        !next ||
        hop >= OEAPI_MAX_REDIRECTS ||
        next.protocol !== url.protocol ||
        next.host.toLowerCase() !== url.host.toLowerCase()
      ) {
        throw new OeapiError(
          'oecp.oeapi.redirect_refused',
          `Redirect from ${safeUrl(url)} to ${next ? safeUrl(next) : 'an invalid location'} refused`,
          response.status,
          safeUrl(url),
        );
      }
      // Keep `consumer` even if the server dropped it.
      if (!next.searchParams.has('consumer')) {
        next.searchParams.set('consumer', this.config.consumer);
      }
      url = next;
    }
  }

  /** One request: URL policy, DNS pinning, rate limit, timeout. */
  private async send(url: URL): Promise<TransportResponse> {
    this.checkUrlPolicy(url);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: { address: string; family: 4 | 6 }[];
    if (isIP(hostname)) {
      addresses = [{ address: hostname, family: isIP(hostname) === 6 ? 6 : 4 }];
    } else {
      try {
        addresses = await this.resolve(hostname);
      } catch (error) {
        throw new OeapiError(
          'oecp.oeapi.unreachable',
          `DNS resolution of ${hostname} failed: ${(error as Error).message}`,
          undefined,
          safeUrl(url),
        );
      }
    }
    if (addresses.length === 0) {
      throw new OeapiError(
        'oecp.oeapi.unreachable',
        `${hostname} has no address`,
        undefined,
        safeUrl(url),
      );
    }
    // Every record must be acceptable: a mixed answer is a rebinding attempt or a misconfiguration.
    const refused = addresses.find((a) => !isAllowedAddress(a.address, this.config.allowInsecure));
    if (refused) {
      throw new OeapiError(
        'oecp.oeapi.address_refused',
        `${hostname} resolves to non-public address ${refused.address}`,
        undefined,
        safeUrl(url),
      );
    }
    const pinned = addresses[0] as { address: string; family: 4 | 6 };

    await this.bucket.acquire(this.config.signal);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = this.config.signal ? AbortSignal.any([this.config.signal, timeout]) : timeout;
    try {
      return await this.transport({
        url,
        address: pinned.address,
        family: pinned.family,
        headers: this.baseHeaders,
        signal,
        maxBodyBytes: this.maxBodyBytes,
      });
    } catch (error) {
      if (!(error instanceof TransportError)) throw error;
      switch (error.kind) {
        case 'body_too_large':
          throw new OeapiError('oecp.oeapi.body_too_large', error.message, undefined, safeUrl(url));
        case 'timeout':
          throw new OeapiError(
            'oecp.oeapi.timeout',
            `No response from ${safeUrl(url)} within ${this.timeoutMs / 1000} s`,
            undefined,
            safeUrl(url),
            true,
          );
        case 'aborted':
          this.checkRunSignal(url);
          throw new OeapiError(
            'oecp.oeapi.run_timeout',
            'Harvest aborted',
            undefined,
            safeUrl(url),
          );
        default:
          throw new OeapiError(
            'oecp.oeapi.unreachable',
            `${safeUrl(url)}: ${error.message}`,
            undefined,
            safeUrl(url),
            true,
          );
      }
    }
  }

  private checkUrlPolicy(url: URL): void {
    const insecure = this.config.allowInsecure;
    const httpsOn443 = url.protocol === 'https:' && (url.port === '' || url.port === '443');
    if (!httpsOn443 && !(insecure && (url.protocol === 'https:' || url.protocol === 'http:'))) {
      throw new OeapiError(
        'oecp.oeapi.insecure_url',
        `${safeUrl(url)} is not https on port 443`,
        undefined,
        safeUrl(url),
      );
    }
    const allowed = this.config.allowedHost?.toLowerCase();
    if (!allowed || url.host.toLowerCase() !== allowed) {
      throw new OeapiError(
        'oecp.oeapi.host_not_approved',
        allowed
          ? `Host ${url.host} is not the approved host ${allowed}`
          : `Host ${url.host} has not been approved by an alliance_admin`,
        undefined,
        safeUrl(url),
      );
    }
  }

  private checkRunSignal(url: URL): void {
    if (this.config.signal?.aborted) {
      throw new OeapiError('oecp.oeapi.run_timeout', 'Harvest aborted', undefined, safeUrl(url));
    }
  }
}

function buildHeaders(config: OeapiClientConfig): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': 'OECP-harvester/1 (+https://joinup.ec.europa.eu/licence/eupl)',
  };
  for (const [name, value] of Object.entries(config.headers ?? {})) headers[name] = value;
  const auth = config.auth;
  switch (auth.scheme) {
    case 'basic':
      headers['authorization'] =
        `Basic ${Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')}`;
      break;
    case 'bearer':
      headers['authorization'] = `Bearer ${auth.token}`;
      break;
    case 'api_key_header':
      headers[auth.headerName] = auth.value;
      break;
    default:
      break;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (!SAFE_HEADER_VALUE.test(value)) {
      throw new OeapiError(
        'oecp.oeapi.secret_unavailable',
        `Header ${name} has invalid characters`,
      );
    }
  }
  return headers;
}

/** `Retry-After` as delay-seconds or HTTP-date, in ms. */
export function parseRetryAfter(value: string | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** URL without userinfo, for messages and logs. */
function safeUrl(url: URL | string): string {
  const copy = new URL(String(url));
  copy.username = '';
  copy.password = '';
  return copy.href;
}
