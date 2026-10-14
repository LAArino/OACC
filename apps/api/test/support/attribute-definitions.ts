// SPDX-License-Identifier: EUPL-1.2
/** Aurora's attribute definitions (db/seed) for tests, and a helper to seed them. */
import { readFileSync } from 'node:fs';
import type { AttributeDefinition } from '@oecp/schemas';
import type { Kysely } from 'kysely';
import {
  attributeDefinitionSeedFile,
  SeedAttributeDefinitionsCommand,
} from '../../src/cli/seed-attribute-definitions.js';
import type { Database } from '../../src/db/database.js';

export const AURORA_ATTRIBUTE_DEFINITIONS: AttributeDefinition[] =
  attributeDefinitionSeedFile.parse(
    JSON.parse(
      readFileSync(
        new URL('../../db/seed/attribute-definitions.aurora.json', import.meta.url),
        'utf8',
      ),
    ),
  ).attribute_definitions;

/** Upserts Aurora's definitions, as `oecp seed-attribute-definitions` does. */
export async function seedAttributeDefinitions(db: Kysely<Database>): Promise<void> {
  await new SeedAttributeDefinitionsCommand(db).upsert(AURORA_ATTRIBUTE_DEFINITIONS);
}
