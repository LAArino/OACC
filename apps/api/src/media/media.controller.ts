// SPDX-License-Identifier: EUPL-1.2
import { createReadStream } from 'node:fs';
import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ProblemException } from '../common/problem.js';
import { CourseMediaStorage } from './course-media.storage.js';

/** Files are named by the hash of their content: they never change under a URL. */
export const MEDIA_CACHE = 'public, max-age=31536000, immutable';

interface MediaRequest {
  headers: Record<string, string | string[] | undefined>;
  method: string;
}

interface MediaResponse {
  status(code: number): MediaResponse;
  setHeader(name: string, value: string): unknown;
  end(): unknown;
  headersSent: boolean;
  destroy(error?: Error): unknown;
}

/**
 * Course images (decision 27), anonymous: `GET`/`HEAD /media/courses/{courseId}/{file}`
 * with `{file}` = `<16 hex>.lg.webp` or `<16 hex>.sm.webp`. Streamed from disk;
 * the content type is fixed (the files are WebP written by the media module, the
 * name is validated by pattern and carries the content hash), long-lived and
 * immutable cache, weak `ETag`, no cookies. 404 problem+json otherwise. Traefik
 * routes `/media` on the portal host to the api.
 */
@Controller('media')
export class MediaController {
  constructor(private readonly storage: CourseMediaStorage) {}

  /** Express routes `HEAD` to this handler too: headers only. */
  @Get('courses/:courseId/:file')
  async file(
    @Param('courseId') courseId: string,
    @Param('file') file: string,
    @Req() request: MediaRequest,
    @Res() response: MediaResponse,
  ): Promise<void> {
    const stored = await this.storage.file(courseId, file);
    if (!stored) throw new ProblemException(404, 'oecp.request.not_found', 'Image not found');
    const etag = `W/"${file.slice(0, -'.webp'.length)}"`;
    response.setHeader('Cache-Control', MEDIA_CACHE);
    response.setHeader('ETag', etag);
    if (matches(request.headers['if-none-match'], etag)) {
      response.status(304).end();
      return;
    }
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Length', String(stored.size));
    response.setHeader('Last-Modified', stored.mtime.toUTCString());
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'HEAD') {
      response.status(200).end();
      return;
    }
    await new Promise<void>((resolve) => {
      const stream = createReadStream(stored.path);
      stream.on('error', (error) => {
        if (!response.headersSent) response.status(500);
        response.destroy(error);
        resolve();
      });
      stream.on('end', resolve);
      response.status(200);
      stream.pipe(response as unknown as NodeJS.WritableStream);
    });
  }
}

/** `If-None-Match` list (weak comparison, RFC 9110 §13.1.2). */
function matches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const opaque = etag.replace(/^W\//, '');
  return String(header)
    .split(',')
    .map((v) => v.trim())
    .some((v) => v === '*' || v.replace(/^W\//, '') === opaque);
}
