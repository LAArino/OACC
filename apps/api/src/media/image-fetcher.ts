// SPDX-License-Identifier: EUPL-1.2
import { isIP } from 'node:net';
import { COURSE_IMAGE_MAX_BYTES } from '@oecp/schemas';
import {
  type HttpTransport,
  nodeHttpTransport,
  type Resolver,
  type ResolvedAddress,
  systemResolver,
  TransportError,
} from '../ingestion/oeapi/http-transport.js';
import { classifyAddress, isAllowedAddress } from '../ingestion/oeapi/net-guard.js';
import { MEDIA_FETCH_MAX_REDIRECTS, MEDIA_FETCH_TIMEOUT_MS } from './media.constants.js';

/** Why a fetch of a CSV `image_url` failed; the message goes into the sync error. */
export class ImageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageFetchError';
  }
}

export interface ImageFetcherOptions {
  transport?: HttpTransport;
  resolve?: Resolver;
  /**
   * `OECP_ALLOW_INSECURE_PARTNER_HTTP` (development only): also admits loopback,
   * private, CGNAT and ULA addresses, as for the harvester. HTTPS stays required.
   */
  allowInsecure?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const HEADERS = {
  accept: 'image/webp, image/png, image/jpeg',
  'user-agent': 'OECP-media-fetch/1 (+course image of a CSV upload)',
};

/** `https://host/path` without query string (it may carry tokens) for messages. */
function display(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

/**
 * The URL rules of an image fetch: `https:` only, port 443, no credentials in
 * the URL. Applied to the CSV URL and to every redirect target.
 */
function checkUrl(url: URL): void {
  if (url.protocol !== 'https:') {
    throw new ImageFetchError(`Only https URLs are fetched, not ${url.protocol}//`);
  }
  if (url.port !== '' && url.port !== '443') {
    throw new ImageFetchError(`Port ${url.port} refused (443 only)`);
  }
  if (url.username || url.password) {
    throw new ImageFetchError('URLs with credentials are refused');
  }
}

/**
 * Fetches the image of a CSV `image_url` (decision 27) with the harvester's
 * outbound rules (spec §6.2.6, `net-guard.ts`): HTTPS on port 443 only; the host
 * is resolved first and every address must be public unicast (loopback, private,
 * CGNAT, ULA, link-local, multicast and reserved ranges refused); the connection
 * is pinned to the checked address (no second DNS answer can steer it: DNS
 * rebinding); at most 3 redirects, each to an https URL that passes the same
 * checks; 20 s for the whole fetch; at most 5 MiB (declared or streamed). The
 * content type is not trusted: the caller sniffs the bytes.
 */
export async function fetchImage(raw: string, options: ImageFetcherOptions = {}): Promise<Buffer> {
  const transport = options.transport ?? nodeHttpTransport;
  const resolve = options.resolve ?? systemResolver;
  const maxBytes = options.maxBytes ?? COURSE_IMAGE_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? MEDIA_FETCH_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageFetchError('Invalid URL');
  }
  for (let hop = 0; ; hop += 1) {
    checkUrl(url);
    const address = await pinnedAddress(url, resolve, options.allowInsecure ?? false);
    let response;
    try {
      response = await transport({
        url,
        address: address.address,
        family: address.family,
        headers: HEADERS,
        signal,
        maxBodyBytes: maxBytes,
      });
    } catch (error) {
      if (!(error instanceof TransportError)) throw error;
      switch (error.kind) {
        case 'body_too_large':
          throw new ImageFetchError(`${display(url)}: larger than ${maxBytes} bytes`);
        case 'timeout':
        case 'aborted':
          throw new ImageFetchError(
            `${display(url)}: no complete answer within ${timeoutMs / 1000} s`,
          );
        default:
          throw new ImageFetchError(`${display(url)}: ${error.message}`);
      }
    }
    if (REDIRECTS.has(response.status)) {
      const location = response.headers['location'];
      let next: URL | undefined;
      try {
        next = location ? new URL(location, url) : undefined;
      } catch {
        next = undefined;
      }
      if (!next) throw new ImageFetchError(`${display(url)}: redirect without a valid location`);
      if (hop >= MEDIA_FETCH_MAX_REDIRECTS) {
        throw new ImageFetchError(
          `${display(url)}: more than ${MEDIA_FETCH_MAX_REDIRECTS} redirects`,
        );
      }
      if (next.protocol !== 'https:') {
        throw new ImageFetchError(`${display(url)}: redirect to a non-https URL refused`);
      }
      url = next;
      continue;
    }
    if (response.status !== 200) {
      throw new ImageFetchError(`${display(url)}: HTTP ${response.status}`);
    }
    if (response.body.length === 0) throw new ImageFetchError(`${display(url)}: empty body`);
    return response.body;
  }
}

/** Resolves the host and checks every address; the first one is used. */
async function pinnedAddress(
  url: URL,
  resolve: Resolver,
  allowInsecure: boolean,
): Promise<ResolvedAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: ResolvedAddress[];
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await resolve(hostname);
    } catch (error) {
      throw new ImageFetchError(
        `DNS resolution of ${hostname} failed: ${(error as Error).message}`,
      );
    }
  }
  if (addresses.length === 0) throw new ImageFetchError(`${hostname} has no address`);
  // Every record must be acceptable: a mixed answer is a rebinding attempt or a misconfiguration.
  const refused = addresses.find((a) => !isAllowedAddress(a.address, allowInsecure));
  if (refused) {
    throw new ImageFetchError(
      `${hostname} resolves to a ${classifyAddress(refused.address).replace('_', '-')} address; refused`,
    );
  }
  return addresses[0] as ResolvedAddress;
}
