// SPDX-License-Identifier: EUPL-1.2
import { readFile } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import {
  type AttributeDefinition,
  attributeDefinition,
  issuesToProblemErrors,
} from '@oecp/schemas';
import { sql } from 'kysely';
import { z } from 'zod';
import { type Db, KYSELY } from '../db/db.module.js';
import {
  type CliOutput,
  EXIT,
  type ExitCode,
  type SeedAttributeDefinitionsOptions,
} from './program.js';

/** Seed file: `{ "$comment"?: ..., "attribute_definitions": [...] }`, keys unique. */
export const attributeDefinitionSeedFile = z
  .strictObject({
    $comment: z.union([z.string(), z.array(z.string())]).optional(),
    attribute_definitions: z.array(attributeDefinition).min(1).max(100),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.attribute_definitions.forEach((d, index) => {
      if (seen.has(d.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['attribute_definitions', index, 'key'],
          message: `Duplicate key ${d.key}`,
        });
      }
      seen.add(d.key);
    });
  });

export interface AttributeSeedResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Keys in the database but not in the file: left as they are (never deleted). */
  kept: string[];
}

const COLUMNS = [
  'value_type',
  'label',
  'description',
  'options',
  'filterable',
  'show_as_tag',
  'sort_order',
] as const;

/**
 * `oecp seed-attribute-definitions`: idempotent upsert by key in one transaction
 * (decision 18). Definitions absent from the file are kept: courses may still
 * carry their values, so removing one is a deliberate SQL operation.
 */
@Injectable()
export class SeedAttributeDefinitionsCommand {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  async run(options: SeedAttributeDefinitionsOptions, output: CliOutput): Promise<ExitCode> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(options.file, 'utf8'));
    } catch (error) {
      output.writeErr(`Cannot read seed file ${options.file}: ${(error as Error).message}\n`);
      return EXIT.FAILURE;
    }
    const parsed = attributeDefinitionSeedFile.safeParse(raw);
    if (!parsed.success) {
      output.writeErr(`Invalid seed file ${options.file}:\n`);
      for (const e of issuesToProblemErrors(parsed.error.issues)) {
        output.writeErr(`  ${e.pointer ?? '/'}: ${e.message}\n`);
      }
      return EXIT.FAILURE;
    }

    const definitions = parsed.data.attribute_definitions;
    if (options.dryRun) {
      const existing = new Set(
        (await this.db.selectFrom('attribute_definitions').select('key').execute()).map(
          (r) => r.key,
        ),
      );
      for (const d of definitions) {
        output.writeOut(`${existing.has(d.key) ? 'would update' : 'would create'}  ${d.key}\n`);
      }
      output.writeOut(
        `dry run: ${definitions.length} attribute definitions valid, nothing written\n`,
      );
      return EXIT.OK;
    }

    const result = await this.upsert(definitions);
    for (const [label, keys] of Object.entries(result)) {
      for (const key of keys) output.writeOut(`${label.padEnd(9)}  ${key}\n`);
    }
    output.writeOut(
      `attribute definitions: ${definitions.length} (created ${result.created.length}, ` +
        `updated ${result.updated.length}, unchanged ${result.unchanged.length}, ` +
        `kept ${result.kept.length})\n`,
    );
    return EXIT.OK;
  }

  async upsert(definitions: readonly AttributeDefinition[]): Promise<AttributeSeedResult> {
    const result: AttributeSeedResult = { created: [], updated: [], unchanged: [], kept: [] };
    const current = sql.join(COLUMNS.map((c) => sql.ref(`attribute_definitions.${c}`)));
    const incoming = sql.join(COLUMNS.map((c) => sql.ref(`excluded.${c}`)));
    await this.db.transaction().execute(async (trx) => {
      for (const d of definitions) {
        const row = await trx
          .insertInto('attribute_definitions')
          .values({
            key: d.key,
            value_type: d.value_type,
            label: d.label,
            description: d.description,
            // jsonb arrays must be serialised explicitly (pg would send a PostgreSQL array).
            options: (d.options === null ? null : JSON.stringify(d.options)) as never,
            filterable: d.filterable,
            show_as_tag: d.show_as_tag,
            sort_order: d.sort_order,
          })
          .onConflict((oc) =>
            oc
              .column('key')
              .doUpdateSet((eb) => ({
                value_type: eb.ref('excluded.value_type'),
                label: eb.ref('excluded.label'),
                description: eb.ref('excluded.description'),
                options: eb.ref('excluded.options'),
                filterable: eb.ref('excluded.filterable'),
                show_as_tag: eb.ref('excluded.show_as_tag'),
                sort_order: eb.ref('excluded.sort_order'),
              }))
              .where(sql<boolean>`(${current}) IS DISTINCT FROM (${incoming})`),
          )
          .returning(sql<boolean>`xmax = 0`.as('inserted'))
          .executeTakeFirst();
        if (!row) result.unchanged.push(d.key);
        else if (row.inserted) result.created.push(d.key);
        else result.updated.push(d.key);
      }
      const keys = definitions.map((d) => d.key);
      result.kept = (
        await trx
          .selectFrom('attribute_definitions')
          .select('key')
          .where('key', 'not in', keys)
          .orderBy('key')
          .execute()
      ).map((r) => r.key);
    });
    return result;
  }
}
