// End-to-end harness: embedded Postgres + fake Redis + scripted Core over HTTP
// + the BUILT app (node .next/standalone/server.js, exactly what PM2 runs),
// driven by Playwright Chromium. `npm run build` must have run first; CI does
// it before `npm test`. If the build output is missing the suite fails fast
// with that message rather than silently passing.
import { spawn } from 'node:child_process';
import { access, cp, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { startTestDb } from './pg.mjs';
import { startFakeRedis } from './fake_redis.mjs';
import { startFakeCore } from './fake_core.mjs';

export const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function freePort() {
  const net = await import('node:net');
  return new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function waitFor(url, ms = 30_000) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url, { redirect: 'manual' }); if (r.status < 500) return; } catch { /* not yet */ }
    if (Date.now() - t0 > ms) throw new Error(`app did not answer at ${url} within ${ms}ms`);
    await new Promise(r => setTimeout(r, 250));
  }
}

/** Boot everything. Returns handles plus helpers to sign up and to talk to the DB. */
export async function startStack({ verifyLimit = 1000 } = {}) {
  const standalone = path.join(appDir, '.next', 'standalone');
  await access(path.join(standalone, 'server.js')).catch(() => {
    throw new Error('No build output: run `npm run build` before the browser suite (CI does).');
  });
  // The standalone server serves /_next/static from its own tree; mirror the
  // deploy step (copy .next/static in) into a scratch copy so the source tree
  // is untouched and parallel runs do not fight.
  const run = await mkdtemp(path.join(os.tmpdir(), 'reli-e2e-'));
  const dist = path.join(run, 'standalone');
  await cp(standalone, dist, { recursive: true });
  await cp(path.join(appDir, '.next', 'static'), path.join(dist, '.next', 'static'), { recursive: true });

  const db = await startTestDb();
  const redis = await startFakeRedis();
  const core = await startFakeCore();
  const port = await freePort();
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port), HOSTNAME: '127.0.0.1',
    DATABASE_URL: db.appUrl, DATABASE_URL_LEGAL: db.legalUrl, DATABASE_URL_AUDITOR: db.auditorUrl,
    REDIS_URL: redis.url,
    CORE_BASE_URL: core.url, CORE_API_KEY: core.apiKey,
    AUTH_KEK: randomBytes(32).toString('base64'),
    DOOR_OVERRIDE: '/dojo',
    DOMAIN: 'relilaw.test', PUBLIC_APP_URL: `http://localhost:${port}`,
    RP_ID: 'localhost', WEBAUTHN_ORIGINS: `http://localhost:${port}`,
    VERIFY_RATE_LIMIT_PER_MIN: String(verifyLimit),
  };
  delete env.SMTP_HOST; // no mail leaves the box from a test
  const logPath = path.join(run, 'app.log');
  const logs = [];
  const child = spawn(process.execPath, [path.join(dist, 'server.js')], { env, cwd: dist, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', d => logs.push(String(d)));
  child.stderr.on('data', d => logs.push(String(d)));
  const base = `http://localhost:${port}`;
  try {
    await waitFor(`${base}/login`);
  } catch (e) {
    child.kill('SIGKILL');
    throw new Error(`${e.message}\n${logs.join('')}`);
  }

  const app = new pg.Pool({ connectionString: db.appUrl });
  const admin = new pg.Pool({ connectionString: db.adminUrl });
  await app.query(
    `insert into product (code, core_course_id, title, rank_code, price_cents) values ('NC-ORG-001', $1, $2, 'orange', 19900)`,
    [core.ids.course, core.course.title]);

  return {
    base, port, db, redis, core, app, admin, logs, child,
    async stop() {
      child.kill('SIGTERM');
      await new Promise(r => { child.once('exit', r); setTimeout(r, 3000); });
      await writeFile(logPath, logs.join('')).catch(() => {});
      await app.end(); await admin.end();
      await Promise.all([core.stop(), redis.stop(), db.stop()]);
    },
  };
}

/** Sign up through the real form-post route and return the session cookie header. */
export async function signUp(stack, { email, displayName = 'Test Learner', password = 'Correct-Horse-Battery-9' }) {
  const res = await fetch(`${stack.base}/api/auth/signup`, { method: 'POST', body: JSON.stringify({ email, displayName, password }), redirect: 'manual',
    headers: { 'content-type': 'application/json', accept: 'application/json' } });
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookie.map(c => c.split(';')[0]).join('; ');
  if (!cookie || res.status >= 400) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  const { rows } = await stack.app.query('select id, external_ref, email, display_name from app_user where email = $1', [email]);
  return { user: rows[0], cookie, setCookie };
}

/** Grant the course entitlement directly (comp), the way staff would. */
export async function grantCourse(stack, userId, code = 'NC-ORG-001') {
  const { grantEntitlement } = await import('../../src/lib/entitlements.mjs');
  return grantEntitlement(stack.app, { userId, key: `course:${code}`, source: 'comp:e2e' });
}

/** A Playwright BrowserContext carrying the session cookie(s). */
export async function contextWithSession(browser, stack, setCookie) {
  const ctx = await browser.newContext({ baseURL: stack.base, viewport: { width: 1200, height: 900 } });
  const cookies = setCookie.map(raw => {
    const [pair, ...attrs] = raw.split(';').map(s => s.trim());
    const [name, ...v] = pair.split('=');
    const a = Object.fromEntries(attrs.map(x => { const [k, ...val] = x.split('='); return [k.toLowerCase(), val.join('=') || true]; }));
    return { name, value: v.join('='), domain: 'localhost', path: a.path || '/', httpOnly: 'httponly' in a, secure: 'secure' in a, sameSite: 'Lax' };
  });
  await ctx.addCookies(cookies);
  return ctx;
}
