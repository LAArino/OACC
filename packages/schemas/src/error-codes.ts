// SPDX-License-Identifier: EUPL-1.2

export interface ErrorCodeSpec {
  /** Severity reported by every channel; no channel downgrades or upgrades it. */
  readonly severity: 'error' | 'warning';
  /** Default English message; UIs translate by code. */
  readonly message: string;
}

/**
 * Stable error codes (spec §6.6). Codes are never renamed or reused;
 * `errors.json` is generated from this table at build time. The severity here
 * is the one every channel reports: where a channel treats a situation with
 * another severity it uses a distinct code (e.g. `oecp.oeapi.english_missing`,
 * a warning, next to `oecp.content.english_missing`, an error).
 */
export const ERROR_CODES = {
  'oecp.request.validation_failed': { severity: 'error', message: 'Request validation failed' },
  'oecp.request.not_found': { severity: 'error', message: 'Resource not found' },
  'oecp.request.not_implemented': { severity: 'error', message: 'Not implemented' },
  'oecp.internal': { severity: 'error', message: 'Internal error' },

  'oecp.auth.missing_token': { severity: 'error', message: 'Bearer token required' },
  'oecp.auth.invalid_token': { severity: 'error', message: 'Token is invalid or expired' },
  'oecp.auth.insufficient_acr': {
    severity: 'error',
    message: 'Multi-factor authentication required',
  },
  'oecp.auth.no_role': { severity: 'error', message: 'No OECP role assigned' },
  'oecp.auth.unknown_organization': { severity: 'error', message: 'Organization does not exist' },
  'oecp.auth.idp_mismatch': {
    severity: 'error',
    message: 'Identity provider does not match the organization',
  },
  'oecp.auth.forbidden_organization': {
    severity: 'error',
    message: 'Organization outside your scope',
  },
  'oecp.auth.forbidden_role': {
    severity: 'error',
    message: 'Your role does not permit this operation',
  },

  'oecp.invitation.invalid': {
    severity: 'error',
    message: 'Invitation is invalid or already used',
  },
  'oecp.invitation.expired': { severity: 'error', message: 'Invitation has expired' },
  'oecp.invitation.mismatch': {
    severity: 'error',
    message: 'Signed-in identity does not match the invitation',
  },
  'oecp.invitation.idp_not_enabled': {
    severity: 'error',
    message: 'Identity provider not enabled',
  },

  'oecp.identity.unavailable': {
    severity: 'error',
    message: 'Identity service request failed',
  },
  'oecp.identity.conflict': {
    severity: 'error',
    message: 'Conflicting account in the identity service',
  },
  'oecp.mail.unavailable': { severity: 'error', message: 'E-mail could not be sent' },

  'oecp.content.english_missing': {
    severity: 'error',
    message: 'English title is required to publish',
  },
  'oecp.content.invalid_value': { severity: 'error', message: 'Invalid value' },
  'oecp.content.date_order': { severity: 'error', message: 'Dates are out of order' },
  'oecp.content.seats_exceed_capacity': { severity: 'error', message: 'Seats exceed max_students' },
  'oecp.content.seats_without_timestamp': {
    severity: 'error',
    message: 'seats_available requires seats_updated_at',
  },
  'oecp.content.duplicate_isced': { severity: 'error', message: 'Duplicate ISCED code' },
  'oecp.content.unknown_isced_field': { severity: 'error', message: 'Unknown ISCED broad field' },
  'oecp.content.unknown_delivery_mode': { severity: 'error', message: 'Unknown delivery mode' },
  'oecp.content.unknown_teaching_unit': { severity: 'error', message: 'Unknown teaching unit' },
  'oecp.content.unknown_session': { severity: 'error', message: 'Unknown academic session' },
  'oecp.content.session_ignored': {
    severity: 'warning',
    message: 'Academic session unknown or invalid; the offering was stored without it',
  },
  'oecp.content.unknown_course': { severity: 'error', message: 'Unknown course code' },
  'oecp.content.unknown_attribute': {
    severity: 'error',
    message: 'Unknown attribute (not defined by the alliance)',
  },
  'oecp.content.invalid_attribute_value': {
    severity: 'error',
    message: 'Attribute value does not match its definition',
  },
  'oecp.content.unknown_attribute_option': {
    severity: 'error',
    message: 'Attribute value is not one of the defined options',
  },
  'oecp.content.invalid_code': {
    severity: 'error',
    message: 'Codes start with a letter or digit and use letters, digits, . _ / - (≤ 200)',
  },
  'oecp.content.unsupported_language': {
    severity: 'error',
    message: 'Language is not in the list of supported languages',
  },
  'oecp.content.duplicate_ext_id': {
    severity: 'error',
    message: 'A record with this code already exists',
  },
  'oecp.content.ext_id_immutable': {
    severity: 'error',
    message: 'The code of an existing record cannot be changed',
  },
  'oecp.content.override_not_allowed': {
    severity: 'error',
    message:
      'Overrides apply only to harvested records (organizations whose authoritative channel is oeapi)',
  },
  'oecp.content.has_published_offerings': {
    severity: 'error',
    message: 'The course has published offerings; withdraw or cancel them first',
  },
  'oecp.content.published_not_deletable': {
    severity: 'error',
    message: 'A published record cannot be deleted; withdraw or cancel it instead',
  },
  'oecp.content.harvested_not_deletable': {
    severity: 'error',
    message: 'Harvested records cannot be deleted; withdraw them with a status override',
  },
  'oecp.content.duplicate_slug': {
    severity: 'error',
    message: 'Another organization already uses this slug',
  },
  'oecp.content.duplicate_identifier': {
    severity: 'error',
    message:
      'Another organization already uses this identifier (SCHAC home organization, Erasmus code, PIC, IdP alias or code)',
  },
  'oecp.content.slug_immutable': {
    severity: 'error',
    message: 'The slug of an existing organization cannot be changed',
  },
  'oecp.content.invalid_parent': {
    severity: 'error',
    message: 'The parent organization does not exist, is deleted or would create a cycle',
  },
  'oecp.content.organization_in_use': {
    severity: 'error',
    message:
      'The organization still has courses, sub-units, administrators, pending invitations or an enabled harvest',
  },
  'oecp.content.handbook_incomplete': {
    severity: 'warning',
    message: 'Course is missing fields the Aurora IT Handbook requires to publish',
  },

  'oecp.admin.cannot_remove_self': {
    severity: 'error',
    message: 'You cannot revoke your own administrator access',
  },
  'oecp.admin.last_alliance_admin': {
    severity: 'error',
    message: 'At least one alliance_admin must remain',
  },
  'oecp.admin.not_local_account': {
    severity: 'error',
    message:
      'The account signs in through an institutional identity provider; it has no local setup',
  },
  'oecp.admin.setup_complete': {
    severity: 'error',
    message: 'The account has no pending password or authenticator setup',
  },

  'oecp.csv.missing_column': { severity: 'error', message: 'Required column is missing' },
  'oecp.csv.unknown_column': { severity: 'error', message: 'Unknown column' },
  'oecp.csv.missing_value': { severity: 'error', message: 'Required value is empty' },
  'oecp.csv.invalid_template_version': {
    severity: 'error',
    message:
      'Expected template_version 1.0, 1.1, 1.2 or 1.3 (1.1 for kind, levels, attr_* and application_instructions_* columns; 1.2 for instructors and the handbook texts; 1.3 for the image columns)',
  },
  'oecp.csv.conflicting_columns': {
    severity: 'error',
    message: 'Use either level or levels, not both',
  },
  'oecp.csv.invalid_code': { severity: 'error', message: 'Invalid course or offering code' },
  'oecp.csv.invalid_status': {
    severity: 'error',
    message: 'Expected draft, published, withdrawn or cancelled',
  },
  'oecp.csv.invalid_date': { severity: 'error', message: 'Expected YYYY-MM-DD' },
  'oecp.csv.invalid_number': { severity: 'error', message: 'Invalid number' },
  'oecp.csv.invalid_url': { severity: 'error', message: 'Expected an https:// URL' },
  'oecp.csv.invalid_email': { severity: 'error', message: 'Invalid email address' },
  'oecp.csv.invalid_language': { severity: 'error', message: 'Invalid BCP 47 language tag' },
  'oecp.csv.invalid_isced': { severity: 'error', message: 'Invalid ISCED-F code' },
  'oecp.csv.invalid_delivery_mode': { severity: 'error', message: 'Invalid delivery mode code' },
  'oecp.csv.invalid_level': { severity: 'error', message: 'Invalid level' },
  'oecp.csv.invalid_kind': {
    severity: 'error',
    message: 'Expected course, bip, lecture_series or other',
  },
  'oecp.csv.invalid_timezone': { severity: 'error', message: 'Invalid IANA time zone' },
  'oecp.csv.cell_too_long': { severity: 'error', message: 'Cell exceeds 20,000 characters' },
  'oecp.csv.duplicate_row': { severity: 'error', message: 'Duplicate natural key in file' },
  'oecp.csv.file_too_large': { severity: 'error', message: 'File exceeds 5 MB' },
  'oecp.csv.too_many_rows': { severity: 'error', message: 'File exceeds 5,000 rows' },
  'oecp.csv.too_many_columns': { severity: 'error', message: 'File exceeds 300 columns' },
  'oecp.csv.encoding': { severity: 'error', message: 'File is not valid UTF-8' },
  'oecp.csv.malformed': { severity: 'error', message: 'File is not valid RFC 4180 CSV' },
  'oecp.csv.rate_limited': { severity: 'error', message: 'Upload limit reached (10 per hour)' },
  'oecp.csv.duplicate_column': {
    severity: 'error',
    message: 'Column appears more than once in the header',
  },
  'oecp.csv.field_count': {
    severity: 'error',
    message: 'Row has a different number of cells than the header',
  },
  'oecp.csv.empty_file': { severity: 'error', message: 'File has no header row' },
  'oecp.csv.text_without_title': {
    severity: 'error',
    message: 'Texts in a language need the title in that language',
  },
  'oecp.csv.language_deleted': {
    severity: 'warning',
    message: 'Every text of this language is empty; the language will be deleted',
  },
  'oecp.csv.no_data_rows': { severity: 'warning', message: 'File has a header but no rows' },
  'oecp.csv.no_files': {
    severity: 'error',
    message: 'Upload a courses file, an offerings file or both',
  },
  'oecp.csv.unexpected_file': {
    severity: 'error',
    message: 'Only the multipart fields courses and offerings (one file each) are accepted',
  },
  'oecp.csv.write_failed': {
    severity: 'error',
    message: 'The upload could not be written; nothing was saved',
  },

  'oecp.oeapi.mass_absence': {
    severity: 'warning',
    message: '30% or more of published courses missing; absences not counted',
  },
  'oecp.oeapi.unauthorized': {
    severity: 'error',
    message: 'Partner endpoint rejected the credentials',
  },
  'oecp.oeapi.unreachable': { severity: 'error', message: 'Partner endpoint unreachable' },
  'oecp.oeapi.http_error': {
    severity: 'error',
    message: 'Unexpected HTTP status from partner endpoint',
  },
  'oecp.oeapi.host_not_approved': { severity: 'error', message: 'Harvest host not approved' },
  'oecp.oeapi.address_refused': { severity: 'error', message: 'Resolved address is not public' },
  'oecp.oeapi.body_too_large': { severity: 'error', message: 'Response body exceeds 20 MB' },
  'oecp.oeapi.page_cap_reached': { severity: 'warning', message: 'Listing stopped at 1,000 pages' },
  'oecp.oeapi.invalid_payload': { severity: 'error', message: 'Payload does not match OEAPI v5' },
  'oecp.oeapi.missing_primary_code': { severity: 'error', message: 'Course has no primaryCode' },
  'oecp.oeapi.study_load_unit': {
    severity: 'error',
    message: 'studyLoad must be in ECTS and greater than 0',
  },
  'oecp.oeapi.invalid_isced': {
    severity: 'warning',
    message: 'fieldsOfStudy is not a valid ISCED-F code',
  },
  'oecp.oeapi.language_dropped': {
    severity: 'warning',
    message: 'Language code mul/und/zxx/mis dropped',
  },
  'oecp.oeapi.unmappable_delivery_mode': {
    severity: 'error',
    message: 'No mappable modeOfDelivery',
  },
  'oecp.oeapi.parent_rejected': {
    severity: 'error',
    message: 'Offering rejected because its course was rejected',
  },
  'oecp.oeapi.root_not_matched': {
    severity: 'error',
    message: 'Root organization does not match the partner',
  },
  'oecp.oeapi.insecure_url': {
    severity: 'error',
    message: 'Partner endpoint must use https on port 443',
  },
  'oecp.oeapi.redirect_refused': {
    severity: 'error',
    message: 'Redirect to another host, another scheme or more than 3 hops refused',
  },
  'oecp.oeapi.timeout': { severity: 'error', message: 'Partner endpoint did not answer in 30 s' },
  'oecp.oeapi.run_timeout': { severity: 'error', message: 'Harvest exceeded 2 hours' },
  'oecp.oeapi.listing_failed': {
    severity: 'error',
    message: 'A listing page failed; the harvest is incomplete',
  },
  'oecp.oeapi.empty_listing': {
    severity: 'warning',
    message: 'The course listing returned no courses',
  },
  'oecp.oeapi.detail_unavailable': {
    severity: 'warning',
    message: 'Offering detail unavailable; the listing item was used',
  },
  'oecp.oeapi.duplicate_entity': {
    severity: 'warning',
    message: 'Natural key already harvested in this run; duplicate ignored',
  },
  'oecp.oeapi.insecure_link': {
    severity: 'warning',
    message: 'Link is not an https URL and was dropped',
  },
  'oecp.oeapi.invalid_language': {
    severity: 'warning',
    message: 'Language code is not valid and was ignored',
  },
  'oecp.oeapi.missing_teaching_language': {
    severity: 'error',
    message: 'No usable teachingLanguage on the offering or its course',
  },
  'oecp.oeapi.text_without_title': {
    severity: 'warning',
    message: 'Texts in a language without a name in that language were ignored',
  },
  'oecp.oeapi.value_truncated': {
    severity: 'warning',
    message: 'Value truncated to the maximum length',
  },
  'oecp.oeapi.invalid_student_counts': {
    severity: 'warning',
    message: 'Student numbers ignored (maxNumberStudents must be greater than 0)',
  },
  'oecp.oeapi.invalid_extension': {
    severity: 'warning',
    message: 'An ext.oecp member has an invalid shape and was ignored',
  },
  'oecp.oeapi.write_failed': {
    severity: 'error',
    message: 'The canonical record could not be written',
  },
  'oecp.oeapi.secret_unavailable': {
    severity: 'error',
    message: 'The partner credential could not be read',
  },
  // Warnings the harvester raises where another channel refuses (one code per
  // severity: the catalogue is the source of truth, spec §6.6).
  'oecp.oeapi.multiple_roots': {
    severity: 'warning',
    message: 'Several root organizations returned; the first was used',
  },
  'oecp.oeapi.english_missing': {
    severity: 'warning',
    message: 'No English name; the course is stored as draft',
  },
  'oecp.oeapi.unknown_isced_field': {
    severity: 'warning',
    message: 'fieldsOfStudy code with an unknown ISCED broad field was ignored',
  },
  'oecp.oeapi.delivery_mode_dropped': {
    severity: 'warning',
    message: 'modeOfDelivery values without a mapping were ignored',
  },
  'oecp.oeapi.invalid_coordinators': {
    severity: 'warning',
    message: 'coordinators is not an array and was ignored',
  },

  'oecp.integration.not_configured': {
    severity: 'error',
    message: 'No integration is configured for this organization',
  },
  'oecp.integration.access_mode_required': {
    severity: 'error',
    message: 'access_mode is required when the authoritative channel is oeapi',
  },
  'oecp.integration.base_url_required': {
    severity: 'error',
    message: 'base_url is required in direct access mode',
  },
  'oecp.integration.endpoint_id_required': {
    severity: 'error',
    message: 'surfeduhub_endpoint_id is required in surfeduhub access mode',
  },
  'oecp.integration.header_name_required': {
    severity: 'error',
    message: 'api_key_header_name is required for api_key_header authentication',
  },
  'oecp.integration.basic_secret_format': {
    severity: 'error',
    message: 'A basic credential must be username:password',
  },
  'oecp.integration.secret_required': {
    severity: 'error',
    message: 'A credential is required for this authentication scheme',
  },
  'oecp.integration.secret_not_expected': {
    severity: 'error',
    message: 'auth_scheme none takes no credential',
  },
  'oecp.integration.insecure_url': {
    severity: 'error',
    message: 'base_url must be an https URL on port 443',
  },
  'oecp.integration.surfeduhub_unavailable': {
    severity: 'error',
    message: 'SURFeduhub access is not configured in this deployment (SURFEDUHUB_SECRET_REF)',
  },
  'oecp.secrets.unavailable': {
    severity: 'error',
    message: 'Secret storage is unavailable (master key missing or invalid)',
  },

  'oecp.sync.already_running': {
    severity: 'error',
    message: 'A run for this organization is in progress',
  },
  'oecp.sync.rate_limited': {
    severity: 'error',
    message: 'Sync now is limited to once per 15 minutes',
  },
  'oecp.sync.channel_disabled': {
    severity: 'error',
    message: 'Channel is not authoritative for this organization',
  },

  'oecp.media.too_large': { severity: 'error', message: 'Image larger than 5 MiB' },
  'oecp.media.unsupported_type': {
    severity: 'error',
    message: 'Image must be JPEG, PNG or WebP',
  },
  'oecp.media.invalid_image': {
    severity: 'error',
    message: 'Image cannot be decoded, exceeds 40 megapixels or does not fit 2 MiB once re-encoded',
  },
  'oecp.media.alt_required': {
    severity: 'error',
    message: 'An English alternative text is required unless the image is decorative',
  },
  'oecp.media.fetch_failed': {
    severity: 'warning',
    message: 'Image could not be fetched from image_url; the course keeps its current image',
  },
  'oecp.media.not_found': { severity: 'error', message: 'The course has no image' },
} as const satisfies Record<string, ErrorCodeSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;
/** Codes whose catalogue severity is `error`. */
export type ErrorSeverityCode = {
  [K in ErrorCode]: (typeof ERROR_CODES)[K]['severity'] extends 'error' ? K : never;
}[ErrorCode];
/** Codes whose catalogue severity is `warning`. */
export type WarningSeverityCode = Exclude<ErrorCode, ErrorSeverityCode>;

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_CODES, value);
}
