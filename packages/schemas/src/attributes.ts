// SPDX-License-Identifier: EUPL-1.2
/**
 * Alliance attributes (decision 18). Each deployment serves one alliance, which
 * defines its own course attributes (`attribute_definitions`: Aurora's educational
 * hub, SDGs, competence framework, micro-credential…). A course stores the values
 * in `courses.attributes`, an object keyed by attribute key whose values are a
 * string (`enum`, `text`), a list of strings (`multi_enum`) or a boolean.
 *
 * Browser-safe and dependency-free apart from Zod: the CSV console validates
 * `attr_<key>` columns with the definitions of `/api/public/v1/reference`, the
 * server with those of the database. Issue messages are stable error codes.
 */
import { z } from 'zod';
import { type AttributeValueType, attributeValueType } from './enums.js';
import type { ErrorCode } from './error-codes.js';
import { type LocalizedLabel, localizedLabel } from './primitives.js';

/** DDL `attribute_definitions.key`. Also the suffix of `attr_<key>` CSV columns and query parameters. */
export const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
/** Option values: no `|` (the CSV multi-value separator), no spaces. */
export const ATTRIBUTE_OPTION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/;
/** Maximum length of a `text` attribute value. */
export const ATTRIBUTE_TEXT_MAX = 500;
/** Options per `enum`/`multi_enum` definition. */
export const ATTRIBUTE_MAX_OPTIONS = 200;

/** Spellings of booleans accepted in CSV cells (case-insensitive). */
export const ATTRIBUTE_TRUE_VALUES: readonly string[] = ['true', 'yes', '1'];
export const ATTRIBUTE_FALSE_VALUES: readonly string[] = ['false', 'no', '0'];
/** Display labels of boolean values. */
export const ATTRIBUTE_BOOLEAN_LABELS: Readonly<Record<'true' | 'false', LocalizedLabel>> = {
  true: { en: 'Yes' },
  false: { en: 'No' },
};

export const attributeKey = z.string().regex(ATTRIBUTE_KEY_PATTERN);

export const attributeOption = z.strictObject({
  value: z.string().regex(ATTRIBUTE_OPTION_PATTERN),
  label: localizedLabel,
});
export type AttributeOption = z.infer<typeof attributeOption>;

/** One row of `attribute_definitions` (seed files, `/reference`). */
export const attributeDefinition = z
  .strictObject({
    key: attributeKey,
    value_type: attributeValueType,
    label: localizedLabel,
    description: localizedLabel.nullable().default(null),
    /** Required (non-empty) for `enum`/`multi_enum`; null for `boolean`/`text`. */
    options: z.array(attributeOption).min(1).max(ATTRIBUTE_MAX_OPTIONS).nullable().default(null),
    /** Offered as a search filter and facet of the public catalogue. */
    filterable: z.boolean().default(false),
    /** Shown as a tag on course cards. */
    show_as_tag: z.boolean().default(true),
    sort_order: z.int().min(-32768).max(32767).default(0),
  })
  .superRefine((d, ctx) => {
    const enumLike = d.value_type === 'enum' || d.value_type === 'multi_enum';
    if (enumLike && !d.options) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: `options are required for ${d.value_type}`,
      });
    }
    if (!enumLike && d.options) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: `${d.value_type} attributes take no options`,
      });
    }
    const seen = new Set<string>();
    d.options?.forEach((o, i) => {
      if (seen.has(o.value)) {
        ctx.addIssue({
          code: 'custom',
          path: ['options', i, 'value'],
          message: `Duplicate option ${o.value}`,
        });
      }
      seen.add(o.value);
    });
  });
export type AttributeDefinition = z.output<typeof attributeDefinition>;
export type AttributeDefinitionInput = z.input<typeof attributeDefinition>;

/** Definitions in display order: `sort_order`, then key. */
export function sortAttributeDefinitions<T extends Pick<AttributeDefinition, 'key' | 'sort_order'>>(
  definitions: readonly T[],
): T[] {
  return [...definitions].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
}

/** A stored attribute value, whatever its definition. */
export const attributeValue = z.union(
  [
    z.string().min(1).max(ATTRIBUTE_TEXT_MAX),
    z.array(z.string().min(1).max(100)).min(1).max(ATTRIBUTE_MAX_OPTIONS),
    z.boolean(),
  ],
  { error: 'oecp.content.invalid_attribute_value' },
);
export type AttributeValue = z.infer<typeof attributeValue>;

/**
 * Shape of `courses.attributes` without the alliance's definitions (canonical
 * DTO). The writer checks the values against the definitions with
 * {@link buildAttributesSchema}.
 */
export const courseAttributes = z.record(
  z.string().regex(ATTRIBUTE_KEY_PATTERN, { error: 'oecp.content.unknown_attribute' }),
  attributeValue,
);
export type CourseAttributes = z.infer<typeof courseAttributes>;

const INVALID: ErrorCode = 'oecp.content.invalid_attribute_value';
const UNKNOWN_OPTION: ErrorCode = 'oecp.content.unknown_attribute_option';

function optionSchema(values: readonly string[]) {
  return z.enum(values as [string, ...string[]], {
    error: (iss) => (typeof iss.input === 'string' ? UNKNOWN_OPTION : INVALID),
  });
}

