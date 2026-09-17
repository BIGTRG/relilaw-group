// Credential registry (Console module 07). SERVER ONLY.
// Every credential issued, to whom, when, on what course. Revocation with a
// reason and an audit trail. The Core has no revoke endpoint yet (its
// OpenAPI at v1.0.2 exposes none), so revocation is recorded here and the
// public verify page overlays it. When the Core gains one, revokeCredential()
// calls it through `core.revokeCredential` if that function exists.

import { can, isReadOnlySession } from './permissions.mjs';

export class RegistryError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'RegistryError';
    this.code = code;
    this.status = status;
  }
}

const UUID = /^[0-9a-f-]{36}$/i;

export async function listCredentials(conn, { q = '', limit = 200 } = {}) {
  const term = String(q ?? '').trim();
  const { rows } = await conn.query(
    `select c.core_credential_id, c.public_ref, c.issued_at, c.revoked_at, c.revoke_reason, c.core_course_id,
            u.id as user_id, u.display_name, u.email, u.external_ref,
            p.code as product_code, p.title as product_title,
            rv.display_name as revoked_by_name
       from credential_link c
       join app_user u on u.id = c.user_id
       left join product p on p.core_course_id = c.core_course_id
       left join app_user rv on rv.id = c.revoked_by
      where $1 = '' or c.public_ref ilike '%' || $1 || '%' or u.display_name ilike '%' || $1 || '%'
         or u.email::text ilike '%' || $1 || '%' or p.code ilike '%' || $1 || '%'
      order by c.issued_at desc limit $2`, [term, limit]);
  return rows;
}

export async function getCredential(conn, id) {
  if (!UUID.test(id)) return null;
  const rows = await listCredentials(conn, { limit: 1000 });
  return rows.find(r => r.core_credential_id === id) ?? null;
}

/** Local revocation record keyed by public reference, for the verify page. */
export async function localRevocation(conn, publicRef) {
  const { rows } = await conn.query(
    'select revoked_at, revoke_reason from credential_link where public_ref = $1 and revoked_at is not null', [publicRef]);
  return rows[0] ?? null;
}

/**
 * Staff only. One-way. Records reason + actor, writes audit_event, and calls
 * the Core if the client offers a revoke method. Returns { coreRevoked }.
 */
export async function revokeCredential(conn, { credentialId, reason, actor, core = null }) {
  if (!can(actor.roles, 'revoke_credential') || isReadOnlySession(actor.roles)) {
    throw new RegistryError('forbidden', 'Only staff can revoke a credential', 403);
  }
  const why = String(reason ?? '').trim();
  if (!why) throw new RegistryError('reason_required', 'A revocation needs a reason', 400);
  if (!UUID.test(credentialId)) throw new RegistryError('not_found', 'Credential not found', 404);

  const client = await conn.connect();
  let coreRevoked = false;
  try {
    await client.query('begin');
    const { rows } = await client.query(
      `update credential_link set revoked_at = now(), revoke_reason = $2, revoked_by = $3
        where core_credential_id = $1 and revoked_at is null returning public_ref, user_id`, [credentialId, why, actor.userId]);
    if (!rows[0]) throw new RegistryError('not_found', 'Credential not found or already revoked', 404);
    if (core && typeof core.revokeCredential === 'function') {
      await core.revokeCredential({ credentialId, reason: why });
      coreRevoked = true;
    }
    await client.query(
      `insert into audit_event (actor_user_id, actor_role, action, object_type, object_ref, from_state, to_state, reason, meta)
       values ($1, 'staff', 'credential.revoked', 'credential', $2, 'active', 'revoked', $3, $4)`,
      [actor.userId, credentialId, why, JSON.stringify({ public_ref: rows[0].public_ref, core_revoked: coreRevoked })]);
    await client.query('commit');
    return { publicRef: rows[0].public_ref, coreRevoked };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
