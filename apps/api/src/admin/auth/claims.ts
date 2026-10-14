// SPDX-License-Identifier: EUPL-1.2
/** Access-token claims contract between Keycloak and the API (spec §4). */
import { type AdminRole, adminRole } from '@oecp/schemas';
import { z } from 'zod';

export const ADMIN_AUDIENCE = 'oecp-api';
export const ADMIN_AUTHORIZED_PARTY = 'oecp-admin';
export const REQUIRED_ACR = 'mfa';
export const LOCAL_IDP = 'local';
export const CLOCK_TOLERANCE_SECONDS = 30;

export const adminClaims = z.object({
  iss: z.string(),
  sub: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  azp: z.string(),
  acr: z.string(),
  exp: z.number(),
  iat: z.number(),
  auth_time: z.number().optional(),
  sid: z.string().optional(),
  /** Flat array of realm roles; anything that is not an OECP role is ignored. */
  roles: z
    .array(z.string())
    .default([])
    .transform((roles) => roles.filter((r): r is AdminRole => adminRole.safeParse(r).success)),
  org_id: z.uuid().optional(),
  idp: z.string().min(1),
  email: z.string().optional(),
  name: z.string().optional(),
});
export type AdminClaims = z.infer<typeof adminClaims>;

/** Authenticated administrator attached to the request by `AdminJwtGuard`. */
export interface AdminPrincipal {
  sub: string;
  roles: AdminRole[];
  /** Absent only on the role-less invitation acceptance call. */
  orgId: string | undefined;
  idp: string;
  email: string | undefined;
  name: string | undefined;
}
