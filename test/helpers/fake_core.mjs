// A scripted Learning Core over HTTP for the end-to-end tests. Same routes and
// shapes as learning-core v1.0.3 for the subset the learner loop uses, one
// tenant, one course (a two-lesson cut of NC-ORG-001 with the real first
// constructed item), bearer-checked. `down()` makes it drop every connection
// so the app's degraded mode can be exercised (spec test 13).
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const ID = {
  course: '7cde1ea3-0000-4000-8000-000000000001',
  module: '7cde1ea3-0000-4000-8000-000000000002',
  lessonA: '7cde1ea3-0000-4000-8000-000000000003',
  lessonB: '7cde1ea3-0000-4000-8000-000000000004',
  assessment: '7cde1ea3-0000-4000-8000-000000000005',
  itemC: '7cde1ea3-0000-4000-8000-000000000006',
  itemS: '7cde1ea3-0000-4000-8000-000000000007',
  scheme: '7cde1ea3-0000-4000-8000-000000000008',
  rankWhite: '7cde1ea3-0000-4000-8000-000000000009',
  rankOrange: '7cde1ea3-0000-4000-8000-00000000000a',
};
export const FAKE_CORE_IDS = ID;

export async function startFakeCore({ apiKey = 'demo_' + 'ab'.repeat(20) } = {}) {
  const content = JSON.parse(await readFile(new URL('../../content/nc-org-001/assessment.json', import.meta.url), 'utf8'));
  const item1 = content.items.find(i => i.position === 1);
  const state = {
    down: false,
    learners: new Map(),      // external_ref -> learner
    enrollments: new Map(),   // id -> { learner_id, course_id, completed: Set }
    attempts: new Map(),      // id -> { enrollment_id, assessment_id, status, answers: Map, points: Map, score, passed }
    credentials: new Map(),   // public_ref -> credential
    calls: [],
    seq: 0,
  };
  const uuid = () => `eeeeeeee-0000-4000-8000-${String(++state.seq).padStart(12, '0')}`;
  const problem = (res, status, slug, detail) => {
    res.writeHead(status, { 'content-type': 'application/problem+json' });
    res.end(JSON.stringify({ type: `about:blank#${slug}`, title: slug, status, detail }));
  };
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  const course = {
    id: ID.course, title: 'North Carolina Employment Law Essentials', summary: 'A two-lesson cut for the browser suite.',
    scheme_id: ID.scheme, rank_id: ID.rankOrange, status: 'published',
    modules: [{ id: ID.module, title: 'Wage and Hour', position: 1 }],
    lessons: [
      { id: ID.lessonA, module_id: ID.module, title: 'Deductions from wages', position: 1, status: 'published', est_minutes: 6 },
      { id: ID.lessonB, module_id: ID.module, title: 'Final pay', position: 2, status: 'published', est_minutes: 4 },
    ],
    assessments: [{ id: ID.assessment, title: 'Orange Belt assessment', pass_percent: 80, status: 'published', max_attempts: 3 }],
  };
  const lessons = {
    [ID.lessonA]: { id: ID.lessonA, course_id: ID.course, module_id: ID.module, title: 'Deductions from wages', position: 1, status: 'published', est_minutes: 6,
      summary: 'When an employer may take money out of a paycheck.',
      blocks: [
        { type: 'prose', text: 'North Carolina permits deductions from wages only under narrow conditions set out in the Wage and Hour Act.' },
        { type: 'list', items: ['A written authorization signed by the employee.', 'Advance written notice of the amount.', 'Seven days notice for cash shortages.'] },
        { type: 'table', head: ['Situation', 'Rule'], rows: [['Overtime week', 'Deduction may not touch overtime wages'], ['Separation', 'Seven-day notice waived']] },
        { type: 'trap', text: 'A general acknowledgment signed at hire is not an authorization for a specific later deduction.' },
      ],
      citations: [{ authority: 'N.C. Gen. Stat. 95-25.8', url: 'https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_95/GS_95-25.8.html', verified_on: '2026-09-17' }] },
    [ID.lessonB]: { id: ID.lessonB, course_id: ID.course, module_id: ID.module, title: 'Final pay', position: 2, status: 'published', est_minutes: 4,
      blocks: [{ type: 'prose', text: 'Final wages are due on or before the next regular payday.' }, { type: 'trap', text: 'Withholding a final check over unreturned equipment is not a lawful remedy.' }],
      citations: [{ authority: 'N.C. Gen. Stat. 95-25.7', url: 'https://www.ncleg.gov/', verified_on: '2025-01-02' }] },
  };
  const assessment = {
    id: ID.assessment, course_id: ID.course, title: 'Orange Belt assessment', pass_percent: 80, max_attempts: 3, status: 'published',
    items: [
      { id: ID.itemC, position: 1, kind: 'constructed', prompt: item1.prompt, options: [], points: 4 },
      { id: ID.itemS, position: 2, kind: 'single', prompt: [{ type: 'prose', text: 'Final wages are due:' }], options: [{ id: 'a', text: 'On or before the next regular payday' }, { id: 'b', text: 'Within 72 hours' }], points: 1 },
    ],
  };
  const answerKey = {
    [ID.itemC]: item1.model_elements.map(e => ({ element: e.element, citation: e.citation })),
    [ID.itemS]: ['a'],
  };
  const schemes = { items: [{ id: ID.scheme, name: 'RELI Rank Ladder v1', ranks: [
    { id: ID.rankWhite, name: 'White', position: 1, meta: { fill: '#D8DCE0' } },
    { id: ID.rankOrange, name: 'Orange', position: 3, meta: { fill: '#CC6B2C' } },
  ] }] };

  const progress = enr => {
    const total = course.lessons.length;
    const done = enr.completed.size;
    return { id: enr.id, enrollment_id: enr.id, learner_id: enr.learner_id, course_id: enr.course_id, lessons_total: total, lessons_completed: done,
      percent_complete: Math.round((done / total) * 100), complete: done === total, completed_lesson_ids: [...enr.completed] };
  };
  const attemptBody = a => ({ id: a.id, enrollment_id: a.enrollment_id, assessment_id: a.assessment_id, status: a.status, passed: a.passed ?? null,
    score_percent: a.score ?? null, submitted_at: a.submitted_at ?? null,
    items: assessment.items.map(i => ({ item_id: i.id, position: i.position, points: i.points, points_awarded: a.points.has(i.id) ? a.points.get(i.id) : null, answered: a.answers.has(i.id) })) });
  const finalise = a => {
    let earned = 0, possible = 0, pending = false;
    for (const i of assessment.items) {
      possible += i.points;
      if (a.points.has(i.id) && a.points.get(i.id) !== null) earned += a.points.get(i.id); else pending = true;
    }
    a.score = Math.round((earned / possible) * 10000) / 100;
    if (pending) { a.status = 'needs_grading'; a.passed = null; } else { a.status = 'scored'; a.passed = a.score >= assessment.pass_percent; }
    a.submitted_at = new Date().toISOString();
    return { attempt_id: a.id, ...attemptBody(a) };
  };

  const server = http.createServer(async (req, res) => {
    if (state.down) { req.socket.destroy(); return; }
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    state.calls.push(`${req.method} ${p}`);
    let body = '';
    for await (const c of req) body += c;
    const b = body ? JSON.parse(body) : {};
    if (p === '/v1/health') return json(res, 200, { status: 'alive' });
    const m = p.match(/^\/v1\/verify\/([^/]+)$/);
    if (m) {
      const c = state.credentials.get(decodeURIComponent(m[1]));
      if (!c) return problem(res, 404, 'not-found', 'No credential matches.');
      return json(res, 200, c);
    }
    if (req.headers.authorization !== `Bearer ${apiKey}`) return problem(res, 401, 'unauthorized', 'bad key');
    let r;
    if (req.method === 'POST' && p === '/v1/learners') {
      const ex = state.learners.get(b.external_ref);
      const l = ex ? { ...ex, display_name: b.display_name } : { id: uuid(), external_ref: b.external_ref, display_name: b.display_name };
      state.learners.set(b.external_ref, l);
      return json(res, 201, l);
    }
    if (p === '/v1/schemes') return json(res, 200, schemes);
    if (p === `/v1/courses/${ID.course}`) return json(res, 200, course);
    if ((r = p.match(/^\/v1\/lessons\/(.+)$/))) return lessons[r[1]] ? json(res, 200, lessons[r[1]]) : problem(res, 404, 'not-found', 'no lesson');
    if (p === `/v1/assessments/${ID.assessment}/answer-key`) {
      return json(res, 200, { assessment_id: ID.assessment, course_id: ID.course, pass_percent: 80,
        items: assessment.items.map(i => ({ id: i.id, position: i.position, kind: i.kind, points: i.points, answer_key: answerKey[i.id] })) });
    }
    if (p === `/v1/assessments/${ID.assessment}`) return json(res, 200, assessment);
    if (req.method === 'POST' && p === '/v1/enrollments') {
      const existing = [...state.enrollments.values()].find(e => e.learner_id === b.learner_id && e.course_id === b.course_id);
      if (existing) return json(res, 201, progress(existing));
      const e = { id: uuid(), learner_id: b.learner_id, course_id: b.course_id, completed: new Set() };
      state.enrollments.set(e.id, e);
      return json(res, 201, progress(e));
    }
    if ((r = p.match(/^\/v1\/enrollments\/([^/]+)\/lessons\/([^/]+)\/complete$/))) {
      const e = state.enrollments.get(r[1]); if (!e) return problem(res, 404, 'not-found', 'no enrollment');
      e.completed.add(r[2]); return json(res, 200, progress(e));
    }
    if ((r = p.match(/^\/v1\/enrollments\/([^/]+)$/))) { const e = state.enrollments.get(r[1]); return e ? json(res, 200, progress(e)) : problem(res, 404, 'not-found', 'no enrollment'); }
    if (req.method === 'POST' && p === '/v1/attempts') {
      const e = state.enrollments.get(b.enrollment_id); if (!e) return problem(res, 404, 'not-found', 'no enrollment');
      if (e.completed.size < course.lessons.length) return problem(res, 409, 'invariant-violation', 'Complete every lesson before starting the assessment.');
      const a = { id: uuid(), enrollment_id: e.id, assessment_id: b.assessment_id, status: 'in_progress', answers: new Map(), points: new Map() };
      state.attempts.set(a.id, a); return json(res, 201, attemptBody(a));
    }
    if ((r = p.match(/^\/v1\/attempts\/([^/]+)\/answers$/))) {
      const a = state.attempts.get(r[1]); if (!a) return problem(res, 404, 'not-found', 'no attempt');
      for (const an of b.answers) a.answers.set(an.item_id, an.response);
      return json(res, 200, { attempt_id: a.id, answers_recorded: b.answers.length });
    }
    if ((r = p.match(/^\/v1\/attempts\/([^/]+)\/submit$/))) {
      const a = state.attempts.get(r[1]); if (!a) return problem(res, 404, 'not-found', 'no attempt');
      if (a.status !== 'in_progress') return problem(res, 409, 'invariant-violation', 'This attempt has already been submitted.');
      const s = a.answers.get(ID.itemS);
      a.points.set(ID.itemS, (Array.isArray(s) ? s[0] : s) === 'a' ? 1 : 0);
      if (a.answers.has(ID.itemC)) a.points.set(ID.itemC, null); else a.points.set(ID.itemC, 0);
      return json(res, 200, finalise(a));
    }
    if ((r = p.match(/^\/v1\/attempts\/([^/]+)\/grade$/))) {
      const a = state.attempts.get(r[1]); if (!a) return problem(res, 404, 'not-found', 'no attempt');
      if (a.status !== 'needs_grading') return problem(res, 409, 'invariant-violation', 'Only needs_grading attempts can be graded.');
      for (const g of b.grades) a.points.set(g.item_id, Math.min(g.points_awarded, assessment.items.find(i => i.id === g.item_id).points));
      return json(res, 200, finalise(a));
    }
    if ((r = p.match(/^\/v1\/attempts\/([^/]+)$/))) { const a = state.attempts.get(r[1]); return a ? json(res, 200, attemptBody(a)) : problem(res, 404, 'not-found', 'no attempt'); }
    if (req.method === 'POST' && p === '/v1/credentials') {
      const a = state.attempts.get(b.attempt_id); if (!a) return problem(res, 404, 'not-found', 'no attempt');
      if (!a.passed) return problem(res, 409, 'invariant-violation', 'Credential requires a passing attempt.');
      const existing = [...state.credentials.values()].find(c => c.attempt_id === a.id);
      if (existing) return json(res, 201, existing);
      const e = state.enrollments.get(a.enrollment_id);
      const learner = [...state.learners.values()].find(l => l.id === e.learner_id);
      const c = { id: uuid(), attempt_id: a.id, public_ref: `LC-E2E-${String(state.credentials.size + 1).padStart(4, '0')}-TEST`, status: 'valid',
        issued_at: new Date().toISOString(), learner_name: learner?.display_name ?? 'Learner', course_title: course.title, rank_name: 'Orange', issuer: 'RELI (test)', competencies: [] };
      state.credentials.set(c.public_ref, c); return json(res, 201, c);
    }
    return problem(res, 404, 'not-found', `unscripted route ${req.method} ${p}`);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port, url: `http://127.0.0.1:${port}/`, apiKey, state, ids: ID, course,
        down: () => { state.down = true; },
        up: () => { state.down = false; },
        stop: () => new Promise(r => server.close(() => r())),
      });
    });
  });
}
