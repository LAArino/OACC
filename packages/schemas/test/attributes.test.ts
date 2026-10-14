// SPDX-License-Identifier: EUPL-1.2
import { describe, expect, it } from 'vitest';
import {
  type AttributeDefinition,
  attributeDefinition,
  attributeValueLabels,
  buildAttributesSchema,
  course,
  courseOffering,
  csvTemplate,
  issuesToProblemErrors,
  parseAttributeCell,
  resolveLevels,
  sortAttributeDefinitions,
  validateCsvFiles,
  validateCsvRows,
  validateCsvText,
} from '../src/index.js';

const DEFINITIONS: AttributeDefinition[] = [
  {
    key: 'sdg',
    value_type: 'multi_enum',
    label: { en: 'SDGs' },
    description: null,
    options: [
      { value: 'sdg04', label: { en: 'SDG 4: Quality education' } },
      { value: 'sdg13', label: { en: 'SDG 13: Climate action' } },
    ],
    filterable: true,
    show_as_tag: true,
    sort_order: 20,
  },
  {
    key: 'competence_framework',
    value_type: 'enum',
    label: { en: 'Competence framework' },
    description: null,
    options: [
      { value: 'louis', label: { en: 'LOUIS' } },
      { value: 'none', label: { en: 'None' } },
    ],
    filterable: false,
    show_as_tag: false,
    sort_order: 30,
  },
  {
    key: 'free_course',
    value_type: 'boolean',
    label: { en: 'Free course' },
    description: null,
    options: null,
    filterable: true,
    show_as_tag: true,
    sort_order: 10,
  },
  {
    key: 'faculty',
    value_type: 'text',
    label: { en: 'Faculty' },
    description: null,
    options: null,
    filterable: false,
    show_as_tag: false,
    sort_order: 40,
  },
];

const schema = buildAttributesSchema(DEFINITIONS);
const codes = (value: unknown) => {
  const result = schema.safeParse(value);
  return result.success
    ? []
    : issuesToProblemErrors(result.error.issues).map((e) => [e.code, e.pointer]);
};

describe('attributeDefinition', () => {
  it('applies defaults and requires options exactly for enum and multi_enum', () => {
    expect(
      attributeDefinition.parse({ key: 'free', value_type: 'boolean', label: { en: 'Free' } }),
    ).toEqual({
      key: 'free',
      value_type: 'boolean',
      label: { en: 'Free' },
      description: null,
      options: null,
      filterable: false,
      show_as_tag: true,
      sort_order: 0,
    });
    const base = { key: 'hub', label: { en: 'Hub' } };
    expect(attributeDefinition.safeParse({ ...base, value_type: 'enum' }).success).toBe(false);
    expect(
      attributeDefinition.safeParse({
        ...base,
        value_type: 'text',
        options: [{ value: 'a', label: { en: 'A' } }],
      }).success,
    ).toBe(false);
    expect(
      attributeDefinition.safeParse({
        ...base,
        value_type: 'enum',
        options: [
          { value: 'a', label: { en: 'A' } },
          { value: 'a', label: { en: 'B' } },
        ],
      }).success,
    ).toBe(false);
    expect(
      attributeDefinition.safeParse({
        ...base,
        value_type: 'enum',
        options: [{ value: 'a|b', label: { en: 'A' } }],
      }).success,
    ).toBe(false);
    expect(attributeDefinition.safeParse({ ...base, key: 'x', value_type: 'text' }).success).toBe(
      false,
    );
  });

  it('sorts by sort_order, then key', () => {
    expect(sortAttributeDefinitions(DEFINITIONS).map((d) => d.key)).toEqual([
      'free_course',
      'sdg',
      'competence_framework',
      'faculty',
    ]);
  });
});

