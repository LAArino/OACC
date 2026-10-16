// SPDX-License-Identifier: EUPL-1.2
import {
  BadRequestException,
  Body,
  type CallHandler,
  Controller,
  Delete,
  type ExecutionContext,
  HttpCode,
  Injectable,
  type NestInterceptor,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  COURSE_IMAGE_ALT_MAX,
  COURSE_IMAGE_MAX_BYTES,
  type CourseImage,
  courseImagePatch,
  type CourseImagePatchValue,
  courseImageUploadFields,
} from '@oecp/schemas';
import type { Observable } from 'rxjs';
import { ProblemException } from '../../common/problem.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CourseImageService } from '../../media/course-image.service.js';
import { MediaError, processCourseImage } from '../../media/image-processor.js';
import { AdminJwtGuard } from '../auth/admin-jwt.guard.js';
import type { AdminPrincipal } from '../auth/claims.js';
import { CurrentAdmin, RequireRoles } from '../auth/decorators.js';
import { OrganizationAccess } from '../integrations/organization-access.js';
import { CoursesService } from './courses.service.js';

/** The `file` part as buffered by multer (memory storage). */
export interface UploadedImageFile {
  fieldname: string;
  originalname: string;
  size: number;
  buffer: Buffer;
  mimetype?: string;
}

const ImageMultipart = FileInterceptor('file', {
  // Memory storage; multer stops reading beyond 5 MiB (413) before buffering more.
  // Text parts: alt_en, decorative, credit (UTF-8, at most 4 bytes per character).
  limits: {
    fileSize: COURSE_IMAGE_MAX_BYTES,
    files: 1,
    fields: 3,
    parts: 4,
    fieldSize: COURSE_IMAGE_ALT_MAX * 4,
    headerPairs: 50,
  },
});

/**
 * Parses the `multipart/form-data` of `PUT …/image` (`file` plus the text parts)
 * and turns multer's errors into stable problem codes. Runs after the guard, so
 * anonymous requests are refused before any body is read.
 */
@Injectable()
export class CourseImageUploadInterceptor implements NestInterceptor {
  private readonly inner = new ImageMultipart();

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.inner.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw new ProblemException(413, 'oecp.media.too_large');
      }
      if (error instanceof BadRequestException) {
        throw new ProblemException(400, 'oecp.request.validation_failed', error.message);
      }
      throw error;
    }
  }
}

const uuid = new ParseUUIDPipe();
const uploadFields = new ZodValidationPipe(courseImageUploadFields, {
  contentRules: ['oecp.media.alt_required'],
});
const patchBody = new ZodValidationPipe(courseImagePatch, {
  contentRules: ['oecp.media.alt_required'],
});

/**
 * The course image (decision 27, spec §8): partner_admin of the course's
 * organization (and its sub-units) and alliance_admin. Works on every course,
 * harvested ones included (the harvester never touches the image, so there is no
 * override bookkeeping). Audited `course.image_set` / `course.image_removed`.
 */
@Controller('api/admin/v1')
@UseGuards(AdminJwtGuard)
@RequireRoles(['partner_admin', 'alliance_admin'])
export class CourseImageController {
  constructor(
    private readonly courses: CoursesService,
    private readonly access: OrganizationAccess,
    private readonly images: CourseImageService,
  ) {}

  /**
   * `multipart/form-data`: `file` (JPEG, PNG or WebP, ≤ 5 MiB), `alt_en` (required
   * unless `decorative=true`), `decorative`, `credit`. Re-encoded to WebP; replaces
   * the current image.
   */
  @Put('courses/:id/image')
  @UseInterceptors(CourseImageUploadInterceptor)
  async put(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @UploadedFile() file: UploadedImageFile | undefined,
    @Body(uploadFields) fields: ReturnType<typeof courseImageUploadFields.parse>,
  ): Promise<CourseImage> {
    await this.access.assert(admin, await this.courses.courseOrganization(id));
    if (!file) {
      throw new ProblemException(
        400,
        'oecp.request.validation_failed',
        'The file part is required',
      );
    }
    let image;
    try {
      image = await processCourseImage(file.buffer);
    } catch (error) {
      if (error instanceof MediaError) throw new ProblemException(error.status, error.code);
      throw error;
    }
    return this.images.set(
      id,
      image,
      { ...fields, sourceUrl: null },
      { sub: admin.sub, orgId: admin.orgId ?? null },
      { channel: 'form' },
    );
  }

  /** Alternative texts, decorative flag and credit of the current image. */
  @Patch('courses/:id/image')
  async patch(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
    @Body(patchBody) body: CourseImagePatchValue,
  ): Promise<CourseImage> {
    await this.access.assert(admin, await this.courses.courseOrganization(id));
    return this.images.patch(id, body, { sub: admin.sub, orgId: admin.orgId ?? null });
  }

  @Delete('courses/:id/image')
  @HttpCode(204)
  async remove(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<void> {
    await this.access.assert(admin, await this.courses.courseOrganization(id));
    await this.images.remove(id, { sub: admin.sub, orgId: admin.orgId ?? null });
  }
}
