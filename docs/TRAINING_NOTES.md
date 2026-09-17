# RELI training notes

Step lists and screen inventories for producing quick-start guides and
narrated training videos. Three audiences: the legal reviewer (Studio), staff
(Console), learners (Dojo). Screens are named by their route; the heading on
each screen is quoted so a video script can match what is on screen. Staging
hosts: app.relilaw.org, studio.relilaw.org, admin.relilaw.org.

Recording conventions (from Deon's earlier videos): light theme, white
background, 3-4 features per video, narrated; keep each video under four
minutes. Use a test learner and the demo tenant, never a real customer.

## A. Legal reviewer: walking the gate in the Studio

Purpose: show an attorney how NC-ORG-001 is blocked, how the eight review items
are cleared, and how one signature publishes the course and is recorded forever.

Prerequisites: an account with the `legal` role (Deon's account has
learner+staff+legal on staging); an authenticator app on the phone.

Screens
1. `studio.relilaw.org/login`: "Sign in to the Studio". Email and password, then a six-digit code. First visit walks through authenticator setup: the screen shows a manual key (no QR code by design), the reviewer types it into the authenticator, enters the first code, and receives recovery codes to store offline.
2. `studio.relilaw.org/`: "Draft, review, legal review, published." The pipeline board with one card per content version, grouped by state. NC-ORG-001 sits in the legal-review column with a count of open review items.
3. `studio.relilaw.org/versions/{id}`: version detail. Eyebrow shows the Core course reference and version number. Sections: the four-step gate (draft, SME review, legal review, published) with the current step marked; "Attorney review items"; "Actions"; "Signed by" (empty until signed); "Transition log".

Steps for the video
1. Sign in; point out MFA is mandatory on this door and that a learner login does not work here.
2. Open NC-ORG-001. Show the gate: legal review is the active step, "Sign off and publish" is disabled, and the refusal text explains why (open review items).
3. Open the "Attorney review items" list: eight items, each with the lesson, the citation in question, and the reviewer note. Resolve one item with the Resolve button; show the count drop to seven and the publish button stay disabled.
4. Explain the SQL rule: staff, even a staff admin, cannot publish; the button is disabled for them and the database refuses the transition. Only a legal account with zero open items and a typed sign-off can publish.
5. Resolve the remaining items (or pre-resolve seven off camera and resolve the last on camera).
6. In "Actions", type the sign-off statement in the field (name as licensed, the statement that the content was reviewed as of today's date), press "Sign off and publish".
7. Show the result: gate step four filled, the "Signed by" block with the reviewer's name and date, and the transition log entry (actor, from legal_review, to published, timestamp, reason). Reload to show it is permanent; there is no undo button.
8. Show "Return to draft" on a published version creates a new draft that must walk the path again; the published version stays published and immutable.
9. Close with the learner view: open app.relilaw.org/dojo/library in another tab and show the course now visible with its verified-on dates.

Talking points: the reviewer's signature is what RELI shows a regulator; the review items list is the reviewer's own worklist; nothing here gives legal advice to a learner, it certifies teaching material.

## B. Staff: using the Console modules

Purpose: show operations staff the four shipped modules plus the stale-content
query, and the audit trail behind each action.

Prerequisites: an account with the `staff` role; authenticator enrolled; the
staff member's IP in the Console allow-list once that is enabled.

Screens
1. `admin.relilaw.org/login`: "Sign in to the Console". Same MFA flow as the Studio.
2. `admin.relilaw.org/`: "Overview" eyebrow, greeting "Good to see you, {first name}." Cards: recent audit events, links to modules 02-07.
3. `admin.relilaw.org/compliance` (Module 02, "Compliance reporting"): organisations and completion counts; drill into `/compliance/{orgId}` for the per-learner completion, dates and credentials. Point out what is absent: no answers, no item scores.
4. `admin.relilaw.org/catalogue` (Module 03, "Catalogue and pricing"): product table (NC-ORG-001 at 199.00 USD active; SAMPLE-NC-001 inactive). Inline form per product: new price in dollars, Active checkbox, Reason, Save. Every save writes an audit event; the Buy button in the Dojo reads the new price at once and never shows a checkout link to someone who already owns the course.
5. `admin.relilaw.org/billing` (Module 04, "Billing"): "Webhook events" (the stripe_event ledger: id, type, outcome) and "Entitlement ledger" (user, key, source such as purchase:pi_..., granted, revoked). Stripe's own dashboard handles refunds; this screen shows the consequence (revoked_refund event, entitlement revoked_at).
6. `admin.relilaw.org/pipeline` (Module 05, "Content pipeline"): read-only view of the same board the Studio shows, with the transition log. Staff can move draft to SME review; they cannot publish. Demonstrate the disabled button.
7. `admin.relilaw.org/stale` (Module 06, "Stale content"): citations not re-verified in N days, from the Core `GET /v1/content/stale`. This is the re-verification worklist.
8. `admin.relilaw.org/registry` (Module 07, "Credential registry"): search by reference, name, email or course; each row shows holder, course, rank, issued, status. Inline revoke form: a reason is required, the Revoke button is red, and the revocation shows on the public verify page immediately with the reason. Revocation is permanent.

Steps for the video
1. Sign in; show the allow-list concept (Console only answers to approved office IPs once enabled).
2. Overview: read the last three audit events aloud to show what is recorded.
3. Catalogue: change the NC-ORG-001 price by one dollar with a reason, save, show the audit event, change it back.
4. Billing: open a webhook event, follow it to the entitlement row; explain "access is an entitlement, never a Stripe object".
5. Registry: search for the test learner, revoke a test credential with a reason, open `/verify/{ref}` in a new tab to show "This credential has been revoked" with the reason; explain there is no un-revoke.
6. Compliance: open the demo organisation, show completion columns and the absence of answer data.
7. Stale content: explain the 180-day rule and who picks up the list (author, then reviewer).
8. Pipeline: show the disabled publish button for staff.

Talking points: every action asks for a reason because the audit trail is the product's legal memory; staff see money and access, the Core sees neither.

## C. Learner journey in the Dojo

Purpose: the end-to-end promise from spec section 14: sign up, pay, learn,
sit the assessment, earn the rank, hand an employer a verification link.

Screens
1. `app.relilaw.org/dojo/signup`: name, email, password (12+ characters), optional passkey afterwards. The consent line links to Terms and Privacy (to be wired).
2. `app.relilaw.org/dojo/login`: email and password, or passkey.
3. `app.relilaw.org/dojo`: the Dojo home. Belt ladder rail (White through Orange lit as earned), current rank, progress to next rank, resume-next-lesson button, due dates, jurisdiction badge for North Carolina, cohort card (empty state in phase 1).
4. `app.relilaw.org/dojo/library`: filter by rank, jurisdiction, format, duration. One course in phase 1: NC-ORG-001 Orange Belt. Buy button states: Buy (price shown), Owned, or Locked by prerequisite.
5. Stripe Checkout (hosted, checkout.stripe.com): card or ACH; test card 4242 4242 4242 4242 in sandbox. Returns to the course page.
6. `app.relilaw.org/dojo/courses/{id}`: course overview, six modules, twenty-two lessons with estimated minutes and completion ticks.
7. `app.relilaw.org/dojo/lessons/{id}`: lesson player. Prose, list and table blocks; the trap block ("the common mistake") in its own treatment; citation strip at the foot with statute references in mono type and the verified-on date. "Mark complete and continue".
8. `app.relilaw.org/dojo/assess/{attemptId}`: the assessment. Single and multiple choice items plus constructed-response items answered in a paragraph. Submit.
9. `app.relilaw.org/dojo/results/{attemptId}`: element-scored result. For each constructed item: "N of M elements", what was identified, what was missed, the governing citation. Overall pass or fail with the passing standard. Retake guidance. (Constructed items are graded by staff against the model elements; the result page updates when grading completes. Grading UI is in progress.)
10. Credential and `relilaw.org/verify/{ref}`: the credential card with rank colour, holder, course, reference code, issue date; the public verify page shows the same facts and a status badge, no login.
11. `app.relilaw.org/dojo/account`: change name or email (the learner keeps the same credential and reference), passkeys, sign out everywhere.

Steps for the video
1. Sign up as a new learner; show the welcome mail arriving.
2. Open the Library, press Buy, complete Checkout with the test card, land back on the course now marked Owned; show the receipt mail.
3. Open lesson 1; read one trap block aloud; point at the verified-on date in the citation strip.
4. Complete two or three lessons on camera (the rest pre-completed), then start the assessment.
5. Answer one constructed item deliberately incompletely; submit.
6. Results: read the "2 of 4 elements" feedback and the citation; explain why a miss is shown as teaching.
7. Show the credential on the Dojo home and open the public verify link in a private window.
8. Account: change the email address; return to the verify page to show the credential is unchanged.

Talking points: rank is data from the Core, colour comes with it; nothing in the lesson is advice about the learner's own workplace; the verified-on date is the moat.

## Assets to prepare before recording

- Test learner account (fresh email on the Genius Eye test mailbox) and a second, pre-completed learner for the results and credential scenes.
- One test credential to revoke on camera (create it with the pre-completed learner).
- Seven of eight review items resolved off camera, one left for the gate scene; alternatively record on the demo tenant and reset with scripts/load-review-items.mjs.
- Stripe sandbox in test mode; confirm the webhook endpoint is live (Console Module 04 shows events).
- Browser at 1440x900, light theme, 125 percent zoom for legibility; reduced motion on.
