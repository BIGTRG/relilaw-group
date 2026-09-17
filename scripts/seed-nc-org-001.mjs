// Seed NC-ORG-001 (Orange Belt, North Carolina employment law for org admins
// and small employers) into a Learning Core tenant from the JSON source under
// content/nc-org-001. Idempotent: looks the course up by its external code
// (carried in the title, since the Core has no external-code field) before
// creating anything, and skips lessons and the assessment that already exist.
//
// Everything is created with status 'draft'. The Core exposes exactly one
// publication flag, status: 'draft' | 'published', on course, lesson and
// assessment. Nothing here ever sets 'published'; that is the legal
// reviewer's action through the app's gate.
//
//   CORE_BASE_URL=https://engine.geniuseye.ai/v1/learningcore-demo/ \
//   CORE_API_KEY=<engine app token> node scripts/seed-nc-org-001.mjs
//
// Optional: SCHEME_ID=<uuid> to pin the progression scheme; otherwise the
// first scheme whose name starts with 'RELI Rank Ladder' is used and its
// 'Orange' rank is attached to the course.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoreClient } from '../src/lib/core-client.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'nc-org-001');
const readJson = async (rel) => JSON.parse(await readFile(path.join(root, rel), 'utf8'));

async function listAll(req, pathname, key) {
  // Cursor pagination: follow next_cursor until exhausted.
  const out = [];
  let cursor;
  for (;;) {
    const page = await req('GET', cursor ? `${pathname}?cursor=${encodeURIComponent(cursor)}` : pathname);
    out.push(...(page[key] || page.items || page.data || []));
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return out;
}

async function main() {
  const core = createCoreClient();
  const req = core._internals.request;

  const course = await readJson('course.json');
  const assessmentSrc = await readJson('assessment.json');
  const lessonFiles = (await readdir(path.join(root, 'lessons'))).filter(f => f.endsWith('.json')).sort();
  const lessons = (await Promise.all(lessonFiles.map(f => readJson(path.join('lessons', f)))))
    .sort((a, b) => a.position - b.position);

  // 1. Scheme and Orange rank.
  const schemes = await listAll(req, '/v1/schemes', 'items');
  const scheme = process.env.SCHEME_ID
    ? schemes.find(s => s.id === process.env.SCHEME_ID)
    : schemes.find(s => s.name.startsWith('RELI Rank Ladder'));
  if (!scheme) throw new Error('No RELI progression scheme found in this tenant; set SCHEME_ID');
  const orange = scheme.ranks.find(r => r.name === course.rank_code.charAt(0).toUpperCase() + course.rank_code.slice(1));
  if (!orange) throw new Error(`Scheme ${scheme.id} has no rank named for ${course.rank_code}`);

  // 2. Course: look up by external code before creating.
  const courses = await listAll(req, '/v1/courses', 'data');
  let created = false;
  let existing = courses.find(c => c.title.startsWith(`${course.code} `) || c.title.startsWith(`${course.code}·`) || c.title.startsWith(`${course.code} ·`));
  if (!existing) {
    existing = await req('POST', '/v1/courses', {
      body: {
        title: course.title,
        summary: course.summary,
        scheme_id: scheme.id,
        rank_id: orange.id,
        status: 'draft',
        modules: course.modules.map(m => ({ title: m.title, position: m.position })),
      },
      idempotencyKey: `${course.code}-course-v1`,
    });
    created = true;
  }
  const courseId = existing.id;

  // 3. Lessons: skip any position that already exists.
  let full = await req('GET', `/v1/courses/${courseId}`);
  const havePositions = new Set((full.lessons || []).map(l => l.position));
  const lessonIds = {};
  for (const l of lessons) {
    if (havePositions.has(l.position)) {
      lessonIds[l.position] = (full.lessons.find(x => x.position === l.position) || {}).id;
      continue;
    }
    const made = await req('POST', `/v1/courses/${courseId}/lessons`, {
      body: {
        title: l.title,
        summary: l.summary,
        position: l.position,
        module_position: l.module,
        est_minutes: l.est_minutes,
        status: 'draft',
        blocks: l.blocks,
        citations: l.citations.map(c => ({ authority: c.authority, url: c.url, verified_on: c.verified_on })),
      },
      idempotencyKey: `${course.code}-lesson-${l.position}-v1`,
    });
    lessonIds[l.position] = made.id;
  }

  // 4. Assessment: constructed items keep their model elements (element +
  //    governing citation) in answer_key, which the Core stores server-side
  //    and never returns to the learner. Points equal element count so a
  //    grader can award one point per element demonstrated.
  full = await req('GET', `/v1/courses/${courseId}`);
  let assessment = (full.assessments || []).find(a => a.title === assessmentSrc.title);
  if (!assessment) {
    assessment = await req('POST', '/v1/assessments', {
      body: {
        course_id: courseId,
        title: assessmentSrc.title,
        pass_percent: assessmentSrc.pass_percent,
        max_attempts: assessmentSrc.max_attempts,
        status: 'draft',
        items: assessmentSrc.items.map(it => it.kind === 'constructed'
          ? { position: it.position, kind: 'constructed', points: it.points, prompt: it.prompt,
              answer_key: it.model_elements.map(e => ({ element: e.element, citation: e.citation })) }
          : { position: it.position, kind: it.kind, points: it.points, prompt: it.prompt,
              options: it.options, answer_key: it.answer_key }),
      },
      idempotencyKey: `${course.code}-assessment-v1`,
    });
  }

  full = await req('GET', `/v1/courses/${courseId}`);
  console.log(JSON.stringify({
    tenant_base: process.env.CORE_BASE_URL,
    code: course.code,
    created_course: created,
    scheme_id: scheme.id,
    rank_id: orange.id,
    course_id: courseId,
    course_status: full.status,
    modules: (full.modules || []).length,
    lessons: (full.lessons || []).length,
    lesson_ids: lessonIds,
    assessment_id: assessment.id,
    assessment_status: assessment.status,
  }, null, 2));
}

main().catch(e => { console.error(e.message, e.problem ? JSON.stringify(e.problem) : ''); process.exit(1); });