function valueSchema(definition: AttributeDefinition): z.ZodType<AttributeValue> {
  const options = (definition.options ?? []).map((o) => o.value);
  switch (definition.value_type) {
    case 'boolean':
      return z.boolean({ error: INVALID });
    case 'text':
      return z
        .string({ error: INVALID })
        .min(1, { error: INVALID })
        .max(ATTRIBUTE_TEXT_MAX, { error: INVALID });
    case 'enum':
      return options.length ? optionSchema(options) : z.never({ error: INVALID });
    case 'multi_enum':
      return z
        .array(options.length ? optionSchema(options) : z.never({ error: INVALID }), {
          error: INVALID,
        })
        .min(1, { error: INVALID })
        .refine((list) => new Set(list).size === list.length, { error: INVALID });
  }
}

/**
 * Zod object validating a course's `attributes` against the alliance's
 * definitions: unknown keys → `oecp.content.unknown_attribute`, a value of the
 * wrong type → `oecp.content.invalid_attribute_value`, a value outside the
 * options → `oecp.content.unknown_attribute_option`. Every key is optional.
 */
export function buildAttributesSchema(definitions: readonly AttributeDefinition[]) {
  const shape: Record<string, z.ZodOptional<z.ZodType<AttributeValue>>> = {};
  for (const definition of definitions) shape[definition.key] = valueSchema(definition).optional();
  return z.strictObject(shape, {
    error: (iss) => (iss.code === 'unrecognized_keys' ? 'oecp.content.unknown_attribute' : INVALID),
  });
}

/** Result of reading one `attr_<key>` CSV cell. */
export type AttributeCellResult =
  { ok: true; value: AttributeValue | null } | { ok: false; code: ErrorCode; detail: string };

/**
 * Reads a CSV cell of `attr_<key>`: empty → `null` (the attribute is removed);
 * booleans `true/false/yes/no/1/0`; `multi_enum` values separated by `|` (order of
 * the definition's options, duplicates dropped); `enum` values by option value.
 */
export function parseAttributeCell(
  definition: AttributeDefinition,
  cell: string,
): AttributeCellResult {
  const raw = cell.trim();
  if (raw === '') return { ok: true, value: null };
  const options = (definition.options ?? []).map((o) => o.value);
  switch (definition.value_type) {
    case 'boolean': {
      const lower = raw.toLowerCase();
      if (ATTRIBUTE_TRUE_VALUES.includes(lower)) return { ok: true, value: true };
      if (ATTRIBUTE_FALSE_VALUES.includes(lower)) return { ok: true, value: false };
      return { ok: false, code: INVALID, detail: `expected true or false, got ${raw}` };
    }
    case 'text':
      return raw.length > ATTRIBUTE_TEXT_MAX
        ? { ok: false, code: INVALID, detail: `longer than ${ATTRIBUTE_TEXT_MAX} characters` }
        : { ok: true, value: raw };
    case 'enum':
      if (raw.includes('|')) {
        return { ok: false, code: INVALID, detail: 'only one value is allowed' };
      }
      return options.includes(raw)
        ? { ok: true, value: raw }
        : { ok: false, code: UNKNOWN_OPTION, detail: raw };
    case 'multi_enum': {
      const values = [
        ...new Set(
          raw
            .split('|')
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ];
      const unknown = values.filter((v) => !options.includes(v));
      if (unknown.length > 0) {
        return { ok: false, code: UNKNOWN_OPTION, detail: unknown.join(', ') };
      }
      if (values.length === 0) return { ok: true, value: null };
      return {
        ok: true,
        value: values.sort((a, b) => options.indexOf(a) - options.indexOf(b)),
      };
    }
  }
}

/** One displayable value of an attribute. */
export interface AttributeValueLabel {
  value: string;
  label: LocalizedLabel;
}

/**
 * Display values of a stored attribute: option labels (the value itself for an
 * option the definition no longer has), `Yes`/`No` for booleans, the text for
 * `text`. Values of the wrong shape for the definition are dropped.
 */
export function attributeValueLabels(
  definition: Pick<AttributeDefinition, 'value_type' | 'options'>,
  value: unknown,
): AttributeValueLabel[] {
  const labels = new Map((definition.options ?? []).map((o) => [o.value, o.label]));
  const option = (v: string): AttributeValueLabel => ({
    value: v,
    label: labels.get(v) ?? { en: v },
  });
  const type: AttributeValueType = definition.value_type;
  if (type === 'boolean') {
    return typeof value === 'boolean'
      ? [{ value: String(value), label: ATTRIBUTE_BOOLEAN_LABELS[value ? 'true' : 'false'] }]
      : [];
  }
  if (type === 'text') {
    return typeof value === 'string' && value !== '' ? [{ value, label: { en: value } }] : [];
  }
  if (type === 'enum') return typeof value === 'string' && value !== '' ? [option(value)] : [];
  if (!Array.isArray(value)) return [];
  const order = (definition.options ?? []).map((o) => o.value);
  const rank = (v: string) => {
    const i = order.indexOf(v);
    return i === -1 ? order.length : i;
  };
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && v !== ''))]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(option);
}