describe('buildAttributesSchema', () => {
  it('accepts values matching their definitions; every key is optional', () => {
    expect(codes({})).toEqual([]);
    expect(
      codes({
        sdg: ['sdg13', 'sdg04'],
        competence_framework: 'louis',
        free_course: false,
        faculty: 'Faculty of Arts',
      }),
    ).toEqual([]);
  });

  it('rejects unknown keys, wrong types and unknown options with stable codes', () => {
    expect(codes({ hub: ['x'] })).toEqual([['oecp.content.unknown_attribute', '/hub']]);
    expect(codes({ free_course: 'yes' })).toEqual([
      ['oecp.content.invalid_attribute_value', '/free_course'],
    ]);
    expect(codes({ competence_framework: 'other' })).toEqual([
      ['oecp.content.unknown_attribute_option', '/competence_framework'],
    ]);
    expect(codes({ competence_framework: ['louis'] })).toEqual([
      ['oecp.content.invalid_attribute_value', '/competence_framework'],
    ]);
    expect(codes({ sdg: ['sdg04', 'sdg99'] })).toEqual([
      ['oecp.content.unknown_attribute_option', '/sdg/1'],
    ]);
    expect(codes({ sdg: 'sdg04' })).toEqual([['oecp.content.invalid_attribute_value', '/sdg']]);
    expect(codes({ sdg: [] })).toEqual([['oecp.content.invalid_attribute_value', '/sdg']]);
    expect(codes({ sdg: ['sdg04', 'sdg04'] })).toEqual([
      ['oecp.content.invalid_attribute_value', '/sdg'],
    ]);
    expect(codes({ faculty: 'x'.repeat(501) })).toEqual([
      ['oecp.content.invalid_attribute_value', '/faculty'],
    ]);
  });

  it('rejects every key when the alliance defines nothing', () => {
    expect(buildAttributesSchema([]).safeParse({}).success).toBe(true);
    expect(buildAttributesSchema([]).safeParse({ free_course: true }).success).toBe(false);
  });
});

describe('parseAttributeCell', () => {
  const def = (key: string) => DEFINITIONS.find((d) => d.key === key)!;

  it.each([
    ['true', true],
    ['Yes', true],
    ['1', true],
    ['FALSE', false],
    ['no', false],
    ['0', false],
    ['', null],
  ])('reads boolean %j', (cell, value) => {
    expect(parseAttributeCell(def('free_course'), cell)).toEqual({ ok: true, value });
  });

  it('reads multi_enum cells in option order without duplicates', () => {
    expect(parseAttributeCell(def('sdg'), ' sdg13 | sdg04 |sdg13')).toEqual({
      ok: true,
      value: ['sdg04', 'sdg13'],
    });
  });

  it('reports invalid cells', () => {
    expect(parseAttributeCell(def('free_course'), 'maybe')).toMatchObject({
      ok: false,
      code: 'oecp.content.invalid_attribute_value',
    });
    expect(parseAttributeCell(def('sdg'), 'sdg04|sdg18')).toEqual({
      ok: false,
      code: 'oecp.content.unknown_attribute_option',
      detail: 'sdg18',
    });
    expect(parseAttributeCell(def('competence_framework'), 'louis|none')).toMatchObject({
      ok: false,
      code: 'oecp.content.invalid_attribute_value',
    });
    expect(parseAttributeCell(def('competence_framework'), 'LOUIS')).toMatchObject({
      ok: false,
      code: 'oecp.content.unknown_attribute_option',
    });
  });
});

describe('attributeValueLabels', () => {
  it('labels options, booleans and texts; unknown options keep their value', () => {
    const def = (key: string) => DEFINITIONS.find((d) => d.key === key)!;
    expect(attributeValueLabels(def('sdg'), ['sdg13', 'zzz', 'sdg04'])).toEqual([
      { value: 'sdg04', label: { en: 'SDG 4: Quality education' } },
      { value: 'sdg13', label: { en: 'SDG 13: Climate action' } },
      { value: 'zzz', label: { en: 'zzz' } },
    ]);
    expect(attributeValueLabels(def('free_course'), false)).toEqual([
      { value: 'false', label: { en: 'No' } },
    ]);
    expect(attributeValueLabels(def('faculty'), 'Arts')).toEqual([
      { value: 'Arts', label: { en: 'Arts' } },
    ]);
    expect(attributeValueLabels(def('free_course'), 'true')).toEqual([]);
  });
});

