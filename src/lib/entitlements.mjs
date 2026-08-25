// THE KEYSTONE (§3).
// Every "can this person see this?" in the codebase calls hasEntitlement().
// The check reads key and dates only. It never mentions the payment
// processor, a price id, a product id, a billing agreement or a purchase record — the CI grep
// test (test/grep_ci.mjs) fails the build if one appears in this file.

const CACHE_TTL_MS = 60_000; // spec: never cache an entitlement check longer than 60s

/**
 * @param {import('pg').Pool} db
 * @param {string} userId
 * @param {string} key   e.g. 'course:NC-ORG-001'
 */
export async function hasEntitlement(db, userId, key) {
  const { rowCount } = await db.query(
    `select 1 from entitlement
      where user_id = $1
        and key = $2
        and revoked_at is null
        and (expires_at is null or expires_at > now())
      limit 1`,
    [userId, key],
  );
  return rowCount > 0;
}

/** Cached variant for hot paths. TTL hard-capped at 60 seconds. */
export function makeCachedHasEntitlement(db, redis) {
  return async function cachedHasEntitlement(userId, key) {
    const ck = `ent:${userId}:${key}`;
    const hit = await redis.get(ck);
    if (hit !== null) return hit === '1';
    const ok = await hasEntitlement(db, userId, key);
    await redis.set(ck, ok ? '1' : '0', 'PX', CACHE_TTL_MS);
    return ok;
  };
}

/**
 * Grant is idempotent per (user, key, source): the same webhook delivered
 * twice grants exactly one entitlement (spec test 7).
 */
export async function grantEntitlement(db, { userId, orgId = null, key, source, expiresAt = null }) {
  if (!source) throw new Error('entitlement requires a source');
  const { rows } = await db.query(
    `insert into entitlement (user_id, org_id, key, source, expires_at)
     select $1, $2, $3, $4, $5
      where not exists (
        select 1 from entitlement
         where user_id = $1 and key = $3 and source = $4 and revoked_at is null)
     returning id`,
    [userId, orgId, key, source, expiresAt],
  );
  return rows[0]?.id ?? null; // null = already granted, nothing duplicated
}

/** Refunds, disputes and revocations all come through this one path. */
export async function revokeEntitlement(db, redis, { userId, key, reason }) {
  await db.query(
    `update entitlement set revoked_at = now(), revoke_reason = $3
      where user_id = $1 and key = $2 and revoked_at is null`,
    [userId, key, reason ?? null],
  );
  // Access must be gone on the NEXT request (spec test 8): drop the cache now.
  if (redis) await redis.del(`ent:${userId}:${key}`);
}
