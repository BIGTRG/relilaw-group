# RELI Application

Robinson Employment Law Institute — consumer #1 of the Learning Core.
Spec: ../PROMPT-TWO-reli-application.md (phase 1 only: NC, White→Orange).

## Layout
```
db/migrations/  001 app-side schema (identity, entitlements, gate, MODEL ONLY tables)
db/roles.sql    reli_app / reli_legal / reli_auditor — the legal-publish gate is
                enforced HERE, at the database role level, with hard guards
src/lib/        permissions (exact §2 matrix) · entitlements (the keystone) ·
                core-client (timeouts/retries/breaker/degraded) · session · password
src/lib/billing/ Stripe at the app edge (M3): stripe.mjs (pinned API version, env key),
                checkout.mjs (hosted Checkout builder, ACH-default rule, refuses owned),
                webhook.mjs (stripe_event ledger = idempotency gate → grant/revoke),
                meters.mjs (phase-2 stub; usage_records is dead, use Billing Meters)
src/lib/mail/   adapter (every send → email_log) · smtp.mjs (postfix, STARTTLS 587) ·
                templates (enrolment confirmation, credential issued, receipt)
app/api/billing/ checkout (form POST → 303 to Stripe) · webhook (raw body, signature)
test/           node --test; DB tests run on embedded Postgres; grep_ci.mjs is
                the CI gate for spec tests 5 & 6
```

## Invariants (do not relax)
- Only `reli_legal` can INSERT `publish_signoff`. No override, no force_publish.
- Authorisation never references a payment identifier (grep-gated).
- `external_ref` is permanent (DB trigger) and never an email.
- Entitlement cache TTL hard cap: 60s. Revocation deletes the cache key.
- Core lessons honored client-side: Idempotency-Key on writes, µs-precise cursors
  (when pagination lands), degraded mode instead of stack traces.

## Payments & mail (M3)
- Flow: Library **Buy** → `POST /api/billing/checkout` (session required, refuses if
  already entitled) → Stripe hosted Checkout → `POST /api/billing/webhook`
  (signature verified, `stripe_event` insert-if-absent, `checkout.session.completed`
  paid → `grantEntitlement(source='stripe:<event.id>')` → Core enrol (savepoint;
  deferred if the Core is down) → receipt + enrolment mail after commit).
  `charge.refunded` (full) and `charge.dispute.created` → `revokeEntitlement`.
- ACH (`us_bank_account`) is listed first whenever the amount is over $5,000.
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_APP_URL` (defaults to
  `https://app.${DOMAIN}`), `SMTP_HOST/PORT/USER/PASS/FROM`. No account id, price id
  or webhook secret lives in code or migrations.
- Webhook endpoint registration lives in Stripe (`webhookEndpoints.create` with the
  events in `HANDLED_EVENTS`), not in this repo.

## Run tests
npm test          # unit + embedded-PG gate tests
npm run test:grep # CI grep gates
