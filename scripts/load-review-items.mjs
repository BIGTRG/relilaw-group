// Load attorney-review items for a course into review_item, upserting by
// (course, title). Reads content/<course-lower>/review-items.json when it
// exists; otherwise seeds eight placeholders so the gate has something to
// block on. Resolved items are never re-opened.
//   DATABASE_URL=postgres://reli_app:... node scripts/load-review-items.mjs [NC-ORG-001]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { upsertReviewItems, placeholderReviewItems } from '../src/lib/pipeline.mjs';

const courseRef = (process.argv[2] ?? 'NC-ORG-001').toUpperCase();
const file = path.join(process.cwd(), 'content', courseRef.toLowerCase(), 'review-items.json');

let items;
try {
  const raw = JSON.parse(await readFile(file, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.items ?? [];
  items = list.map(it => ({
    core_course_ref: courseRef,
    title: String(it.title ?? '').trim(),
    detail: it.detail ?? it.description ?? it.note ?? null,
  })).filter(it => it.title);
  console.log(`loaded ${items.length} items from ${path.relative(process.cwd(), file)}`);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  items = placeholderReviewItems(courseRef, 8);
  console.log(`no ${path.relative(process.cwd(), file)}; seeding ${items.length} placeholder items`);
}

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const r = await upsertReviewItems(db, items);
  const { rows } = await db.query(`select count(*)::int as n from review_item where core_course_ref = $1 and status = 'open'`, [courseRef]);
  console.log(`inserted ${r.inserted}, updated ${r.updated}; ${rows[0].n} open for ${courseRef}`);
} finally {
  await db.end();
}
