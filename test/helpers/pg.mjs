// Embedded PostgreSQL for tests: real database, real roles, no root needed.
import EmbeddedPostgres from 'embedded-postgres';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import pg from 'pg';
import { migrate } from '../../db/migrate.mjs';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startTestDb() {
  const port = 54100 + Math.floor(Math.random() * 400);
  const server = new EmbeddedPostgres({
    databaseDir: mkdtempSync(path.join(os.tmpdir(), 'reli-pg-')),
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
  });
  await server.initialise();
  await server.start();
  const admin = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;

  // The roles file grants CONNECT on database "reli"; create it for real.
  const bootstrap = new pg.Client({ connectionString: admin });
  await bootstrap.connect();
  await bootstrap.query('create database reli');
  await bootstrap.end();

  const adminReli = `postgres://postgres:postgres@127.0.0.1:${port}/reli`;
  await migrate(adminReli);

  // Apply roles.sql, substituting the psql -v variables.
  let rolesSql = await readFile(path.join(appDir, 'db', 'roles.sql'), 'utf8');
  rolesSql = rolesSql
    .replaceAll(":'app_password'", "'app_pw'")
    .replaceAll(":'legal_password'", "'legal_pw'")
    .replaceAll(":'auditor_password'", "'auditor_pw'");
  const adm = new pg.Client({ connectionString: adminReli });
  await adm.connect();
  await adm.query(rolesSql);
  await adm.end();

  const pw = { reli_app: 'app_pw', reli_legal: 'legal_pw', reli_auditor: 'auditor_pw' };
  const url = role => `postgres://${role}:${pw[role]}@127.0.0.1:${port}/reli`;
  return {
    port,
    adminUrl: adminReli,
    appUrl: url('reli_app'),
    legalUrl: url('reli_legal'),
    auditorUrl: url('reli_auditor'),
    stop: () => server.stop(),
  };
}
