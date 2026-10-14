// SPDX-License-Identifier: EUPL-1.2
import { sql } from 'kysely';
import type { Db } from '../db/db.module.js';

/**
 * Teaching units an organization's courses may reference (`courses.teaching_unit_id`):
 * its non-deleted descendants (`parent_id` chain) that carry an `ext_id`, keyed by
 * that `ext_id`. Sub-units come from CSV or the form (spec §6.2.4).
 */
export async function teachingUnits(db: Db, organizationId: string): Promise<Map<string, string>> {
  const { rows } = await sql<{ id: string; ext_id: string }>`
    with recursive descendants(id, depth) as (
      select id, 0 from organizations where id = ${organizationId}
      union all
      select o.id, d.depth + 1
      from organizations o join descendants d on o.parent_id = d.id
      where d.depth < 32
    )
    select o.id, o.ext_id
    from organizations o join descendants d on d.id = o.id
    where o.id <> ${organizationId} and o.ext_id is not null and o.deleted_at is null
    order by d.depth, o.created_at`.execute(db);
  const units = new Map<string, string>();
  for (const row of rows) if (!units.has(row.ext_id)) units.set(row.ext_id, row.id);
  return units;
}
