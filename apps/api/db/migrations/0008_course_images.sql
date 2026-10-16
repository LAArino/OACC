-- SPDX-License-Identifier: EUPL-1.2
-- 0008_course_images: one image per course (decision 27).
--
--   * The files live under ${OECP_UPLOADS_DIR}/media/courses/<course id>/ as
--     <image_key>.lg.webp (fitted inside 1600×1600) and <image_key>.sm.webp
--     (inside 640×640), re-encoded without metadata; image_key is the first 16
--     hex characters of the SHA-256 of the lg file. The api serves them at
--     /media/courses/<course id>/<file>. The original upload is not kept.
--   * image_alt: alternative texts per primary language subtag ({"en": "…"});
--     required in English unless image_decorative (CHECK below).
--   * image_credit: free text of at most 300 characters.
--   * image_width/image_height: of the lg file.
--   * image_source_url: the CSV image_url the image was fetched from (template
--     1.3), else null; an upload repeating the same URL does not fetch again.
--   * Images are set by the web form and the CSV channel only: the harvester
--     never writes these columns (OEAPI v5 has no course image).
--
-- Additive: existing courses have no image. Down drops the columns (the files
-- under media/ are left for the operator).

-- Up Migration
ALTER TABLE courses
  ADD COLUMN image_key text
    CONSTRAINT courses_image_key_check CHECK (image_key ~ '^[0-9a-f]{16}$'),
  ADD COLUMN image_alt jsonb NOT NULL DEFAULT '{}'
    CONSTRAINT courses_image_alt_check CHECK (jsonb_typeof(image_alt) = 'object'),
  ADD COLUMN image_decorative boolean NOT NULL DEFAULT false,
  ADD COLUMN image_credit text
    CONSTRAINT courses_image_credit_check CHECK (length(image_credit) <= 300),
  ADD COLUMN image_width integer
    CONSTRAINT courses_image_width_check CHECK (image_width > 0),
  ADD COLUMN image_height integer
    CONSTRAINT courses_image_height_check CHECK (image_height > 0),
  ADD COLUMN image_source_url text
    CONSTRAINT courses_image_source_url_check
      CHECK (image_source_url ~ '^https://' AND length(image_source_url) <= 2048),
  ADD COLUMN image_updated_at timestamptz,
  -- An image is either decorative or has an English alternative text.
  ADD CONSTRAINT courses_image_alt_required
    CHECK (image_decorative OR image_key IS NULL OR image_alt ? 'en'),
  -- The key and its dimensions go together.
  ADD CONSTRAINT courses_image_complete
    CHECK ((image_key IS NULL) = (image_width IS NULL)
       AND (image_key IS NULL) = (image_height IS NULL)
       AND (image_key IS NULL) = (image_updated_at IS NULL));

-- Down Migration
ALTER TABLE courses
  DROP CONSTRAINT IF EXISTS courses_image_complete,
  DROP CONSTRAINT IF EXISTS courses_image_alt_required,
  DROP COLUMN IF EXISTS image_updated_at,
  DROP COLUMN IF EXISTS image_source_url,
  DROP COLUMN IF EXISTS image_height,
  DROP COLUMN IF EXISTS image_width,
  DROP COLUMN IF EXISTS image_credit,
  DROP COLUMN IF EXISTS image_decorative,
  DROP COLUMN IF EXISTS image_alt,
  DROP COLUMN IF EXISTS image_key;
