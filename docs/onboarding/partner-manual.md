<!-- SPDX-FileCopyrightText: 2026 Lluís Alfons Ariño -->
<!-- SPDX-License-Identifier: EUPL-1.2 -->

# Guide D: a university without integration capacity

For universities that will maintain their courses by hand: through the web form, through CSV files filled in a spreadsheet, or both. No IT work is needed. In Aurora this covers several partners and the Aurora Foundation itself [DL 4]. Overview: [onboarding README](README.md). Details of every column and screen: [CSV authoring guide](../guides/csv-authoring.md) and [web form guide](../guides/web-form.md).

> **Before you start**
>
> - The alliance has finished [Guide A](alliance.md) and you have received an invitation e-mail.
> - You have an authenticator app (for example on your phone) for the one-time codes.
> - For each course you know: an English title and description, ECTS credits, ISCED-F field of study codes, dates, teaching languages, delivery mode and how students apply.
> - Time: 15–30 minutes per course in the form; 2–4 hours for a first CSV upload of 20–50 courses, then much less.

## 1. Roles and accounts

**Who:** partner admin. **Time:** 15 minutes.

You are a `partner_admin`: you manage the courses, offerings and uploads of your own university only. The alliance admin can see and help with everything.

1. Open the e-mail from the login service, set a password of at least 12 characters and scan the QR code with your authenticator app.
2. Open the OECP invitation link and sign in with password and code; the page shows "Invitation accepted". Choose *Sign out and sign in again*: your new session carries the role.
3. Ask the alliance admin to invite a second colleague, so your university is never blocked by one absence. Each person can administer one organization. The *Invitations* page shows your organization's invitations; only alliance admins send, revoke or resend them.

A page reload keeps you signed in while your login session is alive (30 minutes idle, 8 hours at most); after that, sign in again. If your university's identity provider is connected to OECP, your invitation link takes you to *Sign in through your university* and there is no separate password e-mail; later, choose your university under *Sign in through your university* on the sign-in page. Until it is connected, you use the OECP account from step 1.

## 2. Form or CSV?

Both write the same records, so you can mix them freely.

| Use the web form when | Use CSV files when |
|---|---|
| You have a handful of courses | You have many courses, or the same courses every year |
| You add or correct one course at a time | You maintain a master spreadsheet anyway |
| You want guidance field by field | You want to review everything in one table |

## 3. Upload CSV files

**Who:** partner admin. **Time:** 2–4 hours the first time.

