# Privacy Policy

Effective date: [EFFECTIVE DATE]
Last revised: [REVISION DATE]

This Privacy Policy explains what Robinson Employment Institute, LLC, doing business as Robinson Employment Law Institute ("RELI", "we", "us"), collects when you use the RELI service at app.relilaw.org, studio.relilaw.org and admin.relilaw.org (the "Service"), why we collect it, who we share it with and what choices you have. RELI is the controller of this information. Contact: admin@trgtechlink.com.

We do not sell personal information, and we do not share it for cross-context behavioural advertising. We do not run third-party advertising or analytics trackers on the Service.

## 1. Information we collect

Account information. When you sign up we collect your name, email address and a password (stored only as a salted hash). If you enable a passkey we store the public key and a device counter; if you enable an authenticator app we store the shared secret in encrypted form. Staff, authors and legal reviewers are required to use multi-factor authentication.

Learning records. As you use a course we record which lessons you have completed, your assessment attempts and answers, the elements scored, your results and any credential earned. These records are held in our learning platform (see section 4) under a stable, opaque learner identifier that we generate; that identifier is never your email address and does not change if your name or email changes.

Purchase information. When you buy a course, Stripe, Inc. processes the payment. We receive and keep the Stripe customer and payment identifiers, the product purchased, the amount, the date and the outcome (paid, refunded, disputed). We never receive or store your full card number, bank account number or card security code.

Email. We send account, receipt, enrolment, credential, due-date and billing emails from our own mail server. For each message we keep a delivery log (recipient address, subject, template, time and outcome). We do not use tracking pixels or click tracking in email.

Server logs. Our web servers and application record technical logs: IP address, request path, time, response code, user agent and a request identifier. Public verification pages are rate-limited per IP address, and the counters used for that live in memory for a short period.

Audit trail. Actions taken by staff, authors and legal reviewers (for example publishing a course version, changing a price, revoking a credential) are written to an append-only audit log with the actor, time and reason. This is a legal-compliance record and is not deleted on request.

Employer-provided information. If your employer or another organisation buys your seat, that organisation gives us your name and email address so that we can invite you.

Support correspondence. If you write to us we keep the correspondence.

