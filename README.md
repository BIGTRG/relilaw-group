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

## Run tests
npm test          # unit + embedded-PG gate tests
npm run test:grep # CI grep gates
