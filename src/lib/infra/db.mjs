// Postgres pool singleton. Connects as reli_app (the role with NO INSERT on
// publish_signoff). The legal sign-off path opens its own reli_legal
// connection explicitly — it never flows through this pool.
import pg from 'pg';

let pool;

export function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString: url, max: 10 });
  }
  return pool;
}

export const q = (text, params) => getPool().query(text, params);
