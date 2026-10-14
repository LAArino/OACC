// SPDX-License-Identifier: EUPL-1.2
import { Inject, Injectable } from '@nestjs/common';
import { type Db, KYSELY } from '../../db/db.module.js';

export interface OrganizationRef {
  id: string;
  keycloak_idp_alias: string | null;
}

export interface OrganizationDirectory {
  /** Returns the organization unless it does not exist or is soft-deleted. */
  findActive(id: string): Promise<OrganizationRef | undefined>;
}

export const ORGANIZATION_DIRECTORY = Symbol('ORGANIZATION_DIRECTORY');

@Injectable()
export class KyselyOrganizationDirectory implements OrganizationDirectory {
  constructor(@Inject(KYSELY) private readonly db: Db) {}

  findActive(id: string): Promise<OrganizationRef | undefined> {
    return this.db
      .selectFrom('organizations')
      .select(['id', 'keycloak_idp_alias'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }
}
