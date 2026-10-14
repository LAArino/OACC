// SPDX-License-Identifier: EUPL-1.2
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { issuesToProblemErrors, organization } from '@oecp/schemas';
import { sql } from 'kysely';
import { z } from 'zod';
import { type Db, KYSELY } from '../db/db.module.js';
import { type CliOutput, EXIT, type ExitCode, type SeedOrganizationsOptions } from './program.js';

/** One organization of a seed file: the canonical shape, top-level only (no parent). */
export const organizationSeed = z.strictObject(organization.omit({ parent_id: true }).shape);
export type OrganizationSeed = z.output<typeof organizationSeed>;

/** Seed file: `{ "$comment"?: ..., "organizations": [...] }`, slugs unique. */
export const organizationSeedFile = z
  .strictObject({
    $comment: z.union([z.string(), z.array(z.string())]).optional(),
    organizations: z.array(organizationSeed).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.organizations.forEach((org, index) => {
      if (seen.has(org.slug)) {
        ctx.addIssue({
          code: 'custom',
          path: ['organizations', index, 'slug'],
          message: `Duplicate slug ${org.slug}`,
        });
      }
      seen.add(org.slug);
    });
  });

export interface SeedResult {
  created: string[];
  updated: string[];
  unchanged: string[];
}

/** Columns written from the seed file; `id`, `parent_id`, timestamps are never touched. */
const SEEDED_COLUMNS = [
  'org_type',
  'is_partner',
  'name',
  'schac_home_organization',
  'erasmus_code',
  'pic',
  'country_code',
  'website_url',
  'logo_url',
  'contact_email',
  'default_timezone',
  'ui_languages',
  'ext_id',
  'keycloak_idp_alias',
] as const;

/** `oecp seed-organizations`: idempotent upsert by slug in one transaction. */
@Injectable()
export class SeedOrganizationsCommand {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  async run(options: SeedOrganizationsOptions, output: CliOutput): Promise<ExitCode> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(options.file, 'utf8'));
    } catch (error) {
      output.writeErr(`Cannot read seed file ${options.file}: ${(error as Error).message}\n`);
      return EXIT.FAILURE;
    }
    const parsed = organizationSeedFile.safeParse(raw);
    if (!parsed.success) {
      output.writeErr(`Invalid seed file ${options.file}:\n`);
      for (const e of issuesToProblemErrors(parsed.error.issues)) {
        output.writeErr(`  ${e.pointer ?? '/'}: ${e.message}\n`);
      }
      return EXIT.FAILURE;
    }

    const seeds = parsed.data.organizations;
    if (options.dryRun) {
      const existing = new Set(
        (
          await this.db
            .selectFrom('organizations')
            .select('slug')
            .where(
              'slug',
              'in',
              seeds.map((s) => s.slug),
            )
            .execute()
        ).map((r) => r.slug),
      );
      for (const seed of seeds) {
        output.writeOut(
          `${existing.has(seed.slug) ? 'would update' : 'would create'}  ${seed.slug}\n`,
        );
      }
      output.writeOut(`dry run: ${seeds.length} organizations valid, nothing written\n`);
      return EXIT.OK;
    }

    const result = await this.upsert(seeds);
    for (const [label, slugs] of Object.entries(result)) {
      for (const slug of slugs) output.writeOut(`${label.padEnd(9)}  ${slug}\n`);
    }
    output.writeOut(
      `organizations: ${seeds.length} (created ${result.created.length}, ` +
        `updated ${result.updated.length}, unchanged ${result.unchanged.length})\n`,
    );
    return EXIT.OK;
  }

  async upsert(seeds: readonly OrganizationSeed[]): Promise<SeedResult> {
    const result: SeedResult = { created: [], updated: [], unchanged: [] };
    const current = sql.join(SEEDED_COLUMNS.map((c) => sql.ref(`organizations.${c}`)));
    const incoming = sql.join(SEEDED_COLUMNS.map((c) => sql.ref(`excluded.${c}`)));

    await this.db.transaction().execute(async (trx) => {
      for (const seed of seeds) {
        // DDL: a partner is its own partner (partner_id = id), so the id is chosen here.
        const id = randomUUID();
        const row = await trx
          .insertInto('organizations')
          .values({
            id,
            partner_id: seed.is_partner ? id : null,
            org_type: seed.org_type,
            is_partner: seed.is_partner,
            slug: seed.slug,
            name: seed.name,
            schac_home_organization: seed.schac_home_organization ?? null,
            erasmus_code: seed.erasmus_code ?? null,
            pic: seed.pic ?? null,
            country_code: seed.country_code ?? null,
            website_url: seed.website_url ?? null,
            logo_url: seed.logo_url ?? null,
            contact_email: seed.contact_email ?? null,
            default_timezone: seed.default_timezone,
            ui_languages: seed.ui_languages,
            ext_id: seed.ext_id ?? null,
            keycloak_idp_alias: seed.keycloak_idp_alias ?? null,
          })
          .onConflict((oc) =>
            oc
              .column('slug')
              .doUpdateSet((eb) => ({
                org_type: eb.ref('excluded.org_type'),
                is_partner: eb.ref('excluded.is_partner'),
                name: eb.ref('excluded.name'),
                schac_home_organization: eb.ref('excluded.schac_home_organization'),
                erasmus_code: eb.ref('excluded.erasmus_code'),
                pic: eb.ref('excluded.pic'),
                country_code: eb.ref('excluded.country_code'),
                website_url: eb.ref('excluded.website_url'),
                logo_url: eb.ref('excluded.logo_url'),
                contact_email: eb.ref('excluded.contact_email'),
                default_timezone: eb.ref('excluded.default_timezone'),
                ui_languages: eb.ref('excluded.ui_languages'),
                ext_id: eb.ref('excluded.ext_id'),
                keycloak_idp_alias: eb.ref('excluded.keycloak_idp_alias'),
                partner_id: sql<string | null>`CASE
                  WHEN excluded.is_partner THEN organizations.id
                  WHEN organizations.partner_id = organizations.id THEN NULL
                  ELSE organizations.partner_id END`,
              }))
              // Leave identical rows alone (no updated_at bump, reported as unchanged).
              .where(sql<boolean>`(${current}) IS DISTINCT FROM (${incoming})`),
          )
          .returning(sql<boolean>`xmax = 0`.as('inserted'))
          .executeTakeFirst();
        if (!row) result.unchanged.push(seed.slug);
        else if (row.inserted) result.created.push(seed.slug);
        else result.updated.push(seed.slug);
      }
    });
    return result;
  }
}
