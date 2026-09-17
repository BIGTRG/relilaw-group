// Console modules (§6). SERVER ONLY.
//   02 Compliance reporting   — completion counts per org, never attempt detail
//   03 Catalogue and pricing  — product list, price edits (staff), audited
//   04 Billing                — payment-processor event ledger + entitlement ledger, read-only
//   06 Legislative queue      — the Core's stale-content query, surfaced
//   07 Credential registry    — see registry.mjs
//
// Every function takes the connection it must use. Auditor sessions are
// handed the reli_auditor pool by console-auth.mjs, so even a bug in this
// file could not let an auditor write: the database role says no.

import { can, isReadOnlySession } from './permissions.mjs';

export class ConsoleError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ConsoleError';
    this.code = code;
    this.status = status;
  }
}

const UUID = /^[0-9a-f-]{36}$/i;

// ---- 02 Compliance reporting ------------------------------------------------

// The wall (§7): this query joins org membership to enrollment_link and
// credential_link and NOTHING else. attempt_link, scores, answers and any
// Core attempt record are not reachable from here, and the result carries
// only counts and dates. Kept as a constant so a test can read it.
export const COMPLIANCE_SQL = `
  with members as (
    select rg.org_id, rg.user_id
      from role_grant rg
     where rg.org_id is not null and rg.revoked_at is null
       and rg.role in ('employee', 'org_admin')
     group by rg.org_id, rg.user_id
  )
  select o.id as org_id, o.name as org_name,
         count(distinct m.user_id)::int                         as members,
         count(distinct e.user_id)::int                         as enrolled,
         count(distinct c.user_id)::int                         as completed,
         max(c.issued_at)                                        as last_completion_at
    from org o
    left join members m on m.org_id = o.id
    left join enrollment_link e on e.user_id = m.user_id
    left join credential_link c on c.user_id = m.user_id and c.revoked_at is null
   where ($1::uuid is null or o.id = $1::uuid)
   group by o.id, o.name
   order by o.name`;

// Per-member rows for one org: name, enrolled-on, completed-on, credential
// reference. Same wall: no attempt table appears here.
export const COMPLIANCE_MEMBERS_SQL = `
  select u.id as user_id, u.display_name, u.email,
         min(e.created_at) as enrolled_at,
         max(c.issued_at)  as completed_at,
         (array_agg(c.public_ref order by c.issued_at desc))[1] as credential_ref
    from role_grant rg
    join app_user u on u.id = rg.user_id
    left join enrollment_link e on e.user_id = u.id
    left join credential_link c on c.user_id = u.id and c.revoked_at is null
   where rg.org_id = $1::uuid and rg.revoked_at is null and rg.role in ('employee', 'org_admin')
   group by u.id, u.display_name, u.email
   order by u.display_name`;

// Field names that must never appear in a compliance payload.
export const COMPLIANCE_FORBIDDEN_FIELDS = /score|attempt|answer|item|points|response/i;

/** orgScope: null for staff/auditor (all orgs) or an org id for an org admin. */
export async function complianceReport(conn, { orgScope = null } = {}) {
  const { rows } = await conn.query(COMPLIANCE_SQL, [orgScope]);
  return rows.map(r => ({
    ...r,
    completion_rate: r.members ? Math.round((r.completed / r.members) * 100) : 0,
  }));
}

export async function complianceMembers(conn, orgId) {
  if (!UUID.test(orgId)) return [];
  const { rows } = await conn.query(COMPLIANCE_MEMBERS_SQL, [orgId]);
  return rows;
}

// ---- 03 Catalogue and pricing ----------------------------------------------

export async function listProducts(conn) {
  const { rows } = await conn.query(
    'select code, core_course_id, title, rank_code, price_cents, currency, active, updated_at from product order by created_at');
  return rows;
}

/** Staff only. Records the change as an audit_event with before/after. */
export async function updatePrice(conn, { code, priceCents, active, actor, reason }) {
  if (!can(actor.roles, 'change_price_or_entitlement') || isReadOnlySession(actor.roles)) {
    throw new ConsoleError('forbidden', 'Only staff can change a price', 403);
  }
  const cents = Number(priceCents);
  if (!Number.isInteger(cents) || cents < 0 || cents > 100_000_000) {
    throw new ConsoleError('bad_price', 'Price must be a whole number of cents, zero or more', 400);
  }
  const client = await conn.connect();
  try {
    await client.query('begin');
    const before = await client.query('select price_cents, active from product where code = $1 for update', [code]);
    if (!before.rows[0]) throw new ConsoleError('not_found', 'Unknown product', 404);
    const nextActive = typeof active === 'boolean' ? active : before.rows[0].active;
    await client.query(
      'update product set price_cents = $2, active = $3, updated_at = now() where code = $1', [code, cents, nextActive]);
    await client.query(
      `insert into audit_event (actor_user_id, actor_role, action, object_type, object_ref, from_state, to_state, reason, meta)
       values ($1, 'staff', 'product.price_changed', 'product', $2, $3, $4, $5, $6)`,
      [actor.userId, code, String(before.rows[0].price_cents), String(cents), reason ?? null,
       JSON.stringify({ active_before: before.rows[0].active, active_after: nextActive })]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  return (await conn.query('select * from product where code = $1', [code])).rows[0];
}

// ---- 04 Billing (read-only) ------------------------------------------------

export async function billingLedger(conn, { limit = 100 } = {}) {
  const [events, entitlements] = await Promise.all([
    conn.query(
      `select id, type, received_at, processed_at,
              payload->'data'->'object'->>'id' as object_id,
              payload->'data'->'object'->>'amount_total' as amount_total,
              payload->'data'->'object'->>'currency' as currency
         from stripe_event order by received_at desc limit $1`, [limit]),
    conn.query(
      `select e.id, e.key, e.source, e.granted_at, e.expires_at, e.revoked_at, e.revoke_reason,
              u.display_name, u.email
         from entitlement e join app_user u on u.id = e.user_id
        order by e.granted_at desc limit $1`, [limit]),
  ]);
  return { events: events.rows, entitlements: entitlements.rows };
}

// ---- 06 Stale content -----------------------------------------------------

/** Wraps the Core's stale query with a legible degraded state. */
export async function staleContent(core, days = 180) {
  const d = Math.min(3650, Math.max(1, Number(days) || 180));
  try {
    const res = await core.staleContent(d);
    const items = res?.items ?? res?.data ?? (Array.isArray(res) ? res : []);
    return { degraded: false, days: d, items };
  } catch (e) {
    if (e?.name === 'CoreUnavailableError' || e?.name === 'CoreRequestError') return { degraded: true, days: d, items: [], detail: e.message };
    throw e;
  }
}

// ---- shared ---------------------------------------------------------------

export async function recentAudit(conn, { limit = 50 } = {}) {
  const { rows } = await conn.query(
    `select a.id, a.at, a.action, a.object_type, a.object_ref, a.from_state, a.to_state, a.reason, a.actor_role,
            u.display_name as actor_name
       from audit_event a left join app_user u on u.id = a.actor_user_id
      order by a.at desc, a.id desc limit $1`, [limit]);
  return rows;
}
