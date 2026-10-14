// SPDX-License-Identifier: EUPL-1.2
import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { CSV_MAX_FILE_BYTES } from '@oecp/schemas';
import type { Observable } from 'rxjs';
import { ProblemException } from '../../common/problem.js';

/** A file part of the upload as buffered by multer (memory storage). */
export interface UploadedCsvFile {
  fieldname: string;
  originalname: string;
  size: number;
  buffer: Buffer;
  mimetype?: string;
}

export type UploadedCsvFiles = Partial<Record<'courses' | 'offerings', UploadedCsvFile[]>>;

const MultipartFields = FileFieldsInterceptor(
  [
    { name: 'courses', maxCount: 1 },
    { name: 'offerings', maxCount: 1 },
  ],
  {
    // Memory storage; spec §6.3: 5 MB per file. No other parts are accepted.
    limits: { fileSize: CSV_MAX_FILE_BYTES, files: 2, fields: 0, parts: 2, headerPairs: 50 },
  },
);

/**
 * Parses `multipart/form-data` with the `courses` and/or `offerings` file fields
 * and turns multer's errors into stable problem codes. Runs after the guard, so
 * anonymous requests are refused before any body is read.
 */
@Injectable()
export class CsvUploadInterceptor implements NestInterceptor {
  private readonly inner = new MultipartFields();

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.inner.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw new ProblemException(413, 'oecp.csv.file_too_large');
      }
      if (error instanceof BadRequestException) {
        throw new ProblemException(400, 'oecp.csv.unexpected_file', error.message);
      }
      throw error;
    }
  }
}
