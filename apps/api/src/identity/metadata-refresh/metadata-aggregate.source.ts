// SPDX-License-Identifier: EUPL-1.2
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  AGGREGATE_FETCH_TIMEOUT_MS,
  AGGREGATE_MAX_STALENESS_MS,
} from './idp-metadata-refresh.constants.js';
import type { IdpMetadataSettings } from './idp-metadata-refresh.settings.js';
import {
  loadPinnedCertificate,
  type PinnedCertificate,
  verifyMetadataSignature,
} from './metadata-signature.js';
import { type AggregateScan, MetadataFormatError, scanAggregate } from './saml-metadata.js';

export type AggregateSourceKind = 'url' | 'cache' | 'file';

/** A verified (or, for `--no-verify` local files, merely parsed) aggregate. */
export interface LoadedAggregate {
  kind: AggregateSourceKind;
  /** URL, cache path or local path. */
  location: string;
  verified: boolean;
  /** When the bytes were downloaded (url, cache). */
  fetchedAt: Date | undefined;
  scan: AggregateScan;
  warnings: string[];
}

export interface LoadOptions {
  /** Entity IDs to extract. */
  wanted: ReadonlySet<string>;
  now: Date;
}

/** The aggregate could not be obtained and no usable cached copy exists: fail loudly. */
export class MetadataUnavailableError extends Error {
  override readonly name = 'MetadataUnavailableError';
}

interface CacheMeta {
  url: string;
  fetchedAt: string;
  sha256: string;
  bytes: number;
  validUntil: string | null;
}

const AGGREGATE_FILE = 'aggregate.xml';
const META_FILE = 'aggregate.json';

/**
 * Obtains the federation aggregate: HTTPS download (size-limited, 60 s timeout,
 * streamed to a temporary file next to the cache), signature and validity checks,
 * then promotion to the last-good cache. On failure the last good aggregate is
 * re-verified and used for up to 7 days after its download; older, the run fails.
 */
export class MetadataAggregateSource {
  private readonly logger = new Logger(MetadataAggregateSource.name);
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly settings: IdpMetadataSettings,
    fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get cachePath(): string {
    return join(this.settings.cacheDir, AGGREGATE_FILE);
  }

