<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Sign-in paths: federated (eduGAIN) or local accounts

Each organization signs in **one** way, decided by its *Identity provider alias* (`keycloak_idp_alias`) [DL 22]:

- **Local accounts** (alias `null`): Keycloak accounts with a password of at least 12 characters plus a TOTP app, set up from the e-mail Keycloak sends at invitation time. No self-registration and no self-service password reset.
- **Federated** (alias = the organization slug): SAML sign-in through the university's identity provider (IdP) in eduGAIN, brokered by Keycloak, plus a TOTP app that OECP enrols after the first sign-in.

There is no mixed mode: some administrators local and others federated within one organization is not supported and not planned. Both modes reach the same level of authentication (`acr=mfa`) at every sign-in and give the same roles and screens. This page puts the two onboarding paths side by side, with who does what and when. The rule is [decision 22](../decisions-log.md); the technical detail is [spec §4](../spec-v4.1.md#4-identity) and [identity/keycloak/README.md](../../identity/keycloak/README.md#sign-in-mode-per-organization-dl-22). Roles as in the [onboarding README](README.md): alliance administrator, hosting operator, the partner's identity team (partner IT), partner administrator.

## Which mode for a university

| The university | Mode | Alias | How long |
|---|---|---|---|
| Is in eduGAIN **and** its IdP releases the required attributes (`mail`, `givenName`, `sn`, `schacHomeOrganization`, and `subject-id` or `pairwise-id`), through REFEDS Personalized Access or an equivalent attribute release, **and** the IdP has been connected and tested by the hosting operator | Federated | slug | As long as the IdP keeps releasing them |
| Is in eduGAIN, but its IdP does not release those attributes, or is not connected and tested yet | Local for now | `null` | Until the IdP qualifies; then [move to federated](#moving-from-local-to-federated) |
| Is not in eduGAIN, or sits behind a hub federation that OECP cannot reach | Local | `null` | Permanent |
| The alliance organization | Local | `null` | Permanent |

In the Aurora seed, `aurora` and `upec` are local; the seed file sets the alias to the slug for the other seven universities, but none of their IdPs is connected in 0.10.0 (see [Known limits](#known-limits-in-0100)).

**Local is a full, permanent mode, not a stopgap.** A university outside eduGAIN stays on local accounts for good; it loses nothing but the single sign-on with its own login. Choose local also when a university in eduGAIN cannot release the attributes: OECP needs them to check the invited person at acceptance (the e-mail, the IdP and the asserted `schacHomeOrganization` must match, otherwise `oecp.invitation.mismatch`), and the principal attribute cannot be changed later without orphaning that IdP's users ([Adding a partner IdP](../../identity/keycloak/README.md#adding-a-partner-idp), step 4).

## The two paths, step by step

| Step | Who | Federated (alias = slug) | Local (alias `null`) | Where documented |
|---|---|---|---|---|
| **Day 0: federation** (once per deployment) | alliance (Foundation), hosting operator | Register one SAML service provider, entity ID `https://<auth host>/realms/oecp`, in the hosting institution's national federation with export to eduGAIN (Aurora: SIR/RedIRIS [DL 15]), requesting REFEDS Personalized Access, REFEDS CoCo v2 and Sirtfi | Not needed | [Guide A §3](alliance.md#3-identity) ("Federation registration") |
| **Day 0: metadata exchange** (per university) | hosting operator, partner identity team | Send the SP entity ID, the per-IdP descriptor `https://<auth host>/realms/oecp/broker/<alias>/endpoint/descriptor` and the requested attributes; receive the IdP's metadata ([list below](#what-your-identity-team-must-provide)) | Not needed | [Guide E §1.1](hosting-operator.md#11-what-to-ask-for-and-decide) (row "Identity provider"), [§2.13](hosting-operator.md#213-connect-an-identity-provider) step 1 |
| **Organization seed** | hosting operator (seed) or alliance administrator (*Organizations* page) | `schac_home_organization` verified against the federation metadata; `keycloak_idp_alias` `null` until the IdP is enabled and tested (set later, row below) | `keycloak_idp_alias` `null`; `schac_home_organization` filled as for every organization | [Guide A §4](alliance.md#4-seed-the-organizations), [Guide E §2.6](hosting-operator.md#26-database-schema-and-seeds) |
| **IdP in the realm** | hosting operator | Copy the `example-partner` block and its mappers in `identity/keycloak/realm-oecp.yaml` (alias = slug, `enabled: true`), then `docker compose run --rm keycloak-config`; edit the file, never the console | Not needed | [Adding a partner IdP](../../identity/keycloak/README.md#adding-a-partner-idp), [Guide E §2.13](hosting-operator.md#213-connect-an-identity-provider) step 2 |
| **Metadata refresh** | hosting operator | Configure the `idp-metadata-refresh` job once the first partner IdP is connected (aggregate URL, its signing certificate checked against a second source, dry run) | Not needed | [Guide A §3](alliance.md#3-identity) ("IdP metadata refresh") |
| **Set the alias** | alliance administrator, after the hosting operator confirms the IdP is enabled and tested | *Identity provider alias* = slug on the organization page; until then OECP refuses invitations (`oecp.invitation.idp_not_enabled`) | Leave it empty (*OECP accounts* in the list) | [Alliance manual §6](../manuals/alliance-admin.md#6-sign-in-mode-oecp-accounts-or-the-universitys-login) |
| **Invitation** | alliance administrator | One e-mail: the OECP invitation link, which carries the alias | Two e-mails: Keycloak's set-up e-mail (authenticator app and password) and the OECP invitation link | [Guide A §8](alliance.md#8-invite-partner-admins) |
| **Acceptance and first sign-in** | partner administrator | *Sign in through your university*: the university's login, then TOTP enrolment; acceptance; sign out and in again | Enrol the TOTP app and set the password from Keycloak's e-mail; open the invitation link and sign in; acceptance; sign out and in again | [Partner manual §1](../manuals/partner-admin.md#the-first-time-accept-your-invitation) |
| **Recovery** | see the row | Password and login: reset by the university | Set-up lost or expired: alliance administrator, *Resend set-up e-mail* on the *Administrators* panel; once set up: hosting operator resets the credential in the Keycloak admin console, or an alliance administrator removes and re-invites | [Administrator lifecycle](administrator-lifecycle.md#the-lifecycle-on-one-page) ("Lost password or authenticator"), [runbook §6](../production/runbook.md#6-identity-operations) |

### What the administrator sees

The screens below are from the development stack, with test accounts and example addresses.

Both paths start with the OECP invitation e-mail, which carries the link. The federated path has this one e-mail only; the local path has it in addition to Keycloak's set-up e-mail (row "Invitation").

![Mailpit, Text tab, with the invitation e-mail open: subject "Invitation: Aurora European Universities Alliance administrator, Open European Campus Portal" to deputy@alliance.example, the sentence "You have been invited as alliance_admin of Aurora European Universities Alliance", the link line masked with a black bar, the expiry, and the note about the separate set-up e-mail for organizations without institutional login](../images/onboarding-invitation-email.png)

Federated path (row "Acceptance and first sign-in"): the person reaches their university's login from *Sign in through your university* on the portal's sign-in prompt (the invitation link carries the alias); the Keycloak login page itself does not list the universities.

![Sign-in prompt of the administration panel at /en/admin: the Sign in button and the Sign in through your university box with the Choose your university select and the Continue to your university button](../images/manual-admin-signin.png)

*Continue to your university* leads to the university's own login. The screen here is the development test identity provider; in a real deployment it is the university's login page.

![SimpleSAMLphp "Enter your username and password" form of the development test identity provider (Rovira i Virgili University), empty, as reached from the university chooser on the portal sign-in prompt](../images/onboarding-test-idp-login.png)

Local path (row "Acceptance and first sign-in"): the link in Keycloak's set-up e-mail first asks the person to set up the authenticator app (QR code and one-time code) and then to set a password of at least 12 characters.

![Keycloak "Mobile Authenticator Setup": the warning that you need to set up Mobile Authenticator to activate your account, the list of apps, the barcode step with the QR code masked as a black square, Unable to scan?, and the empty One-time code and Device Name fields with Submit](../images/onboarding-keycloak-totp.png)

![Keycloak "Update password" page with the empty New Password and Confirm password fields, the Sign out from other devices box and the Submit button](../images/onboarding-keycloak-set-password.png)

Local path, recovery (row "Recovery"): when the set-up is lost or has expired, an alliance administrator chooses *Resend set-up e-mail* on the organization's *Administrators* panel (the button appears only while a local account's set-up is pending).

![Administrators panel of Aurora European Universities Alliance, 1 administrator: platform@alliance.example (you), Alliance administrator, signs in with OECP account, Account "Set-up pending: set a password", last sign-in, the Resend set-up e-mail button and the note "You cannot remove yourself"](../images/onboarding-administrators-resend.png)

Both paths, row "Set the alias": the alias is set on the organization page under *Identifiers and login*; empty means local accounts, a slug means federated.

![Identifiers and login: SCHAC home organization urv.cat and identity provider alias urv](../images/manual-organization-identifiers.png)

### Moving from local to federated

When a university's IdP qualifies later, in this order ([Guide A §3](alliance.md#3-identity), "From local to federated"):

1. **Hosting operator:** connect and enable the IdP in the realm and test it (rows "Day 0: metadata exchange" to "Metadata refresh" above).
2. **Alliance administrator:** set the *Identity provider alias* on the organization page and save.
3. **Alliance administrator:** invite the organization's administrators again; they accept through their university.
4. **Alliance administrator:** remove the old local accounts on the *Administrators* panel; they are refused at sign-in anyway (`oecp.auth.idp_mismatch`).

The way back (for example while a university's login is broken) is the same in reverse: clear the alias, save, invite again ([alliance manual §6](../manuals/alliance-admin.md#6-sign-in-mode-oecp-accounts-or-the-universitys-login)).

## What your identity team must provide

For the federated path only. Send it to the **hosting operator** of the alliance (for Aurora: URV IT), who writes it in the realm file ([Adding a partner IdP](../../identity/keycloak/README.md#adding-a-partner-idp); [Guide E §1.1](hosting-operator.md#11-what-to-ask-for-and-decide), row "Identity provider").

From your IdP's metadata (as published in eduGAIN, or by the hub of a hub-and-spoke federation such as SURFconext or WAYF):

- the IdP **entity ID**;
- the **SingleSignOnService** URL, with its binding (HTTP-POST or HTTP-Redirect);
- the **SingleLogoutService** URL, if your IdP declares one;
- the **signing certificate(s)**, all of them during a rollover.

Released to the OECP service provider `https://<auth host>/realms/oecp`:

- `mail`, `givenName`, `sn` and `displayName`;
- `schacHomeOrganization`, equal to the value the alliance records for your university (OECP compares them at acceptance);
- a persistent identifier: `subject-id` (REFEDS Personalized Access), otherwise `pairwise-id`; `eduPersonPrincipalName` only with your written confirmation that it is never reassigned.

Accepted by your IdP: **signed and encrypted assertions** (the OECP side requires both; its encryption certificate is in the per-IdP descriptor).

**The test.** Once the IdP is applied, an alliance administrator sets the alias and invites one administrator of your university. That person opens the link, which sends them to your IdP (`kc_idp_hint=<slug>`), signs in, enrols the TOTP app and accepts; the API checks the e-mail, the IdP and the asserted `schacHomeOrganization`. Only then are the other administrators invited ([Guide E §2.13](hosting-operator.md#213-connect-an-identity-provider), step 4 and "Check").

## Known limits in 0.10.0

- **No real partner IdP is connected yet.** The brokered path is verified end to end only against the development test SAML IdP (`tools/e2e-identity`). In a deployment's copy of the Aurora seed, set `keycloak_idp_alias` to `null` for every university whose IdP is not connected and tested, or its invitations are refused ([Guide E §2.6](hosting-operator.md#26-database-schema-and-seeds)).
- **No custom Keycloak authenticator for missing attributes.** Keycloak creates the user without them; the API then refuses the invitation acceptance. A login error naming the attribute at the Keycloak level is not part of the MVP ([Adding a partner IdP](../../identity/keycloak/README.md#adding-a-partner-idp)).