describe('canonical DTOs (decision 18)', () => {
  const base = {
    ext_id: 'X',
    status: 'draft',
    ects: 5,
    texts: { en: { title: 'T' } },
  };

  it('defaults kind, levels and attributes', () => {
    expect(course.parse(base)).toMatchObject({ kind: 'course', levels: [], attributes: {} });
  });

  it('keeps level the first of levels', () => {
    expect(
      course.safeParse({ ...base, level: 'master', levels: ['master', 'bachelor'] }).success,
    ).toBe(true);
    expect(course.safeParse({ ...base, level: 'bachelor', levels: ['master'] }).success).toBe(
      false,
    );
    expect(course.safeParse({ ...base, levels: ['master', 'master'] }).success).toBe(false);
    expect(course.safeParse({ ...base, kind: 'seminar' }).success).toBe(false);
    expect(course.safeParse({ ...base, attributes: { Bad: true } }).success).toBe(false);
    expect(course.safeParse({ ...base, attributes: { ok_key: { nested: 1 } } }).success).toBe(
      false,
    );
  });

  it('resolves level and levels', () => {
    expect(resolveLevels('master', [])).toEqual({ level: 'master', levels: ['master'] });
    expect(resolveLevels('master', ['bachelor', 'master', 'bachelor'])).toEqual({
      level: 'bachelor',
      levels: ['bachelor', 'master'],
    });
    expect(resolveLevels(null, null)).toEqual({ level: null, levels: [] });
  });

  it('validates application instructions by primary language subtag', () => {
    const offering = {
      course_ext_id: 'X',
      ext_offering_id: 'O',
      status: 'draft',
      start_date: '2027-01-01',
      end_date: '2027-02-01',
      timezone: 'Europe/Madrid',
      teaching_languages: ['en'],
      delivery_modes: ['online'],
    };
    expect(courseOffering.parse(offering).application_instructions).toEqual({});
    expect(
      courseOffering.safeParse({ ...offering, application_instructions: { en: 'Apply.' } }).success,
    ).toBe(true);
    expect(
      courseOffering.safeParse({ ...offering, application_instructions: { 'en-GB': 'x' } }).success,
    ).toBe(false);
    expect(
      courseOffering.safeParse({ ...offering, application_instructions: { en: '' } }).success,
    ).toBe(false);
  });
});