  /** Configured aggregate URL, with fallback to the cache. */
  async fromUrl(options: LoadOptions & { reuseCacheMaxAgeMs?: number }): Promise<LoadedAggregate> {
    const url = this.settings.url;
    if (!url) throw new MetadataUnavailableError('OECP_IDP_METADATA_URL is not set');
    const pinned = await this.pinned();

    if (options.reuseCacheMaxAgeMs !== undefined) {
      const fetchedAt = await this.cacheFetchedAt();
      if (fetchedAt && options.now.getTime() - fetchedAt.getTime() < options.reuseCacheMaxAgeMs) {
        try {
          return await this.loadCache(pinned, fetchedAt, options, []);
        } catch (error) {
          this.logger.warn(
            `Cached aggregate not reusable (${(error as Error).message}); downloading`,
          );
        }
      }
    }

    let tmp: string | undefined;
    try {
      tmp = await this.download(url);
      const fetchedAt = options.now;
      const scan = await this.verifyAndScan(tmp, pinned, true, options);
      await this.promote(tmp, url, fetchedAt, scan);
      tmp = undefined;
      return { kind: 'url', location: url, verified: true, fetchedAt, scan, warnings: [] };
    } catch (error) {
      const reason = (error as Error).message;
      const fetchedAt = await this.cacheFetchedAt();
      if (!fetchedAt) {
        throw new MetadataUnavailableError(`${reason}; no cached aggregate to fall back to`);
      }
      const age = options.now.getTime() - fetchedAt.getTime();
      if (age > AGGREGATE_MAX_STALENESS_MS) {
        throw new MetadataUnavailableError(
          `${reason}; the cached aggregate from ${fetchedAt.toISOString()} is older than 7 days`,
        );
      }
      const warning = `Aggregate download or verification failed (${reason}); using the last good aggregate from ${fetchedAt.toISOString()}`;
      this.logger.warn(warning);
      try {
        return await this.loadCache(pinned, fetchedAt, options, [warning]);
      } catch (cacheError) {
        throw new MetadataUnavailableError(
          `${reason}; the cached aggregate is unusable too (${(cacheError as Error).message})`,
        );
      }
    } finally {
      if (tmp) await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  /** A local aggregate (CLI `--file`); `verify: false` only for unsigned development metadata. */
  async fromFile(path: string, verify: boolean, options: LoadOptions): Promise<LoadedAggregate> {
    const warnings: string[] = [];
    if (!verify) warnings.push(`Signature of ${path} NOT verified (--no-verify)`);
    const pinned = verify ? await this.pinned() : undefined;
    const scan = await this.verifyAndScan(path, pinned, verify, options);
    return { kind: 'file', location: path, verified: verify, fetchedAt: undefined, scan, warnings };
  }

  private async pinned(): Promise<PinnedCertificate> {
    const file = this.settings.signingCertFile;
    if (!file) {
      throw new MetadataUnavailableError(
        'OECP_IDP_METADATA_SIGNING_CERT_FILE is not set: cannot verify the aggregate signature',
      );
    }
    return loadPinnedCertificate(file);
  }

  private async loadCache(
    pinned: PinnedCertificate,
    fetchedAt: Date,
    options: LoadOptions,
    warnings: string[],
  ): Promise<LoadedAggregate> {
    const scan = await this.verifyAndScan(this.cachePath, pinned, true, options);
    return { kind: 'cache', location: this.cachePath, verified: true, fetchedAt, scan, warnings };
  }

  /**
   * Signature (when `verify`), then the streaming scan of the same bytes, then
   * `validUntil`: one in the past is always refused; a missing one is refused for
   * verified aggregates when `OECP_IDP_METADATA_REQUIRE_VALID_UNTIL` is true.
   */
  private async verifyAndScan(
    path: string,
    pinned: PinnedCertificate | undefined,
    verify: boolean,
    options: LoadOptions,
  ): Promise<AggregateScan> {
    const signature = verify && pinned ? await verifyMetadataSignature(path, pinned) : undefined;
    const scan = await scanAggregate(path, options.wanted);
    if (signature && signature.sha256 !== scan.sha256) {
      throw new MetadataFormatError('Aggregate changed between verification and parsing');
    }
    if (scan.validUntil && scan.validUntil <= options.now) {
      throw new MetadataFormatError(
        `Aggregate expired (validUntil ${scan.validUntil.toISOString()})`,
      );
    }
    if (!scan.validUntil && verify && this.settings.requireValidUntil) {
      throw new MetadataFormatError('Aggregate has no validUntil');
    }
    return scan;
  }

  /** Streams the aggregate to `<cacheDir>/.download-<uuid>.xml`; returns its path. */
  private async download(url: string): Promise<string> {
    const max = this.settings.maxBytes;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        redirect: 'follow',
        headers: { accept: 'application/samlmetadata+xml, application/xml;q=0.9, text/xml;q=0.8' },
        signal: AbortSignal.timeout(AGGREGATE_FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(`download failed: ${describeFetchError(error)}`, { cause: error });
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`download failed: HTTP ${response.status}`);
    }
    if (response.url && new URL(response.url).protocol !== 'https:') {
      await response.body.cancel().catch(() => undefined);
      throw new Error(`download redirected to a non-HTTPS URL`);
    }
    const declared = Number(response.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > max) {
      await response.body.cancel().catch(() => undefined);
      throw new Error(`aggregate too large (${declared} bytes, limit ${max})`);
    }

    await mkdir(this.settings.cacheDir, { recursive: true, mode: 0o750 });
    const tmp = join(this.settings.cacheDir, `.download-${randomUUID()}.xml`);
    const file = await open(tmp, 'wx', 0o640);
    let total = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        let chunk: Awaited<ReturnType<typeof reader.read>>;
        try {
          chunk = await reader.read();
        } catch (error) {
          throw new Error(`download failed: ${describeFetchError(error)}`, { cause: error });
        }
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > max) {
          await reader.cancel().catch(() => undefined);
          throw new Error(`aggregate too large (more than ${max} bytes)`);
        }
        await file.write(chunk.value);
      }
      await file.sync();
    } catch (error) {
      await file.close().catch(() => undefined);
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
    await file.close();
    return tmp;
  }

  private async promote(tmp: string, url: string, fetchedAt: Date, scan: AggregateScan) {
    await rename(tmp, this.cachePath);
    const meta: CacheMeta = {
      url,
      fetchedAt: fetchedAt.toISOString(),
      sha256: scan.sha256,
      bytes: scan.bytes,
      validUntil: scan.validUntil?.toISOString() ?? null,
    };
    const metaTmp = join(this.settings.cacheDir, `.${META_FILE}-${randomUUID()}`);
    await writeFile(metaTmp, `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o640 });
    await rename(metaTmp, join(this.settings.cacheDir, META_FILE));
  }

  /**
   * Download time of the cached aggregate: from `aggregate.json`, else (missing or
   * unreadable sidecar) the file's modification time; undefined without a cache.
   */
  private async cacheFetchedAt(): Promise<Date | undefined> {
    let mtime: Date;
    try {
      mtime = (await stat(this.cachePath)).mtime;
    } catch {
      return undefined;
    }
    try {
      const meta = JSON.parse(
        await readFile(join(this.settings.cacheDir, META_FILE), 'utf8'),
      ) as Partial<CacheMeta>;
      const at = meta.fetchedAt ? new Date(meta.fetchedAt) : undefined;
      // The sidecar is written after the rename; an older sidecar must not make the copy look fresh.
      if (at && !Number.isNaN(at.getTime())) return at < mtime ? at : mtime;
    } catch {
      // Fall through to the modification time.
    }
    return mtime;
  }
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `timed out after ${AGGREGATE_FETCH_TIMEOUT_MS / 1000} s`;
    }
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ?? cause?.message ?? error.message;
  }
  return String(error);
}
