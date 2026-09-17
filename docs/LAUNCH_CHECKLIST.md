# RELI phase 1 launch checklist

Status as of 2026-09-17 07:10 UTC, checked live against the staging deployment
(app/studio/admin.relilaw.org on server #2, Learning Core v1.0.4 on server #3,
mail server M). Legend: DONE / OPEN / BLOCKED-ON-DEON. Every item shows the
evidence used to mark it. This document follows skills/deon_app_launch_checklist.

## 1. End-to-end test before hardening

| Item | Status | Evidence |
|---|---|---|
| Signup, login, library, lessons, assessment, credential, public verify on the deployed instance | DONE (sample course, 9/17) | todo.md M2 E2E; credential LC-DA4D-SBXX-SQYC-U5 verifiable through the Core |
| Pay through Stripe Checkout, webhook grants entitlement, refund revokes | DONE (test mode, 9/17) | todo.md M3 E2E pay+refund; stripe_event ledger on staging |
| Full 22-lesson NC-ORG-001 journey with element-scored grading of constructed items | OPEN | Grading UI is M5a scope; Core exposes `/v1/assessments/{id}/answer-key` (v1.0.3) and `/v1/attempts/{id}/grade` |
| Repeatable e2e script committed | OPEN | M5a scope (test/, scripts/). Backup drill script committed at ops/restore-drill.sh |
| Emails actually arrive | DONE (from reli@geniuseye.ai) | email_log on staging: 2 rows, last 2026-09-17 06:04 UTC; postfix log shows delivery; relilaw.org sender pending DNS (section 5) |

## 2. Hardening

| Item | Status | Evidence |
|---|---|---|
| TLS valid on all three hosts | DONE | Let's Encrypt cert `relilaw` covers app/admin/studio.relilaw.org, expires 2026-12-16; certbot.timer active; HSTS max-age=31536000 |
| Security headers | DONE | Live response: X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, HSTS |
| PM2 process saved for reboot | DONE | `/root/.pm2/dump.pm2` contains `relilaw`; `pm2-root` unit enabled |
| Environment file permissions | DONE | `/etc/relilaw/env` root:root 0600; `/etc/learning-core/env` root:root 0600 |
| Postgres and Redis not exposed | DONE | PG `listen_addresses=localhost`; redis-reli bound 127.0.0.1:6390; ufw active; fail2ban active |
| Console IP allow-list | BLOCKED-ON-DEON | `/etc/nginx/relilaw-console-allow.conf` has zero `allow` lines, so admin.relilaw.org is open to the internet (behind login + MFA). Need Deon's static IP(s); then add `allow x.x.x.x;` lines and `deny all;` and `nginx -s reload` |
| Secrets not in the repository | DONE | grep for sk_live/sk_test/whsec_/lc_ keys/private keys/passwords over the repo: only `db/roles.sql` psql variables and test fixtures; `.gitignore` excludes `.env*`; no tracked env files |
| Core API key never reaches the client | DONE | `npm run test:grep` clean on 2026-09-17 build (auth paths payment-free; no core key in client output) |
| No test-auth flags or demo bypasses | DONE | No `ALLOW_TEST_AUTH` or equivalent in repo; `DOOR_OVERRIDE` is dev-only and unset on staging |
| Stripe mode | OPEN (intentionally) | Staging `STRIPE_SECRET_KEY` begins `sk_test` (TRGPay sandbox), `STRIPE_WEBHOOK_SECRET` set. Launch requires the Robinson Employment Institute, LLC Stripe account (live key + live webhook endpoint) |
| Core tenant | OPEN | Staging `CORE_BASE_URL=http://10.2.0.3:8100/v1/learningcore-demo/`; switch to `.../learningcore/` after the legal reviewer signs NC-ORG-001 in the reli tenant |
| Backups nightly, restore verified | DONE | `relilaw-pg-backup.timer` (01:45 UTC, 14-day retention, 0600 files) and `learning-core-pg-backup.timer` (01:30 UTC) installed and run once; restore drills PASS on both (ops/README.md). Borg host backup on #3 had not run since 2026-08-24 (one archive); now on `learning-core-borg.timer` 03:30 UTC and started manually 2026-09-17 |
| Auditor role read-only at the database | DONE | `reli_auditor` has SELECT and no INSERT on app_user (checked live); no reli role is superuser or bypassrls |
| Legal gate enforced in SQL | DONE (M4b) | Migration 003 pipeline gate; spec test 1 and 2 are M5a scope for CI |
| Credential revocation propagates to the Core | OPEN (Core side DONE) | Core v1.0.4 `POST /v1/credentials/{id}/revoke` live; app registry currently revokes locally only and must call the Core (M5a/M6 follow-up) |

## 3. Legal pages

| Item | Status | Evidence |
|---|---|---|
| Terms of Service, Privacy Policy, Training Disclaimer, refund policy | DONE as DRAFT | `content/legal/{terms,privacy,disclaimer}.md` rendered at `/legal/terms`, `/legal/privacy`, `/legal/disclaimer` (static, server-rendered, tokens only). Each carries the callout "DRAFT — requires licensed attorney review before publication"; placeholders in square brackets |
| Attorney review of the drafts | BLOCKED-ON-DEON | Needs the legal reviewer's name and email (still not on record) or outside counsel |
| Footer links on every door | OPEN | Not wired. Add links to `/legal/terms`, `/legal/privacy`, `/legal/disclaimer` in the Dojo layout footer, Studio and Console layouts, the signup form (consent line: "By creating an account you accept the Terms and Privacy Policy"), the checkout confirmation, and the public verify page footer. `middleware.js` already passes `/legal/*` through on every host |
| Compliance pre-check | DONE | docs/COMPLIANCE_PRECHECK.md |
| Accessibility statement | OPEN | No statement page yet. Recommend `/legal/accessibility` (same renderer): WCAG 2.2 AA target, both themes, how to report a barrier (admin@trgtechlink.com), known limitations, date of last audit; publish after the axe run (spec test 11, M5a) |

