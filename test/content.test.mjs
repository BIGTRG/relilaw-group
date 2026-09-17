// NC-ORG-001 content source validation (M4a).
// The JSON under content/nc-org-001 is the authoritative source the seed
// script pushes to the Learning Core. These tests keep the source honest:
// structure, typed blocks only, a trap in every lesson, a verified citation
// on every lesson, element-scored assessment items, eight review items.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'nc-org-001');
const readJson = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf8'));

const course = await readJson('course.json');
const assessment = await readJson('assessment.json');
const reviewItems = await readJson('review-items.json');
const lessonFiles = (await readdir(path.join(root, 'lessons'))).filter(f => f.endsWith('.json')).sort();
const lessons = await Promise.all(lessonFiles.map(f => readJson(path.join('lessons', f))));

const BLOCK_TYPES = new Set(['prose', 'list', 'table', 'trap']);
const HTML = /<\/?[a-z][\s\S]*?>/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Emoji and pictographs are banned everywhere in this product.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/u;

function* strings(v) {
  if (typeof v === 'string') yield v;
  else if (Array.isArray(v)) for (const x of v) yield* strings(x);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) yield* strings(x);
}

test('course manifest: code, 6 modules, draft and unsigned, reviewer null', () => {
  assert.equal(course.code, 'NC-ORG-001');
  assert.ok(course.title.includes('NC-ORG-001'), 'title must carry the external code so the seed can find it');
  assert.equal(course.modules.length, 6);
  assert.equal(course.status, 'draft');
  assert.equal(course.signed, false);
  assert.equal(course.reviewer, null);
  course.modules.forEach((m, i) => {
    assert.equal(m.position, i + 1);
    assert.equal(m.status, 'draft');
    assert.equal(m.signed, false);
    assert.equal(m.reviewer, null);
  });
});

test('exactly 22 lessons, contiguous positions, every module populated', () => {
  assert.equal(lessons.length, 22);
  const positions = lessons.map(l => l.position).sort((a, b) => a - b);
  assert.deepEqual(positions, Array.from({ length: 22 }, (_, i) => i + 1));
  const perModule = new Map();
  for (const l of lessons) {
    assert.ok(l.module >= 1 && l.module <= 6, `lesson ${l.position} module out of range`);
    perModule.set(l.module, (perModule.get(l.module) || 0) + 1);
  }
  for (let m = 1; m <= 6; m++) assert.ok(perModule.get(m) >= 3, `module ${m} has fewer than 3 lessons`);
});

test('every lesson: typed blocks only, at least one trap, no raw HTML, disclaimer last', () => {
  for (const l of lessons) {
    assert.ok(typeof l.title === 'string' && l.title.length > 0);
    assert.ok(Number.isInteger(l.est_minutes) && l.est_minutes >= 1 && l.est_minutes <= 600);
    assert.ok(Array.isArray(l.blocks) && l.blocks.length >= 3, `lesson ${l.position} too thin`);
    for (const b of l.blocks) {
      assert.ok(BLOCK_TYPES.has(b.type), `lesson ${l.position}: unknown block type ${b.type}`);
      if (b.type === 'prose' || b.type === 'trap') assert.ok(typeof b.text === 'string' && b.text.length > 0);
      if (b.type === 'list') assert.ok(Array.isArray(b.items) && b.items.length > 0 && b.items.every(i => typeof i === 'string'));
      if (b.type === 'table') {
        assert.ok(Array.isArray(b.head) && b.head.length > 0);
        assert.ok(Array.isArray(b.rows) && b.rows.length > 0);
        for (const r of b.rows) assert.equal(r.length, b.head.length, `lesson ${l.position}: ragged table row`);
      }
      for (const s of strings(b)) assert.ok(!HTML.test(s), `lesson ${l.position}: raw HTML in block`);
    }
    const traps = l.blocks.filter(b => b.type === 'trap');
    assert.ok(traps.length >= 1, `lesson ${l.position} has no trap block`);
    assert.ok(traps.every(t => t.text.length >= 120), `lesson ${l.position}: trap must not read like a note`);
    const last = l.blocks[l.blocks.length - 1];
    assert.equal(last.type, 'prose');
    assert.equal(last.text, 'This is training, not legal advice.');
  }
});

test('every lesson: at least one citation with authority, url and ISO verified_on', () => {
  for (const l of lessons) {
    assert.ok(Array.isArray(l.citations) && l.citations.length >= 1, `lesson ${l.position} has no citations`);
    for (const c of l.citations) {
      assert.ok(typeof c.authority === 'string' && c.authority.length > 0 && c.authority.length <= 500);
      assert.ok(typeof c.url === 'string' && /^https?:\/\//.test(c.url), `lesson ${l.position}: citation url missing`);
      assert.ok(ISO_DATE.test(c.verified_on), `lesson ${l.position}: verified_on must be YYYY-MM-DD`);
      assert.ok(!Number.isNaN(Date.parse(c.verified_on)));
    }
  }
});

test('assessment: constructed items carry >=2 model elements, each with a citation; keyed items have keys', () => {
  assert.ok(assessment.items.length >= 6);
  assert.equal(assessment.status, 'draft');
  const constructed = assessment.items.filter(i => i.kind === 'constructed');
  assert.ok(constructed.length >= 6, 'one element-scored item per module at minimum');
  for (const it of assessment.items) {
    assert.ok(['single', 'multi', 'constructed'].includes(it.kind));
    assert.ok(Array.isArray(it.prompt) && it.prompt.every(b => BLOCK_TYPES.has(b.type)));
    for (const s of strings(it.prompt)) assert.ok(!HTML.test(s));
    if (it.kind === 'constructed') {
      assert.ok(Array.isArray(it.model_elements) && it.model_elements.length >= 2, `item ${it.position}: needs >=2 model elements`);
      for (const e of it.model_elements) {
        assert.ok(typeof e.element === 'string' && e.element.length > 20);
        assert.ok(typeof e.citation === 'string' && /§|NCAC|Department|Division/.test(e.citation), `item ${it.position}: element lacks a governing citation`);
      }
      assert.equal(it.points, it.model_elements.length, `item ${it.position}: points must equal element count for per-element partial credit`);
    } else {
      assert.ok(Array.isArray(it.options) && it.options.length >= 2);
      assert.ok(Array.isArray(it.answer_key) && it.answer_key.length >= 1);
      const ids = new Set(it.options.map(o => o.id));
      for (const k of it.answer_key) assert.ok(ids.has(k), `item ${it.position}: answer_key references unknown option`);
      assert.ok(typeof it.citation === 'string' && it.citation.length > 0);
    }
  }
  const positions = assessment.items.map(i => i.position);
  assert.deepEqual([...positions].sort((a, b) => a - b), Array.from({ length: positions.length }, (_, i) => i + 1));
});

test('exactly 8 attorney review items, each substantive and tied to a lesson', () => {
  assert.equal(reviewItems.length, 8);
  const slugs = new Set(lessonFiles.map(f => f.replace(/\.json$/, '')));
  for (const r of reviewItems) {
    assert.ok(typeof r.title === 'string' && r.title.length >= 20);
    assert.ok(typeof r.detail === 'string' && r.detail.length >= 200, `review item too thin: ${r.title}`);
    assert.ok(slugs.has(r.lesson_ref), `review item lesson_ref not a lesson file: ${r.lesson_ref}`);
  }
});

test('no emoji anywhere in the content source', () => {
  for (const s of strings({ course, assessment, reviewItems, lessons })) {
    assert.ok(!EMOJI.test(s), `emoji found: ${s.slice(0, 60)}`);
  }
});
