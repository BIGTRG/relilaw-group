// CI grep gates (SPEC TEST 5 and SPEC TEST 6). Run standalone: node test/grep_ci.mjs
// 5. No payment-processor identifier may appear in an authorisation path.
// 6. The Core API key (env name or value pattern) may never reach client code
//    or the build output (.next/static). Run AFTER `next build` in CI.
// The scanner is exported so test/grep_gate.test.mjs can prove, with planted
// violations, that it actually catches what it claims to catch.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUTH_PATHS = [
  'src/lib/entitlements.mjs',
  'src/lib/permissions.mjs',
  'src/lib/session.mjs',
];
// Payment-processor identifiers that must never inform an access decision.
export const FORBIDDEN_IN_AUTH = [
  /[Ss]tripe/, /\bprice_[A-Za-z0-9]{8,}/, /\bprod_[A-Za-z0-9]{8,}/, /\bsub_[A-Za-z0-9]{8,}/,
  /\bcus_[A-Za-z0-9]{8,}/, /\bsubscription\b/i, /\bcheckout\b/i,
];
// Allowed: entitlement `source` VALUES like purchase:sub_123 appear only as
// data written by the payments layer; the authorisation files must not
// contain the literals at all.

export const CLIENT_DIRS = ['app', 'src/components', 'public', '.next/static'];
// The env name, the Core key shape (tenant prefix + hex secret; tenant slugs
// are lower-case letters/digits), and the legacy lc_ prefix.
export const FORBIDDEN_IN_CLIENT = [/CORE_API_KEY/, /lc_[a-z0-9]{20,}/i, /\b[a-z][a-z0-9]{2,15}_[0-9a-f]{40}\b/];

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Scan one tree. Returns [{ file, rule, gate }] — empty means clean. */
export async function scan(appDir, { authPaths = AUTH_PATHS, clientDirs = CLIENT_DIRS } = {}) {
  const failures = [];
  for (const rel of authPaths) {
    const text = await readFile(path.join(appDir, rel), 'utf8').catch(() => null);
    if (text === null) { failures.push({ file: rel, rule: 'missing', gate: 5 }); continue; }
    for (const re of FORBIDDEN_IN_AUTH) {
      if (re.test(text)) failures.push({ file: rel, rule: String(re), gate: 5 });
    }
  }
  for (const dir of clientDirs) {
    for await (const file of walk(path.join(appDir, dir))) {
      if (!/\.(m?js|jsx|tsx?|css|html|json|map|txt)$/.test(file)) continue;
      const text = await readFile(file, 'utf8').catch(() => '');
      for (const re of FORBIDDEN_IN_CLIENT) {
        if (re.test(text)) failures.push({ file: path.relative(appDir, file), rule: String(re), gate: 6 });
      }
    }
  }
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const failures = await scan(appDir);
  for (const f of failures) {
    console.error(`FAIL (spec test ${f.gate}): ${f.file} matches ${f.rule} — ${f.gate === 5 ? 'authorisation must not know about payments' : 'core key reaching the client'}`);
  }
  if (failures.length) {
    console.error(`grep gate: ${failures.length} violation(s)`);
    process.exit(1);
  }
  console.log('grep gate: clean (auth paths payment-free; no core key in client output)');
}
