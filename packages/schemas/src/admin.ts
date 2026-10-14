// SPDX-License-Identifier: EUPL-1.2
/** Request and response contracts of the admin API `/api/admin/v1` (spec §2.1, §4, §8). */
import { z } from 'zod';
import { adminRole } from './enums.js';
import { email, uuid } from './primitives.js';

/** 256-bit random invitation token, base64url without padding (43 characters). */
export const invitationToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Spec §2.1: invitations are valid 7 days; the bootstrap link 24 hours. */
export const INVITATION_DEFAULT_TTL_HOURS = 168;
export const INVITATION_MAX_TTL_HOURS = 168;

/** `POST /api/admin/v1/invitations/accept` */
export const acceptInvitationRequest = z.strictObject({ token: invitationToken });
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequest>;

export const acceptInvitationResponse = z.object({
  role: adminRole,
  org_id: uuid,
  /** Always true: the current access token has no role yet; the client must log in again. */
  relogin_required: z.literal(true),
});
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponse>;

/** `POST /api/admin/v1/invitations` (alliance_admin). */
export const createInvitationRequest = z.strictObject({
  email: email.transform((v) => v.toLowerCase()),
  role: adminRole,
  organization_id: uuid,
  ttl_hours: z.int().min(1).max(INVITATION_MAX_TTL_HOURS).default(INVITATION_DEFAULT_TTL_HOURS),
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequest>;

/**
 * `POST /api/admin/v1/organizations/{orgId}/invitations` (alliance_admin): the
 * same as `POST /invitations` with the organization taken from the path.
 */
export const createOrganizationInvitationRequest = createInvitationRequest.omit({
  organization_id: true,
});
export type CreateOrganizationInvitationRequest = z.infer<
  typeof createOrganizationInvitationRequest
>;

/**
 * `POST /api/admin/v1/invitations/{id}/resend` (alliance_admin): revokes the
 * invitation (unless already revoked) and sends a new one with the same e-mail,
 * role and organization. `ttl_hours` defaults to the lifetime of the original.
 */
export const resendInvitationRequest = z.strictObject({
  ttl_hours: z.int().min(1).max(INVITATION_MAX_TTL_HOURS).optional(),
});
export type ResendInvitationRequest = z.infer<typeof resendInvitationRequest>;

/**
 * Members of the acceptance link fragment
 * `{OECP_PUBLIC_BASE_URL}/{locale}/admin/accept#token=<token>[&idp=<alias>]`:
 * `idp` is the organization's Keycloak IdP alias, present only for brokered
 * organizations; the accept page sends it as `kc_idp_hint`.
 */
export const INVITATION_LINK_PARAMS = { token: 'token', idp: 'idp' } as const;

export const invitationStatus = z.enum(['pending', 'accepted', 'revoked', 'expired']);
export type InvitationStatus = z.infer<typeof invitationStatus>;

/** An invitation as returned by the API; the token and its hash are never returned. */
export const invitation = z.object({
  id: uuid,
  email: z.string(),
  role: adminRole,
  organization_id: uuid,
  invited_by: z.string(),
  status: invitationStatus,
  expires_at: z.iso.datetime({ offset: true }),
  accepted_at: z.iso.datetime({ offset: true }).nullable(),
  accepted_sub: z.string().nullable(),
  revoked_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
});
export type Invitation = z.infer<typeof invitation>;

/** `GET /api/admin/v1/invitations` and `GET /api/admin/v1/organizations/{orgId}/invitations` */
export const invitationList = z.object({ items: z.array(invitation) });
export type InvitationList = z.infer<typeof invitationList>;

/** `GET /api/admin/v1/me`: the signed-in administrator; `roles` may be empty before acceptance. */
export const adminMe = z.object({
  sub: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  roles: z.array(adminRole),
  org_id: uuid.nullable(),
  idp: z.string(),
});
export type AdminMe = z.infer<typeof adminMe>;