describe('CSV template 1.1', () => {
  const COURSES =
    'template_version,course_code,status,ects,isced_codes,title_en,kind,levels,attr_sdg,attr_free_course,attr_competence_framework';
  const reference = { attributeDefinitions: DEFINITIONS };

  it('reads kind, levels and typed attr_<key> cells; empty cells remove the attribute', () => {
    const result = validateCsvText(
      'courses',
      `${COURSES}\n1.1,C1,draft,5,0613,T,bip,master | bachelor,sdg13|sdg04,yes,\n`,
      { referenceData: reference },
    );
    expect(result.errors).toEqual([]);
    expect(result.normalized[0]).toMatchObject({
      kind: 'bip',
      level: 'master',
      levels: ['master', 'bachelor'],
      attributes: { sdg: ['sdg04', 'sdg13'], free_course: true, competence_framework: null },
    });
  });

  it('keeps level as a single-valued column', () => {
    const result = validateCsvRows('courses', [
      {
        template_version: '1.0',
        course_code: 'C1',
        status: 'draft',
        ects: '5',
        isced_codes: '0613',
        title_en: 'T',
        level: 'master',
      },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.normalized[0]).toMatchObject({ level: 'master', levels: ['master'] });
    expect(result.normalized[0]!.kind).toBeUndefined();
    expect(result.normalized[0]!.attributes).toEqual({});
  });

  it('reports attribute errors per cell and unknown attribute columns once in the header', () => {
    const result = validateCsvText(
      'courses',
      `${COURSES},attr_hub\n1.1,C1,draft,5,0613,T,seminar,phd,sdg99,maybe,LOUIS,x\n`,
      { referenceData: reference },
    );
    const found = result.errors.map((e) => [e.code, e.row, e.column]);
    expect(found).toEqual(
      expect.arrayContaining([
        ['oecp.content.unknown_attribute', 1, 'attr_hub'],
        ['oecp.csv.invalid_kind', 2, 'kind'],
        ['oecp.csv.invalid_level', 2, 'levels'],
      ]),
    );
    const cells = validateCsvText(
      'courses',
      `${COURSES}\n1.1,C1,draft,5,0613,T,course,master,sdg99,maybe,LOUIS\n`,
      { referenceData: reference },
    );
    expect(cells.errors.map((e) => [e.code, e.row, e.column])).toEqual([
      ['oecp.content.unknown_attribute_option', 2, 'attr_sdg'],
      ['oecp.content.invalid_attribute_value', 2, 'attr_free_course'],
      ['oecp.content.unknown_attribute_option', 2, 'attr_competence_framework'],
    ]);
  });

  it('passes attr_<key> columns verbatim without definitions (the server revalidates)', () => {
    const result = validateCsvText('courses', `${COURSES}\n1.1,C1,draft,5,0613,T,,,x,maybe,\n`);
    expect(result.errors).toEqual([]);
    expect(result.normalized[0]).toMatchObject({
      kind: null,
      levels: null,
      level: null,
      attributes: { sdg: 'x', free_course: 'maybe', competence_framework: null },
    });
  });

  it('refuses level and levels together, and 1.1 columns in 1.0 rows', () => {
    const both = validateCsvText(
      'courses',
      'template_version,course_code,status,ects,isced_codes,title_en,level,levels\n1.1,C1,draft,5,0613,T,master,master\n',
    );
    expect(both.errors.map((e) => [e.code, e.row, e.column])).toEqual([
      ['oecp.csv.conflicting_columns', 1, 'level'],
    ]);
    const old = validateCsvText('courses', `${COURSES}\n1.0,C1,draft,5,0613,T,,,,,\n`, {
      referenceData: reference,
    });
    expect(old.errors.map((e) => [e.code, e.column])).toEqual([
      ['oecp.csv.invalid_template_version', 'template_version'],
    ]);
    expect(
      validateCsvText('courses', `${COURSES}\n1.2,C1,draft,5,0613,T,,,,,\n`).errors[0]?.code,
    ).toBe('oecp.csv.invalid_template_version');
  });

  it('reads application_instructions_<lang> columns of offerings', () => {
    const header =
      'template_version,course_code,offering_code,status,start_date,end_date,teaching_languages,delivery_modes,application_instructions_en,application_instructions_de';
    const result = validateCsvText(
      'offerings',
      `${header}\n1.1,C1,O1,draft,2027-01-01,2027-02-01,en,online,"Ask your office, then apply.",\n`,
    );
    expect(result.errors).toEqual([]);
    expect(result.normalized[0]!.application_instructions).toEqual({
      en: 'Ask your office, then apply.',
      de: null,
    });
    const unknown = validateCsvText(
      'offerings',
      `${header},application_notes\n1.1,C1,O1,draft,2027-01-01,2027-02-01,en,online,,,x\n`,
    );
    expect(unknown.errors.map((e) => [e.code, e.row, e.column])).toEqual([
      ['oecp.csv.unknown_column', 1, 'application_notes'],
    ]);
    const old = validateCsvText(
      'offerings',
      `${header}\n1.0,C1,O1,draft,2027-01-01,2027-02-01,en,online,x,\n`,
    );
    expect(old.errors.map((e) => e.code)).toEqual(['oecp.csv.invalid_template_version']);
  });

  it('generates a 1.1 courses template with one attr_<key> column per definition', () => {
    const text = csvTemplate('courses', { attributeDefinitions: DEFINITIONS });
    const result = validateCsvFiles(
      { courses: text },
      { referenceData: { ...reference, iscedCodes: ['05', '03'] } },
    );
    expect(result.courses?.errors).toEqual([]);
    expect(result.courses?.parsed.header.slice(-4)).toEqual([
      'attr_free_course',
      'attr_sdg',
      'attr_competence_framework',
      'attr_faculty',
    ]);
    expect(result.courses?.normalized[0]).toMatchObject({
      levels: ['bachelor', 'master'],
      attributes: {
        free_course: false,
        sdg: ['sdg04', 'sdg13'],
        competence_framework: 'louis',
        faculty: null,
      },
    });
  });
});