1. In the admin dashboard open **CSV upload** (an alliance admin first chooses the organization).
2. Under *Templates*, download the `courses.csv` and `offerings.csv` templates. Always download them from your own portal: the courses template includes one `attr_<key>` column per alliance attribute.
3. Open them in a spreadsheet. Keep the header row exactly as it is; fill one row per course (or offering). Required course columns: `template_version` (`1.2`), `course_code`, `status`, `ects`, `isced_codes`, `title_en`. The Aurora catalogue also expects, to show a course, `description_en`, `learning_outcomes_en`, `prerequisites_en`, `assessment_en`, `levels`, a contact and `instructors` (names separated by `|`), and offerings with `enrol_start_date` and `application_deadline`; the upload reports what is missing as the warning `oecp.content.handbook_incomplete` ([CSV authoring guide](../guides/csv-authoring.md#publication-rule-handbook-completeness)). Required offering columns: `template_version`, `course_code`, `offering_code`, `status`, `start_date`, `end_date`, `teaching_languages`, `delivery_modes`.
4. Save as **CSV UTF-8** (Excel: "CSV UTF-8 (Comma delimited)"; LibreOffice: character set UTF-8). Format date columns as text so the spreadsheet keeps `YYYY-MM-DD`. Separate several values in one cell with `|`, for example `en|de`.
5. Drop both files on the upload area (or choose them). The page detects which is which from the header; correct it if needed.
6. Read the **check report**: the files are checked in your browser before anything is sent. Each issue shows severity, file, row, column, code and message; you can filter and download it as CSV. Fix every **error**; **warnings** do not block. The browser cannot check whether an offering's `course_code` already exists in the catalogue: the server does that.
7. Press **Upload**. The server checks again. Either it reports the status and any warnings, or (above 500 rows) it queues the upload and the page follows its progress, or it rejects the files with a list of errors. An upload is **all or nothing**: one error and nothing is saved.
8. Later, every upload appears in **Sync history** with its counters and messages.

Limits: 5 MB and 5,000 rows per file, 10 uploads per hour.

## 4. Use the web form

**Who:** partner admin. **Time:** 15–30 minutes per course.

1. Open **Courses** > **New course**. The wizard has four steps.
2. **Basics.** Course code (your own code, for example `MATH-101`; it cannot be changed later), type of course (course, Blended Intensive Programme, lecture series, other), levels (the first ticked is the primary one), ECTS (use a dot: `7.5`), teaching hours, ISCED-F codes with one marked primary, teaching unit, information page (`https://` only) and a functional contact e-mail.
3. **Texts.** English is required: title, abstract, description, learning outcomes, prerequisites, assessment, keywords. Add other languages with *Add a language*; each needs at least its own title. OECP never translates automatically.
4. **Attributes.** The alliance's own tags, for example educational hub or Sustainable Development Goals.
5. **Review and status.** Choose *Draft* or *Published* and press **Create course**. Publishing needs the English title.
6. On the course page, **Add offering** for each edition: offering code (for example `2027S`), academic session, start and end dates, application period start and deadline (inclusive, in the offering's time zone), teaching languages, delivery modes, campus, seats (maximum, reserved for the alliance, available now) and **How to apply**: an application page and/or instructions per language, for example "Nomination by the Aurora office of your home university".
7. **Publish and withdraw** with the status buttons: *Publish*, *Withdraw*, *Cancel* (an offering that will not take place stays visible, labelled, until its start date) and *Back to draft*. A course appears in the catalogue once it is published **and** has a published offering that has not ended.
8. **Delete** only records created by mistake. Published offerings, and courses with published offerings, cannot be deleted: withdraw them instead. Each course page shows its history of changes.

## 5. Keep the data fresh

**Who:** partner admin. **Time:** about an hour per term.

- [ ] Before each application round, check deadlines, application pages and instructions.
- [ ] Update *Seats available now* if you publish it; the portal shows the date of the figure, so an old number looks old.
- [ ] Add next year's edition as a **new offering** with a new code, rather than overwriting last year's.
- [ ] Withdraw courses that will not run again. Courses whose offerings have all ended leave the default listing by themselves.
- [ ] Check **Sync history** after every upload.

## 6. Common mistakes

| Mistake | What happens | Fix |
|---|---|---|
| Course left out of a new CSV file | Nothing: omission never withdraws | Keep the row with `status` `withdrawn` |
| Empty cell in a CSV column | The field is **cleared** | Delete the whole column to leave a field untouched |
| Dates reformatted by the spreadsheet (`14/10/2026`) | Error `oecp.csv.invalid_date` | Format as text, `YYYY-MM-DD` |
| File saved as "CSV" in a local encoding | Encoding error, or broken accents | Save as CSV UTF-8 |
| No English title | Cannot publish | Add `title_en` or the English text |
| Course published, offering left as draft | Course not listed | Publish the offering too |
| Course code changed in a CSV file to correct a typo | A second course is created | Codes are permanent: withdraw the wrong record, or delete it if it was never published |
| `http://` link | Refused | Use `https://` |
| ISCED code `0613` given as `613` | Wrong or unknown field | Keep leading zeros (format the column as text) |

## Checklist

- [ ] Invitation accepted; password and authenticator app working
- [ ] A second partner admin invited
- [ ] Templates downloaded from your own portal
- [ ] First courses entered (form) or uploaded (CSV) with no errors
- [ ] English titles, ECTS, ISCED codes, dates, languages and delivery modes filled in
- [ ] Offerings published, with application page or instructions
- [ ] Courses checked in the public catalogue
- [ ] Review routine agreed for each term
