// SPDX-License-Identifier: EUPL-1.2
// Client of the administration endpoints of `/api/admin/v1` (spec §2.1, §8):
// invitations, integration settings and actions, organizations, administrators
// and the alliance network status. Every call carries the in-memory bearer token
// (useAdminApi) and fails with AdminApiError.
import type {
  AdminAccountList,
  AdminIntegration,
  AdminIntegrationInput,
  AdminInvitation,
  AdminInvitationInput,
  AdminInvitationList,
  AdminNetworkStatus,
  AdminOrganizationInput,
  AdminOrganizationList,
  AdminOrganizationRecord,
  AdminSyncNowResponse,
  AdminTestConnectionResult,
} from '~/types/admin';
import type { AdminRawResponse } from './useAdminApi';

const BASE = '/api/admin/v1';
const seg = (value: string) => encodeURIComponent(value);
const org = (orgId: string) => `${BASE}/organizations/${seg(orgId)}`;

export function useAdminAllianceApi() {
  const api = useAdminApi();
  const body = (value: object) => value as Record<string, unknown>;

  return {
    // Invitations ---------------------------------------------------------------
    listInvitations(orgId: string): Promise<AdminInvitationList> {
      return api<AdminInvitationList>(`${org(orgId)}/invitations`);
    },
    createInvitation(orgId: string, input: AdminInvitationInput): Promise<AdminInvitation> {
      return api<AdminInvitation>(`${org(orgId)}/invitations`, {
        method: 'POST',
        body: body(input),
      });
    },
    revokeInvitation(id: string): Promise<void> {
      return api<void>(`${BASE}/invitations/${seg(id)}`, { method: 'DELETE' });
    },
    /** Issues a new invitation (new token, new e-mail) replacing `id`. */
    resendInvitation(id: string): Promise<AdminInvitation> {
      return api<AdminInvitation>(`${BASE}/invitations/${seg(id)}/resend`, { method: 'POST' });
    },

    // Integration ---------------------------------------------------------------
    getIntegration(orgId: string): Promise<AdminIntegration> {
      return api<AdminIntegration>(`${org(orgId)}/integration`);
    },
    saveIntegration(orgId: string, input: AdminIntegrationInput): Promise<AdminIntegration> {
      return api<AdminIntegration>(`${org(orgId)}/integration`, {
        method: 'PUT',
        body: body(input),
      });
    },
    approveHost(orgId: string): Promise<AdminIntegration> {
      return api<AdminIntegration>(`${org(orgId)}/integration/approve-host`, { method: 'POST' });
    },
    testConnection(orgId: string): Promise<AdminTestConnectionResult> {
      return api<AdminTestConnectionResult>(`${org(orgId)}/integration/test-connection`, {
        method: 'POST',
      });
    },
    syncNow(orgId: string): Promise<AdminRawResponse<AdminSyncNowResponse>> {
      return api.raw<AdminSyncNowResponse>(`${org(orgId)}/integration/sync-now`, {
        method: 'POST',
      });
    },

    // Organizations -------------------------------------------------------------
    /** `includeDeleted` also lists soft-deleted organizations (`include_deleted=true`). */
    listOrganizations(options: { includeDeleted?: boolean } = {}): Promise<AdminOrganizationList> {
      return api<AdminOrganizationList>(
        `${BASE}/organizations`,
        options.includeDeleted ? { query: { include_deleted: 'true' } } : {},
      );
    },
    getOrganization(id: string): Promise<AdminOrganizationRecord> {
      return api<AdminOrganizationRecord>(org(id));
    },
    createOrganization(input: AdminOrganizationInput): Promise<AdminOrganizationRecord> {
      return api<AdminOrganizationRecord>(`${BASE}/organizations`, {
        method: 'POST',
        body: body(input),
      });
    },
    updateOrganization(
      id: string,
      input: AdminOrganizationInput,
    ): Promise<AdminOrganizationRecord> {
      return api<AdminOrganizationRecord>(org(id), { method: 'PUT', body: body(input) });
    },
    deleteOrganization(id: string): Promise<void> {
      return api<void>(org(id), { method: 'DELETE' });
    },
    restoreOrganization(id: string): Promise<AdminOrganizationRecord> {
      return api<AdminOrganizationRecord>(`${org(id)}/restore`, { method: 'POST' });
    },

    // Administrators ------------------------------------------------------------
    listAdmins(orgId: string): Promise<AdminAccountList> {
      return api<AdminAccountList>(`${org(orgId)}/admins`);
    },
    removeAdmin(orgId: string, sub: string): Promise<void> {
      return api<void>(`${org(orgId)}/admins/${seg(sub)}`, { method: 'DELETE' });
    },
    resendSetup(orgId: string, sub: string): Promise<void> {
      return api<void>(`${org(orgId)}/admins/${seg(sub)}/resend-setup`, { method: 'POST' });
    },

    // Network -------------------------------------------------------------------
    networkStatus(): Promise<AdminNetworkStatus> {
      return api<AdminNetworkStatus>(`${BASE}/network-status`);
    },
  };
}
