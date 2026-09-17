# RELI phase 1 compliance pre-check

Prepared 2026-09-17 per skills/deon_compliance_precheck. Product: paid,
on-demand online employment-law compliance training for North Carolina (one
course, NC-ORG-001, White through Orange), sold by Robinson Employment
Institute, LLC (NC) trading as Robinson Employment Law Institute. Learners are
individuals and, in phase 2, employer seats. No live instruction, no advice
channel (the Advisor is not built), no employee data beyond name, email and
learning records.

Statutes were read from ncleg.gov / ncdor.gov on 2026-09-17. This is a
working memo for the attorney, not legal advice. Status legend: DONE / OPEN /
BLOCKED-ON-DEON.

## 1. Unauthorised practice of law (highest risk)

Relevant law
- N.C. Gen. Stat. 84-2.1(a) defines "practice law" to include "assisting by advice, counsel, or otherwise in any legal work; and to advise or give opinion upon the legal rights of any person, firm or corporation", with or without compensation.
- N.C. Gen. Stat. 84-4 prohibits any person other than an active State Bar member from practising law, and from holding out as competent to give legal advice.
- N.C. Gen. Stat. 84-5 prohibits corporations and LLCs from practising law (with exceptions for professional corporations under Chapter 55B, which RELI is not).
- Publishing general legal information and teaching about the law is not the practice of law; giving an opinion on a specific person's legal rights is.

Posture built into the product (DONE)
- Every page carries the UplNotice: education, not legal advice; content reviewed by a licensed attorney on the date shown; referral to counsel for specific matters.
- Trap blocks and assessment feedback teach general rules and cite the governing statute; they never address a learner's own facts.
- Legal-review gate: no jurisdiction module publishes without a named attorney's sign-off, recorded permanently (spec section 6, migration 003). Staff cannot bypass it.
- Training Disclaimer (content/legal/disclaimer.md) states that ranks are not licences and that non-attorneys may not advise others under 84-4.
- The Advisor (AI answers to individual questions) is deliberately not built; it is the feature that would most plausibly cross 84-2.1.