## 4. Training materials

| Item | Status | Evidence |
|---|---|---|
| Written quick-start for operators, reviewer and learners | DONE | docs/TRAINING_NOTES.md (step lists and screens for the legal reviewer gate, Console modules, learner journey) |
| Training videos | OPEN | Produce from TRAINING_NOTES.md after grading UI lands; narration via general_tools TTS |

## 5. Deon's build standards

| Item | Status | Evidence |
|---|---|---|
| Custom frontend and backend, no template | DONE | Next.js App Router with hand-built components against brand/relidesignsystem.css; custom auth (argon2id, passkeys, TOTP) |
| Own fleet, own PostgreSQL, code on GitHub | DONE | Server #2 PM2 `relilaw`, DB `reli` on host PG14; repo BIGTRG/relilaw-group; Core BIGTRG/learning-core v1.0.4 on server #3 |
| Vendor APIs via GE API Engine | DONE | Core reached through engine providers `learningcore` / `learningcore-demo`, app token `relilaw`. Stripe is a direct integration by design (money never touches the Core or the engine) |
| App email via Genius Eye Mail | DONE for sender; OPEN for domain | SMTP mail.geniuseye.ai:587 as reli@geniuseye.ai. relilaw.org signing key generated on M (selector `reli`) and opendkim configured; geniuseye.ai signing re-tested OK. DNS records below not yet published |

### 5.1 relilaw.org mail DNS: ready-to-approve block (GoDaddy, zone relilaw.org)

Current state (queried 2026-09-17 via 1.1.1.1): no TXT at apex (no SPF), no MX,
no `reli._domainkey`, and a GoDaddy default `_dmarc` record
(`v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;`)
that would quarantine our own mail until SPF/DKIM align. Also found: the apex A
record points at GoDaddy parking (3.33.130.190 / 15.197.148.33), not at server #2,
although app/studio/admin resolve correctly to 178.105.183.91.

Records to add or replace (nothing has been changed; Deon approves, then apply via GoDaddy API `PUT /v1/domains/relilaw.org/records/<TYPE>/<name>`):

```
TYPE  NAME                 TTL   VALUE
MX    @                    3600  10 mail.geniuseye.ai.
TXT   @                    3600  v=spf1 mx ip4:178.104.209.97 -all
TXT   reli._domainkey      3600  v=DKIM1; h=sha256; k=rsa; s=email; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqila50m8vxSOXBGWYhpm8YIKH0hZDnZBeobJBPBspUOOWC2uYTZm5cr0MIlQv6Mx0LNaNQIREKInFE0JD4xUZr6iv7dAmCf8c2C1e1cSLXY5lhCV8pYRHQNHH8MmvS94rvJq/ffaumjYZel95bp/nR8XQ679aKRPp9eQxXwsdQgKDyEk5YeGPmkCNGc2L/R9dkEGAkfXq7hB8bP4/YyyB+swdhVbgtnJu0queSba5A6rJClyZkiQaYcV9E+eEFSKxtgd1AIhTZ0OG9d2zfErC64XB5h0Q/tO++4K+m4elU5CALrhvIBM5HFDYSyta9oK0zeFPSR6VXGJ5L5gfl8MgwIDAQAB
TXT   _dmarc               3600  v=DMARC1; p=quarantine; sp=quarantine; pct=100; adkim=s; aspf=s; rua=mailto:postmaster@geniuseye.ai; ruf=mailto:postmaster@geniuseye.ai; fo=1
```

Notes
- SPF uses `-all` because the only sender is M (178.104.209.97, PTR mail.geniuseye.ai). Add `ip4:178.105.21.227` only if server #1 will ever send as relilaw.org.
- DMARC replaces the GoDaddy default record (same name `_dmarc`). Start at `p=quarantine`; move to `p=reject` after two clean weeks of reports.
- After DNS publishes: on M add `relilaw.org, mail.relilaw.org` to postfix `mydestination` (not done yet: adding it before MX exists would swallow outbound mail to relilaw.org addresses locally), create the `noreply`/`reli` mailbox mapping, then set `SMTP_FROM="RELI <noreply@relilaw.org>"` in `/etc/relilaw/env` and `pm2 restart relilaw --update-env`. Send a test to a Gmail address and confirm `dkim=pass header.d=relilaw.org`, `spf=pass`, `dmarc=pass` in Authentication-Results.
- Optional: A record `@` to 178.105.183.91 (redirect to app) once the marketing site decision is made; A `mail` is not needed because MX points at mail.geniuseye.ai.

## 6. Launch report

OPEN: post the per-item status above to #robinson-hr-law (C0C0XCUKPBP) when M5a closes the remaining test items. Credentials go by DM only.

## Blockers summary (Deon)

1. Legal reviewer name and email; attorney review of the three legal drafts and the UPL naming opinion (docs/COMPLIANCE_PRECHECK.md).
2. Robinson Employment Institute, LLC Stripe account (live key, webhook secret) and Stripe Tax decision (NC sales tax on digital courses is likely due: see COMPLIANCE_PRECHECK section 3).
3. Approve the relilaw.org DNS block above.
4. Static IP(s) for the Console allow-list.
5. Decision on a neutral domain plus TLS for the Learning Core (currently private-net via the engine, which is acceptable for phase 1).
