// Runs db/migrations/*.sql in order, once each, as a privileged PG user.
// Usage: DATABASE_URL_ADMIN=postgres://... node db/migrate.mjs
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(connectionString = process.env.DATABASE_URL_ADMIN) {
  if (!connectionString) throw new Error('DATABASE_URL_ADMIN is required');
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`create table if not exists schema_migration (
      name text primary key, applied_at timestamptz not null default now())`);
    const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
    for (const f of files) {
      const { rowCount } = await client.query('select 1 from schema_migration where name = $1', [f]);
      if (rowCount) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migration (name) values ($1)', [f]);
        await client.query('commit');
        console.log(`applied ${f}`);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`migration ${f} failed: ${e.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().catch(e => { console.error(e.message); process.exit(1); });
}
