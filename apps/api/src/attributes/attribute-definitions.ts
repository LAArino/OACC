// SPDX-License-Identifier: EUPL-1.2
import type { AttributeDefinition } from '@oecp/schemas';
import type { Db } from '../db/db.module.js';

/**
 * The alliance's attribute definitions (decision 18), by `sort_order` then key.
 * One alliance per deployment: the table holds exactly its definitions.
 */
export async function loadAttributeDefinitions(db: Db): Promise<AttributeDefinition[]> {
  const rows = await db
    .selectFrom('attribute_definitions')
    .select([
      'key',
      'value_type',
      'label',
      'description',
      'options',
      'filterable',
      'show_as_tag',
      'sort_order',
    ])
    .orderBy('sort_order')
    .orderBy('key')
    .execute();
  return rows.map((r) => ({
    key: r.key,
    value_type: r.value_type,
    label: r.label,
    description: r.description,
    options: r.options,
    filterable: r.filterable,
    show_as_tag: r.show_as_tag,
    sort_order: r.sort_order,
  }));
}
