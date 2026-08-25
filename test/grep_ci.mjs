// CI grep gates (spec tests 5 and 6). Run standalone: node test/grep_ci.mjs
// 1. No payment-processor identifier may appear in an authorisation path.
// 2. The Core API key (env name or value pattern) may never reach client code.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const AUTH_PATHS = [
  'src/lib/entitlements.mjs',
  'src/lib/permissions.mjs',
  'src/lib/session.mjs',
];
// Payment-processor identifiers that must never inform an access decision.
const FORBIDDEN_IN_AUTH = [
  /[Ss]tripe/, /\bprice_[A-Za-z0-9]{8,}/, /\bprod_[A-Za-z0-9]{8,}/, /\bsub_[A-Za-z0-9]{8,}/,
  /\bcus_[A-Za-z0-9]{8,}/, /\bsubscription\b/i, /\bcheckout\b/i,
];
// Allowed: entitlement `source` VALUES like purchase:sub_123 appear only as
// data written by the payments layer; the authorisation files must not
// contain the literals at all.

const CLIENT_DIRS = ['app', 'src/components', 'public', '.next/static'];
const FORBIDDEN_IN_CLIENT = [/CORE_API_KEY/, /lc_[a-z0-9]{20,}/i];

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

let failures = 0;

for (const rel of AUTH_PATHS) {
  const text = await readFile(path.join(appDir, rel), 'utf8');
  for (const re of FORBIDDEN_IN_AUTH) {
    if (re.test(text)) {
      console.error(`FAIL: ${rel} matches ${re} — authorisation must not know about payments`);
      failures++;
    }
  }
}

for (const dir of CLIENT_DIRS) {
  for await (const file of walk(path.join(appDir, dir))) {
    if (!/\.(m?js|jsx|tsx?|css|html|json|map)$/.test(file)) continue;
    const text = await readFile(file, 'utf8').catch(() => '');
    for (const re of FORBIDDEN_IN_CLIENT) {
      if (re.test(text)) {
        console.error(`FAIL: ${path.relative(appDir, file)} matches ${re} — core key reaching the client`);
        failures++;
      }
    }
  }
}

if (failures) {
  console.error(`grep gate: ${failures} violation(s)`);
  process.exit(1);
}
console.log('grep gate: clean (auth paths payment-free; no core key in client output)');
