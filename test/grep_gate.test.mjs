// SPEC TEST 5 and SPEC TEST 6 as node tests, plus the negative self-tests that
// prove the grep gate is not decorative: a planted Stripe id in an access path
// and a planted Core key in build output must each be caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, AUTH_PATHS } from './grep_ci.mjs';

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('SPEC TEST 5: access checks never reference a Stripe identifier (authorisation paths are payment-free)', async () => {
  const failures = (await scan(appDir, { clientDirs: [] })).filter(f => f.gate === 5);
  assert.deepEqual(failures, []);
});

test('SPEC TEST 6: the Core API key never reaches a client bundle (app/, components, public, .next/static are clean)', async () => {
  const failures = (await scan(appDir, { authPaths: [] })).filter(f => f.gate === 6);
  assert.deepEqual(failures, []);
});

test('SPEC TEST 5 self-test: a planted Stripe identifier in an access path FAILS the gate', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'reli-grep-'));
  try {
    for (const rel of AUTH_PATHS) {
      await mkdir(path.dirname(path.join(tmp, rel)), { recursive: true });
      await cp(path.join(appDir, rel), path.join(tmp, rel));
    }
    const target = path.join(tmp, 'src/lib/entitlements.mjs');
    await writeFile(target, `${await (await import('node:fs/promises')).readFile(target, 'utf8')}\n// if (user.priceId === 'price_1QzAbCdEfGhIjKlM') return true;\n`);
    const failures = await scan(tmp, { clientDirs: [] });
    assert.ok(failures.some(f => f.gate === 5 && f.file === 'src/lib/entitlements.mjs' && f.rule.includes('price_')), JSON.stringify(failures));
    // the plain word is enough, in any case
    await writeFile(path.join(tmp, 'src/lib/permissions.mjs'), 'export const x = 1; // stripe subscription active');
    const f2 = await scan(tmp, { clientDirs: [] });
    assert.ok(f2.some(f => f.file === 'src/lib/permissions.mjs'));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('SPEC TEST 6 self-test: a planted Core key in .next/static or a component FAILS the gate', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'reli-grep-'));
  try {
    await mkdir(path.join(tmp, '.next/static/chunks'), { recursive: true });
    await writeFile(path.join(tmp, '.next/static/chunks/main-abc123.js'),
      'fetch(u,{headers:{authorization:"Bearer "+process.env.CORE_API_KEY}})');
    let failures = await scan(tmp, { authPaths: [] });
    assert.ok(failures.some(f => f.gate === 6 && f.file.endsWith('main-abc123.js') && f.rule.includes('CORE_API_KEY')), JSON.stringify(failures));

    // a leaked VALUE (tenant prefix + 40 hex) with no env name at all
    await writeFile(path.join(tmp, '.next/static/chunks/main-abc123.js'),
      `const k="demo_${'0123456789abcdef'.repeat(2)}01234567";`);
    failures = await scan(tmp, { authPaths: [] });
    assert.ok(failures.some(f => f.gate === 6 && f.file.endsWith('main-abc123.js')), JSON.stringify(failures));

    // and in a component source file
    await mkdir(path.join(tmp, 'src/components'), { recursive: true });
    await writeFile(path.join(tmp, 'src/components/Leak.jsx'), 'export const key = process.env.CORE_API_KEY;');
    failures = await scan(tmp, { authPaths: [] });
    assert.ok(failures.some(f => f.file === 'src/components/Leak.jsx'));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
