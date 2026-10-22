<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# The administrator lifecycle: decisions and defaults

How an administrator account comes into OACC, how it is used and how it
leaves, with the choices the alliance has at each step and the configuration
OACC ships with. Written for the alliance office and the hosting operator;
the step-by-step screens are in [Guide A](alliance.md) (steps 3, 8 and 9) and
the technical detail in [spec v4.1 §2](../spec-v4.1.md#2-actors-and-roles).
Decisions: [DL 22](../decisions-log.md) (sign-in mode), [DL 23] (audit
retention), [DL 26] (dormancy, clean-up and recertification during the pilot).

## The lifecycle on one page

```
invite ──▶ accept (first sign-in, MFA) ──▶ active administrator
                                              │
                                              ├─ removed by an alliance admin  ──┐
                                              └─ dormant (no activity N days) ───┤ roles removed, sessions ended
                                                                                 │ Keycloak account kept
                                                                                 ▼
                                                      account deleted M months after the removal
```

| Step | Who | What OACC does | Where |
|---|---|---|---|
| **Invite** | alliance admin | E-mails a personal link (default 7 days, at most 168 h; *Resend* replaces it, *Revoke* stops it). Refused when the organization's identity provider is not enabled in Keycloak. | *Invitations*, organization page |
| **Accept** | the invitee | Signs in in the organization's mode ([DL 22]: local account with password and TOTP, or the university's IdP plus TOTP), the e-mail must match; gets the role and the organization. | `/en/admin/accept` |
| **Use** | the administrator | Every admin API request stamps the account's last activity (at most once an hour, no IP address); Keycloak keeps sign-in events 90 days. | *Administrators* panel shows the last sign-in |
| **Remove** | alliance admin | *Remove* takes the roles away and ends the sessions; never yourself, never the last alliance admin. The Keycloak account stays. | organization page > *Administrators* |
| **Dormancy** | the `dormancy` job, daily 05:00 UTC | Same effect as *Remove* for every administrator with no activity for `OECP_DORMANCY_DAYS`; the last alliance admin is always kept. | *Maintenance* page, job `dormancy` |
| **Account clean-up** | the `account-cleanup` job, daily 05:15 UTC | Deletes the Keycloak account `OECP_ACCOUNT_DELETE_MONTHS` after the roles were removed, unless the person was invited again, used the account or still holds a role. | *Maintenance* page, job `account-cleanup` |
| **Recertification** | the alliance, yearly | Not built: a manual review (below). | *Administrators* panels |

Every step is audited (`invitation.*`, `admin.revoke`, `admin.dormant_revoke`,
`admin.account_deleted`); the audit rows keep the invited or revoked person's
e-mail address for 36 months [DL 23] and the deletion rows carry the Keycloak
user id only.

**Lost password or authenticator (local accounts).** While the set-up is pending, the organization's *Administrators* panel offers *Resend set-up e-mail*. Once the account is set up, OACC has no self-service reset (no open "forgot password", decision 22): the hosting operator resets the credential in the Keycloak admin console (runbook [§6](../production/runbook.md#6-identity-operations)), or an alliance admin *removes* the administrator and invites them again, which creates a fresh set-up e-mail. Federated accounts are reset by the university.

## Defaults as shipped

| Variable (`deploy/compose/.env`) | Default | Meaning |
|---|---|---|
| `OECP_DORMANCY_DAYS` | `180` | Days without activity before an administrator counts as dormant (30 to 3 650) |
| `OECP_DORMANCY_DRY_RUN` | `true` | The job only **reports** the administrators it would revoke |
| `OECP_ACCOUNT_DELETE_MONTHS` | `12` | Months after the role removal before the Keycloak account is deleted (never more than `OECP_RETENTION_AUDIT_MONTHS`, 36) |
| `OECP_ACCOUNT_CLEANUP_DRY_RUN` | `true` | The job only **reports** the accounts it would delete |

With these defaults nothing is revoked or deleted automatically: both jobs
run every day, record what they *would* do, and the *Maintenance* page shows
it (filter on the job, *Show details*). Activity before the upgrade that
introduced the jobs does not count, so the first dormant administrators can
appear 180 days after that upgrade at the earliest.

## The choices

**Dormancy: keep the dry run or switch it on.** Dry run is the safe start:
nobody loses access without a person looking at the list. Switching it on
(`OECP_DORMANCY_DRY_RUN=false`, then recreate `worker`) makes the rule bind:
an administrator who has not used OACC for six months loses the role and must
be re-invited. Shorter periods (90 days) suit an alliance where every
administrator works in OACC monthly; longer ones (365 days) suit a catalogue
updated once a year. Whatever the period, the *Administrators* panel still
shows the last sign-in, and *Remove* works at any time.

**Account clean-up: keep the dry run or switch it on.** Only meaningful once
dormancy or manual removals have happened. Switching it on
(`OECP_ACCOUNT_CLEANUP_DRY_RUN=false`) is what makes the retention the RoPA
declares ("accounts deleted 12 months after the last role removal") actually
happen; while it is a dry run the accounts stay in Keycloak. Deleting an
account loses nothing the person needs: a new invitation creates a new one.

**Recertification: whether to build it.** The alliance confirms once a year
that every administrator should still have access, including the active ones
(a person who changed job but keeps signing in is invisible to dormancy).
Options:

1. *Manual review* (available today): once a year, the alliance office opens
   every organization's *Administrators* panel, confirms each name with the
   partner's Aurora office and removes the others; the review is noted in
   the runbook's yearly housekeeping.
2. *Built-in campaign* (not built, backlog): an annual e-mail to the alliance
   office listing every administrator per organization, with *Confirm* and
   *Revoke* per row, audited; the uncertified are revoked after a grace
   period.
3. *Delegated campaign* (not built): as 2, but each partner certifies its own
   administrators.

## Decision for the pilot ([DL 26], 2026-10-15)

- Both jobs **stay in dry run** during the pilot; the alliance reviews the
  dry runs quarterly (runbook §11) and the Foundation decides the switch
  before the portal opens to the Internet, with the go-live checklist of
  Guide A.
- Periods unchanged: 180 days, 12 months.
- Recertification: **option 1, manual**, yearly with the Foundation; options
  2 and 3 stay in the backlog until the number of real administrators makes
  the manual review impractical (more than a dozen or so).

To change the decision later: edit the two `DRY_RUN` variables in `.env`,
`docker compose up -d worker`, and check the next run on the *Maintenance*
page; record the change in the decisions log.