Open items
- BLOCKED-ON-DEON: attorney opinion on the trade name "Robinson Employment Law Institute" and the domain relilaw.org. Using "Law" in a non-law-firm name may be read as holding out under 84-4 / State Bar advertising rules (27 NCAC 2, Rule 7.1 governs lawyers, not RELI, but the State Bar's UPL committee can act on misleading names). Options if counsel objects: "Robinson Employment Institute" with "employment-law training" as a descriptor, or "Robinson Employment Compliance Institute".
- OPEN: the `/referral` link in UplNotice has no page. Either build a neutral page pointing to the NC State Bar Lawyer Referral Service (no paid referral arrangements, which could implicate 84-4 and Rule 7.3 for the receiving lawyers) or remove the link before launch.
- OPEN: reviewer identity. The gate records `approver_ref`; the reviewer's bar number and jurisdiction of licence should be captured on the reviewer's account so the sign-off record is self-proving.

## 2. Proprietary school licensing (newly identified, needs a decision)

- N.C. Gen. Stat. 115D-87(2) defines a "proprietary school" as a privately owned educational institution with a physical presence in North Carolina that charges tuition and offers a program leading toward, among other things, "employment at a beginning or advanced level" or "a postsecondary educational credential below the associate degree level". Distance education and electronic delivery are expressly included. Licensing is by the State Board of Proprietary Schools (NC Community College System); operating without a licence is a misdemeanour under 115D-96.
- N.C. Gen. Stat. 115D-88 exemptions that could apply: (2) classes conducted by employers for their own employees at no fee (phase 2 seats do not fit: RELI charges the employer); (4c) classes the State Board "determines are avocational, recreational, self-improvement, or continuing education for already trained and occupationally qualified individuals". Phase 1 is continuing education for working HR staff, managers and owners, which is the (4c) pattern, but (4c) turns on a Board determination, not self-assessment.
- Risk driver: RELI issues a named credential ("Orange Belt") and the marketing frames it as a rank. That looks like a "postsecondary educational credential".

Status: BLOCKED-ON-DEON. Recommend counsel request a written exemption determination under 115D-88(4c) from the Proprietary Schools office before launch, and that marketing describe the product as continuing education for people already working in HR or management, not as career preparation. Until then, avoid "certification" language; "credential of completion" is safer.

## 3. Sales and use tax on digital training (likely taxable in NC)

Verified from live NCDOR and ncleg.gov sources on 2026-09-17:
- N.C. Gen. Stat. 105-164.4(a) taxes the sales price of "certain digital property" at the general State rate plus local and transit rates, whether or not the buyer gets permanent use.
- N.C. Gen. Stat. 105-164.3(33): certain digital property means specified digital products and additional digital goods, and "does not include an information service or an educational service".
- N.C. Gen. Stat. 105-164.3(75) "educational service" requires delivery "by or on behalf of a qualifying educational entity" plus one of four conditions (curriculum for an enrolled student; within accreditation or preparing for gainful employment; evaluated by an instructor, not by a computer; or live interactive connection).
- N.C. Gen. Stat. 105-164.3(203) "qualifying educational entity" means only an elementary or secondary school (20 U.S.C. 7801) or an institution of higher education (20 U.S.C. 1002), which requires accreditation by a Secretary-recognised agency.
- NCDOR Private Letter Ruling SUPLR 2026-0003 (issued May 28, 2026): an online professional education and continuing-education provider that could not show recognised accreditation was held not to be a qualifying educational entity, so its on-demand digital courses were "certain digital property" subject to State, local and transit sales tax. Non-precedential, but it is the Department's current reading of the same facts RELI has.

Conclusion: RELI is not accredited and its assessments are scored by software (with staff awarding points, which still does not cure the entity requirement), so course sales to North Carolina purchasers should be treated as taxable digital property. Combined rate is 4.75 percent State plus 2 to 2.75 percent local depending on county (Wake 7.25 percent).

Actions
- BLOCKED-ON-DEON / CPA: register Robinson Employment Institute, LLC for NC sales and use tax (Form NC-BR, online) before the first live sale; file on Form E-500.
- OPEN: enable Stripe Tax on the live Stripe account with the product tax code for digital goods / online courses (Stripe code `txcd_10302001` "Digital audio visual works / online courses" or the digital-goods code counsel prefers), collect billing address at Checkout (`automatic_tax: {enabled: true}`, `billing_address_collection: required`). The checkout code currently sets an inline price without tax; this is a small change in src/lib/billing/checkout.mjs (M5a/M6 owner).
- Other states: economic-nexus thresholds (typically 100,000 USD or 200 transactions per state) are far above phase 1 volume; Stripe Tax monitors thresholds. Revisit at 50,000 USD annual out-of-state sales.
- The Terms (section 5) already disclose that tax is added at checkout and cite the statute and ruling.

## 4. Consumer protection and commercial terms

- N.C. Gen. Stat. 75-1.1 (Unfair and Deceptive Trade Practices Act) applies to marketing claims. Do not state or imply that completing a course makes an employer "compliant", "protected" or "audit-proof"; the Terms and Disclaimer say the opposite. Treble damages and attorneys' fees are available to a prevailing consumer, so this belongs in the copy review.
- Refund policy is disclosed before purchase (Terms section 4) and matches the code: a full refund or a lost dispute revokes the entitlement; a partial refund leaves access intact.
- Automatic renewal: phase 1 sells one-time course access, so N.C. Gen. Stat. 75-41 (automatic renewal disclosures) does not apply yet. It will when subscriptions or meters (phase 2) are introduced: clear disclosure, affirmative consent, easy cancellation.
- Note on "Chapter 93A": that chapter is the North Carolina Real Estate License Law (brokers, real-estate education providers). It does not apply to RELI. The 93A reference in the task likely meant Chapter 75 (UDTPA) above or Chapter 84 (UPL) in section 1.

Status: DONE for disclosures; OPEN for the attorney's pass over marketing copy.

## 5. Privacy and data protection

- No comprehensive NC privacy statute. N.C. Gen. Stat. 75-60 to 75-66 (Identity Theft Protection Act): security breach notification to affected residents and to the Attorney General (75-65). Personal information under 75-61(10) includes first name/initial plus last name in combination with, for example, account numbers or passwords. RELI stores hashed passwords only and no card or bank numbers (Stripe does), which limits exposure; the duty still exists. OPEN: write a one-page breach response runbook (who decides, 72-hour internal target, AG notice form).
- Federal: CAN-SPAM for any marketing email (transactional receipts and credential notices are exempt from opt-out requirements but must not be misleading); no marketing email is sent today. TCPA is not engaged (no SMS or calls). COPPA is not engaged (adults only). FERPA does not apply (RELI is not a school receiving federal education funds). GLBA/FCRA/HIPAA not engaged.
- Other states: California CCPA/CPRA thresholds (25 million USD revenue, or 100,000 consumers, or 50 percent revenue from selling data) are not met at launch; the Privacy Policy nonetheless offers access, correction, deletion and portability to every user, and RELI sells no data, so the main obligations are met by design.
- EEA/UK: not targeted; Privacy Policy says so. If a non-US learner buys, GDPR exposure is low-volume but real; attorney to decide whether to geo-restrict Checkout.
- Public verification page: shows name, course, rank, dates, and revocation reason only; exact-match lookup; per-IP rate limit in nginx and Redis. Consent is obtained in the Terms (section 8) and Privacy Policy (section 3). OPEN: add a checkbox or explicit sentence on the signup form referencing both documents.
- Employer wall: org admins see completion and credentials, never answers or item scores (spec section 7; test 3 in M5a scope). This is a contractual and UDTPA point as much as a privacy one; keep it in the employer agreement for phase 2.

Status: DONE in design and policy text; OPEN items listed.

## 6. Payments

- Stripe Checkout hosted pages: no card data touches RELI servers, so PCI DSS scope is SAQ A. Stripe account for Robinson Employment Institute, LLC is BLOCKED-ON-DEON (currently TRGPay sandbox). Two legal entities means two Stripe accounts (spec 12.2).
- Money transmission: RELI sells its own product and never holds funds for others; no MSB/MTL exposure. Phase 2 partner revenue share via Stripe Connect would need a fresh look.
- ACH by default over 5,000 USD (spec section 8) is a Stripe Checkout configuration; Nacha rules are handled by Stripe.

## 7. Accessibility

- WCAG 2.2 AA is a product requirement (spec section 10). US legal exposure for a private online business comes through ADA Title III (courts split on websites; DOJ's 2024 Title II rule binds public entities only) and North Carolina's public-accommodation statute; selling compliance training raises the reputational stakes. OPEN: axe in CI for both themes (M5a); publish an accessibility statement at /legal/accessibility with a contact address.

## 8. Marks and names

- OPEN: knock-out search for "Robinson Employment Law Institute" and "RELI" at USPTO TESS and the NC Secretary of State before the brand is fixed; file the assumed business name certificate (N.C. Gen. Stat. 66-71.4) for the d/b/a in the county of the principal office.

## 9. Learning Core (resold API) - noted, out of RELI scope

The Core is a separate product with separate terms. Its own attorney pass on API ToS and DPA is still open (projects.md). Nothing in RELI's policies binds Core customers.

## Summary of blockers for Deon

1. Attorney: UPL naming opinion; review of the three legal drafts; proprietary-school exemption request (115D-88(4c)); marketing copy pass under 75-1.1.
2. CPA / Deon: NC sales-tax registration and Stripe Tax on the live Robinson Employment Institute, LLC Stripe account.
3. Deon: legal reviewer name, email and bar number for the gate.
4. Build follow-ups (not blockers to staging): /referral page or link removal; signup consent line; accessibility statement page; breach-response runbook; Stripe Tax in Checkout.
