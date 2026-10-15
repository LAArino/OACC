<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Accessibility statement template: OECP public portal and administration panel

Template under **Directive (EU) 2016/2102** on the accessibility of the websites and mobile applications of public sector bodies, following the model statement of Commission Implementing Decision (EU) 2018/1523. The reference standard is **EN 301 549 V3.2.1**, whose web requirements correspond to **WCAG 2.1 level AA**. OECP targets WCAG 2.1 AA and aims at WCAG 2.2 AA (spec [§10](../spec-v4.1.md#10-non-functional-requirements)).

**How to use this template.** The part between the two rules below is the statement to publish (on the alliance website until the portal has an `/accessibility` page, spec §7.1). Fill every `[TO COMPLETE]`, delete the guidance notes in *italics*, and publish it in English and in `[TO COMPLETE: other languages of the portal]`. Before publishing, the controller confirms that the Directive applies: it covers public sector bodies; `[TO COMPLETE: whether the Aurora Foundation is a public sector body, or whether the statement is issued by URV or the partner universities as such]`. Even where it does not strictly apply, publishing the statement is good practice and expected by the partners.

*What has been checked so far (release 0.3.0), for the person who completes the statement:*

- *Automated checks: the web application's unit tests run **axe-core** on the rendered catalogue and administration components (rule sets WCAG 2.0, 2.1 and 2.2 levels A and AA, and best practices; `apps/web/test/*.test.ts`, helper `axeViolations`). Colour contrast and landmark regions cannot be computed without a layout and are disabled there; contrast of the design tokens is checked by a separate unit test (`apps/web/test/contrast.test.ts`). Fallback texts shown in another language carry a `lang` attribute (spec §10).*
- *Not done yet: a **manual review** (keyboard only, screen readers, 200 % and 400 % zoom and reflow, text spacing, forms and error messages in context), automated checks of complete pages in a browser, the **Keycloak sign-in and MFA pages** (a separate application with its own theme), and a review by people with disabilities. Spec §10 lists the accessibility audit as an open item before go-live.*
- *Candidates to examine in the manual review: TOTP as the only second factor offered by the panel (WCAG 2.2 success criterion 3.3.8, Accessible Authentication, if 2.2 is claimed); the privacy notice of a course, shown in small print (spec §7.2); the CSV upload console (file selection and the validation report); the course wizard with its override toggles; long multilingual texts entered by partners as plain text.*

---

## Accessibility statement

`[TO COMPLETE: name of the body issuing the statement, e.g. the Aurora Foundation]` is committed to making its websites accessible, in accordance with `[TO COMPLETE: national law transposing Directive (EU) 2016/2102; for a Spanish body: Real Decreto 1112/2018]`.

This accessibility statement applies to:

- the **public course catalogue** of the Aurora alliance at `[TO COMPLETE: https://portal host/]`, including its read API documentation pages, if any;
- the **administration panel** at `[TO COMPLETE: https://portal host/en/admin]`, used by staff of the partner universities and of the Foundation, and its **sign-in pages** at `[TO COMPLETE: https://auth host/]`.

*Guidance: art. 1(4)(g) of the Directive excludes only extranets and intranets published before 23 September 2019 (until substantially revised); the administration panel is a newer extranet. If the issuing body decides otherwise, remove the second item and say why.*

### Compliance status

`[TO COMPLETE: choose one per website]`

- *Fully compliant* with EN 301 549 V3.2.1 / WCAG 2.1 AA.
- *Partially compliant* with EN 301 549 V3.2.1 / WCAG 2.1 AA, due to the non-compliances and exemptions listed below.
- *Not compliant*: most requirements are not met.

*Guidance: without a completed manual review, "fully compliant" cannot be claimed. Until the review is done, "partially compliant" with the known limitations below is the honest status.*

| Website | Status |
|---|---|
| Public catalogue | `[TO COMPLETE]` |
| Administration panel and sign-in pages | `[TO COMPLETE]` |

### Non-accessible content

The content listed below is not accessible for the following reasons.

**(a) Non-compliance with the accessibility requirements**

| Issue | Where | WCAG success criterion | Planned fix and date |
|---|---|---|---|
| `[TO COMPLETE: issue found in the review]` | `[TO COMPLETE]` | `[TO COMPLETE]` | `[TO COMPLETE]` |
| `[TO COMPLETE]` | | | |

**(b) Disproportionate burden**

`[TO COMPLETE: only if an assessment under art. 5 of the Directive was made; otherwise write "Not applicable."]`

**(c) Content not within the scope of the applicable legislation**

`[TO COMPLETE, e.g.: course descriptions, application instructions and documents written by partner universities and published as received are third-party content neither funded nor developed by, nor under the control of, the issuing body; pages of partner universities reached through "Apply" and "More information" links are outside this statement.]` *Guidance: check this exemption (art. 1(4)(e) of the Directive) with legal advice; course texts supplied by members of the alliance may not count as third-party content.*

### Preparation of this statement

- Statement prepared on: `[TO COMPLETE: date]`.
- Last reviewed on: `[TO COMPLETE: date]` *(review at least once a year and after each major release)*.
- Software version assessed: OECP `[TO COMPLETE: release]`.
- Method: `[TO COMPLETE: self-assessment by …, or assessment by a third party (name)]`; automated testing with axe-core in the project's test suite; manual review of a representative sample of pages `[TO COMPLETE: list of pages and templates sampled, e.g. home, search with filters, course page, course page in a fallback language, admin dashboard, course wizard, CSV console, invitations, sign-in and MFA set-up]`; assistive technologies and browsers used `[TO COMPLETE]`.

### Feedback and contact information

If you notice a lack of compliance, find content that is not accessible to you, or need information in an accessible format, contact us:

- E-mail: `[TO COMPLETE: functional mailbox, e.g. accessibility@…]`
- Postal address or telephone: `[TO COMPLETE]`
- We will reply within `[TO COMPLETE: number of days; check the national deadline]`.

*Guidance: the mailbox must be monitored; route requests concerning a partner's course text to that partner.*

### Enforcement procedure

If you are not satisfied with our reply, or receive no reply within the period above, you can `[TO COMPLETE: national enforcement procedure of the member state whose law applies]`.

*Guidance per member state of the issuing body:*

| Member state | Enforcement body and procedure |
|---|---|
| Spain (URV hosting; Real Decreto 1112/2018) | `[TO COMPLETE: complaint and claim procedure under RD 1112/2018, and the competent unit (state or Catalan administration) for the issuing body]` |
| `[TO COMPLETE: member state of the Aurora Foundation]` | `[TO COMPLETE]` |
| Other partner states, if a partner issues its own statement | `[TO COMPLETE]` |

---

*Notes for the maintainers of the statement:*

- *Keep a dated record of every review and of the issues found (for example in the alliance's issue tracker), and report software defects to the OECP project so they are fixed upstream for every alliance.*
- *WCAG 2.2: the project aims at 2.2 AA; claim it only after the manual review covers the success criteria added in 2.2 at levels A and AA.*
- *Each new OECP release may change the interface: re-run the sample after an upgrade and update "Software version assessed".*
