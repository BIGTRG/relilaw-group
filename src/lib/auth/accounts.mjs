// Account lifecycle: signup, password login with lockout, credential checks.
// external_ref is minted here once and never changes (DB trigger enforces).
import { hashPassword, verifyPassword, passwordAcceptable } from '../password.mjs';
import { mintExternalRef } from '../core-client.mjs';

const LOCKOUT_MAX_FAILS = 10;
const LOCKOUT_WINDOW_S = 15 * 60;
const LOCKOUT_DURATION_S = 15 * 60;

export function createAccounts({ db, redis }) {
  const failKey = email => `authfail:${email.toLowerCase()}`;
  const lockKey = email => `authlock:${email.toLowerCase()}`;

  return {
    async createUser({ email, displayName, password }) {
      if (!passwordAcceptable(password)) {
        throw Object.assign(new Error('password does not meet requirements'), { code: 'weak_password' });
      }
      const externalRef = mintExternalRef();
      const argon2Hash = await hashPassword(password);
      const client = await db.connect();
      try {
        await client.query('begin');
        const { rows } = await client.query(
          `insert into app_user (external_ref, email, display_name)
           values ($1, $2, $3) returning id, external_ref, email, display_name`,
          [externalRef, email, displayName],
        );
        const user = rows[0];
        await client.query(
          `insert into password_credential (user_id, argon2_hash) values ($1, $2)`,
          [user.id, argon2Hash],
        );
        await client.query(
          `insert into role_grant (user_id, role) values ($1, 'learner')`,
          [user.id],
        );
        await client.query(
          `insert into audit_event (actor_user_id, actor_role, action, object_type, object_ref)
           values ($1::uuid, 'learner', 'user.created', 'app_user', $2)`,
          [user.id, String(user.id)],
        );
        await client.query('commit');
        return user;
      } catch (err) {
        await client.query('rollback');
        if (err.code === '23505') {
          throw Object.assign(new Error('email already registered'), { code: 'email_taken' });
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async isLocked(email) {
      return (await redis.exists(lockKey(email))) === 1;
    },

    /** Returns { user, roles } on success, null on bad credentials. Throws {code:'locked'}. */
    async verifyLogin({ email, password }) {
      if (await this.isLocked(email)) {
        throw Object.assign(new Error('account temporarily locked'), { code: 'locked' });
      }
      const { rows } = await db.query(
        `select u.id, u.external_ref, u.email, u.display_name, u.status,
                pc.argon2_hash,
                coalesce(array_agg(rg.role) filter (where rg.role is not null), '{}') as roles
         from app_user u
         left join password_credential pc on pc.user_id = u.id
         left join role_grant rg on rg.user_id = u.id
         where u.email = $1
         group by u.id, pc.argon2_hash`,
        [email],
      );
      const row = rows[0];
      const ok = row?.argon2_hash
        ? await verifyPassword(row.argon2_hash, password)
        : await verifyPassword(await hashPassword('timing-equalizer'), password).catch(() => false);
      if (!ok || !row || row.status !== 'active') {
        const fails = await redis.incr(failKey(email));
        if (fails === 1) await redis.expire(failKey(email), LOCKOUT_WINDOW_S);
        if (fails >= LOCKOUT_MAX_FAILS) {
          await redis.set(lockKey(email), '1', 'EX', LOCKOUT_DURATION_S);
          await redis.del(failKey(email));
        }
        return null;
      }
      await redis.del(failKey(email));
      const { argon2_hash, status, ...user } = row;
      return { user, roles: row.roles };
    },

    async setPassword({ userId, password }) {
      if (!passwordAcceptable(password)) {
        throw Object.assign(new Error('password does not meet requirements'), { code: 'weak_password' });
      }
      const argon2Hash = await hashPassword(password);
      await db.query(
        `insert into password_credential (user_id, argon2_hash) values ($1, $2)
         on conflict (user_id) do update set argon2_hash = excluded.argon2_hash, updated_at = now()`,
        [userId, argon2Hash],
      );
    },
  };
}