We do not collect precise location, biometric data (a passkey's biometric check happens on your own device and never leaves it), health data or information about children. The Service is not directed to anyone under 18.

## 2. How we use information

- To provide the Service: authenticate you, deliver lessons, score assessments, issue and verify credentials, grant and revoke access.
- To process payments, refunds and disputes through Stripe, and to keep the financial records the law requires.
- To send transactional email described above. We do not send marketing email unless you opt in, and every marketing message will carry an unsubscribe link.
- To secure the Service: detect abuse, rate-limit scraping, investigate incidents, and keep the audit trail.
- To meet legal obligations, including tax, accounting and any lawful request from a public authority.
- To improve the courses, using aggregated, de-identified assessment statistics (for example, which model elements are most often missed). Aggregated statistics never identify a learner.

## 3. Public credential verification

Every credential carries a reference code. Anyone who has the code can open our public verification page and see: your name as it appears on your account, the course title, the rank earned, the issue date and, if the credential was revoked, the revocation date and reason. Nothing else is shown: no email address, no scores, no answers, no employer. The page cannot be searched or browsed; it answers only an exact reference code, and it is rate-limited per IP address to deter scraping. By earning a credential you consent to this public record. If you want a credential removed from public verification, contact us; we will mark it revoked with the reason "withdrawn at holder's request", because the historical record that it once existed must remain accurate.

## 4. Who we share information with

- Stripe, Inc. (payments). Stripe receives the information needed to process your payment and is an independent controller of it under Stripe's privacy policy.
- Learning Core (course delivery). Lessons, progress, assessments and credentials are held in a learning platform operated by [LEARNING CORE OPERATOR ENTITY] on servers under our contract. It receives your display name and our opaque learner identifier, not your email address or payment details.
- Hosting and email infrastructure. Our application, database and mail server run on servers we control at [HOSTING PROVIDER, e.g. Hetzner Online GmbH] data centres. Backups of our database are encrypted at rest and kept off-site.
- Your employer or seat purchaser, if applicable, sees completion status, dates and credentials only. It cannot see your answers or question-level scores. This wall is enforced in our database queries.
- Professional advisers and authorities, where required by law, court order or to protect the rights and safety of RELI, our users or the public.
- A successor, if RELI is sold or reorganised, under the same commitments made in this policy.

We have no other categories of recipients. We do not use data brokers, advertising networks or third-party analytics.

## 5. Cookies and similar technologies

We use one strictly necessary session cookie to keep you signed in, and a preference cookie or local-storage value that remembers your light or dark theme. Neither is used for tracking. Because we set no optional cookies, we do not show a cookie banner.

## 6. Data retention

- Account information: for the life of your account and [RETENTION AFTER CLOSURE, e.g. 90] days after closure, then deleted or de-identified.
- Learning records and credentials: credentials and the fact that they were issued are kept indefinitely so that the public verification record stays accurate. Lesson progress and assessment answers are kept while your account is open and for [RETENTION AFTER CLOSURE, e.g. 90] days after, then de-identified.
- Purchase records: seven years, as required for tax and accounting.
- Email delivery log: [EMAIL LOG RETENTION, e.g. 12] months.
- Server logs: [SERVER LOG RETENTION, e.g. 30] days.
- Audit trail: indefinitely; it is a legal-compliance record.
- Database backups: fourteen days on a rolling basis.

## 7. Your choices and rights

You can view and update your name and email in your account settings. A change of email does not change your learner identifier or your credentials. You can close your account by writing to admin@trgtechlink.com; on closure we delete or de-identify the records described in section 6, other than those we must keep.

Residents of states with comprehensive privacy laws (for example California, Colorado, Connecticut, Virginia, Utah, Texas and Oregon) may have rights to access, correct, delete and obtain a portable copy of their personal information and to opt out of sales and targeted advertising. We do not sell or share information for targeted advertising, so there is nothing to opt out of; the other rights are available to every user regardless of residence. Send requests to admin@trgtechlink.com from the email address on your account. We will verify your identity, respond within 45 days, and will not discriminate against you for exercising a right. If we decline a request we will say why and how to appeal. [ATTORNEY TO CONFIRM: applicability thresholds under each state law; RELI is below most volume thresholds at launch.]

North Carolina does not currently have a comprehensive consumer privacy statute. North Carolina's Identity Theft Protection Act (N.C. Gen. Stat. 75-60 to 75-66) governs our handling of certain identifying information and requires us to notify you and the Attorney General of a security breach affecting your personal information; we will do so without unreasonable delay.

If you are in the European Economic Area or the United Kingdom, the Service is not directed to you and we do not intentionally offer it there. [ATTORNEY TO DECIDE whether to add GDPR/UK GDPR terms if non-US learners are accepted.]

## 8. Security

Passwords are hashed with Argon2id. Authenticator secrets are encrypted with a key held outside the database. Sessions use secure, HTTP-only cookies. All traffic to the Service is encrypted in transit with TLS. Access to staff and reviewer areas requires multi-factor authentication, and the administrative console is restricted to approved network addresses. Our application connects to the learning platform over a private network with a server-side key that is never sent to your browser. No system is perfectly secure; if you discover a vulnerability please tell us at admin@trgtechlink.com.

## 9. Children

The Service is for adults. We do not knowingly collect information from anyone under 18, and we will delete such information if we learn of it.

## 10. Changes to this policy

We will post any revised policy here with a new revision date and, for material changes, notify you by email or in the Service before the change takes effect.

## 11. Contact

Robinson Employment Institute, LLC, d/b/a Robinson Employment Law Institute
[REGISTERED OFFICE ADDRESS]
admin@trgtechlink.com
