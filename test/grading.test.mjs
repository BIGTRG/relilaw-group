// Constructed-response grading (spec section 5): deterministic per-element
// partial credit, calibrated against the REAL NC-ORG-001 assessment content,
// then the full submit flow through the learning service with a scripted
// Core that behaves like v1.0.3 (needs_grading -> answer-key -> grade).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { startTestDb } from './helpers/pg.mjs';
import { matchElement, gradeConstructed, promptText, termsFor, stems, MIN_HITS, HIT_RATIO } from '../src/lib/grading.mjs';
import { createLearningService } from '../src/lib/learning.mjs';
import { grantEntitlement } from '../src/lib/entitlements.mjs';
import { createMailer, createMemoryTransport } from '../src/lib/mail/index.mjs';

const content = JSON.parse(await readFile(new URL('../content/nc-org-001/assessment.json', import.meta.url), 'utf8'));
const constructed = content.items.filter(i => i.kind === 'constructed');

test('grading: the rule is explicit and its constants are what the module documents', () => {
  assert.equal(MIN_HITS, 3);
  assert.equal(HIT_RATIO, 0.25);
  assert.deepEqual([...stems('The employer must give seven days\u2019 written notice of the amount before the payday.')].sort(),
    ['7', 'amount', 'befor', 'day', 'employer', 'give', 'notic', 'payday', 'written'].sort());
  // prompt words never count towards an element
  const el = { element: 'The cashier must sign a written authorization stating the reason.' };
  const terms = termsFor(el, 'A cashier signed an acknowledgment. What must the employer do?', [el]);
  assert.ok(!terms.some(t => t.term === 'cashier'));
  assert.ok(terms.some(t => t.term === 'authorization'));
});

test('grading: every model element in NC-ORG-001 is earned by its own wording and by no sibling wording', () => {
  let cross = 0;
  for (const it of constructed) {
    const p = promptText(it.prompt);
    it.model_elements.forEach((el, i) => {
      it.model_elements.forEach((other, j) => {
        const r = matchElement(other, el.element, p, it.model_elements);
        if (i === j) assert.ok(r.matched, `item ${it.position} element ${i + 1} must match itself: ${JSON.stringify(r)}`);
        else if (r.matched) cross++;
      });
    });
  }
  assert.equal(cross, 0, 'an element text must not earn a sibling element');
});

test('grading: a paraphrased learner answer earns the elements it covers and not the ones it omits; junk earns nothing', () => {
  const item1 = constructed.find(i => i.position === 1);
  const p1 = promptText(item1.prompt);
  const good = 'The employer needs a written authorization signed by the cashier that states the reason, signed on or before payday. A general acknowledgment at hire is not enough. The employee must get advance written notice of the actual amount and notice of the right to withdraw the authorization. For a shortage the employer has to give 7 days written notice of the amount before the payday. Because it is an overtime week the deduction can only bring pay down to minimum wage for the 40 regular hours and cannot touch the 6 overtime hours.';
  assert.deepEqual(item1.model_elements.map(el => matchElement(el, good, p1, item1.model_elements).matched), [true, true, true, true]);

  const item2 = constructed.find(i => i.position === 2);
  const p2 = promptText(item2.prompt);
  const partial = 'Title VII and the ADA cover employers with 15 or more employees; part-timers count so 22 qualifies. The Pregnant Workers Fairness Act also applies at 15 and requires reasonable accommodation unless undue hardship. FMLA does not apply because there are fewer than 50 employees.';
  assert.deepEqual(item2.model_elements.map(el => matchElement(el, partial, p2, item2.model_elements).matched), [true, true, true, false], 'ADEA element omitted');

  const junk = 'I do not know. The employer should ask a lawyer about the cashier and the register shortage deduction.';
  assert.deepEqual(item1.model_elements.map(el => matchElement(el, junk, p1, item1.model_elements).matched), [false, false, false, false]);
  assert.deepEqual(item1.model_elements.map(el => matchElement(el, '', p1, item1.model_elements).matched), [false, false, false, false]);
});

test('grading: points equal matched elements, capped at the item points; only constructed items are graded; author keywords override derived terms', () => {
  const items = [
    { id: 'c1', kind: 'constructed', points: 2, prompt: [{ type: 'prose', text: 'Q' }] },
    { id: 's1', kind: 'single', points: 1, prompt: [] },
  ];
  const answerKey = [
    { id: 'c1', kind: 'constructed', points: 2, answer_key: [
      { element: 'Seven days written notice of the amount before payday.', citation: 'x' },
      { element: 'Anything at all', citation: 'y', keywords: ['minimum wage', 'overtime premium'] },
      { element: 'Extra element beyond the points', citation: 'z', keywords: ['kangaroo', 'platypus', 'wombat'] },
    ] },
    { id: 's1', kind: 'single', points: 1, answer_key: ['a'] },
  ];
  const answers = [
    { item_id: 'c1', response: ['Give 7 days written notice of the amount. Only the minimum wage, never overtime premium hours. kangaroo platypus wombat'] },
    { item_id: 's1', response: ['a'] },
  ];
  const { grades, detail } = gradeConstructed({ items, answerKey, answers });
  assert.deepEqual(grades, [{ item_id: 'c1', points_awarded: 2 }]);
  assert.deepEqual(detail[0].elements, [true, true, true]);
  assert.equal(detail[0].points_awarded, 2, 'capped at the item points');
});

// ---- the flow through the learning service ------------------------------

let db, app, user, svc, core, transport;
const COURSE = '11111111-1111-4111-8111-111111111111';
const ASSESS = '44444444-4444-4444-8444-444444444444';
const C1 = '55555555-0000-4000-8000-000000000001';
const S1 = '55555555-0000-4000-8000-000000000002';

function fakeCore() {
  const state = { attempts: new Map(), graded: [], keyReads: 0, creds: 0 };
  const answers = new Map();
  return {
    state,
    upsertLearner: async ({ externalRef }) => ({ id: 'aaaaaaaa-0000-4000-8000-000000000001', external_ref: externalRef }),
    listSchemes: async () => ({ items: [{ id: 's1', name: 'Ladder', ranks: [{ id: 'r1', name: 'White', position: 1, meta: {} }, { id: 'r3', name: 'Orange', position: 3, meta: {} }] }] }),
    getCourse: async id => ({ id, title: 'NC-ORG-001', rank_id: 'r3', status: 'published', modules: [], lessons: [], assessments: [{ id: ASSESS, status: 'published' }] }),
    enroll: async () => ({ id: 'bbbbbbbb-0000-4000-8000-000000000001' }),
    getEnrollment: async id => ({ enrollment_id: id, lessons_total: 0, lessons_completed: 0, percent_complete: 100, complete: true, completed_lesson_ids: [] }),
    getAssessment: async id => ({ id, course_id: COURSE, title: 'Final', pass_percent: 80, items: [
      { id: C1, kind: 'constructed', points: 4, prompt: constructed[0].prompt, position: 1 },
      { id: S1, kind: 'single', points: 1, prompt: [], options: [{ id: 'a', text: 'A' }], position: 2 },
    ] }),
    getAnswerKey: async id => { state.keyReads++; return { assessment_id: id, pass_percent: 80, items: [
      { id: C1, kind: 'constructed', points: 4, answer_key: constructed[0].model_elements },
      { id: S1, kind: 'single', points: 1, answer_key: ['a'] },
    ] }; },
    startAttempt: async () => { const id = `cccccccc-0000-4000-8000-00000000000${state.attempts.size + 1}`; state.attempts.set(id, 'in_progress'); return { id }; },
    answerAttempt: async ({ attemptId, answers: a }) => { answers.set(attemptId, a); return { ok: true }; },
    submitAttempt: async id => {
      state.attempts.set(id, 'needs_grading');
      const single = (answers.get(id) ?? []).find(a => a.item_id === S1);
      return { attempt_id: id, status: 'needs_grading', score_percent: 0, passed: null,
        items: [{ item_id: C1, points: 4, points_awarded: null }, { item_id: S1, points: 1, points_awarded: single?.response?.[0] === 'a' ? 1 : 0 }] };
    },
    gradeAttempt: async ({ attemptId, grades }) => {
      state.graded.push(grades);
      const c = grades.find(g => g.item_id === C1)?.points_awarded ?? 0;
      const single = (answers.get(attemptId) ?? []).find(a => a.item_id === S1);
      const s = single?.response?.[0] === 'a' ? 1 : 0;
      const pct = Math.round(((c + s) / 5) * 10000) / 100;
      state.attempts.set(attemptId, 'scored');
      state.last = { pct, c, s };
      return { attempt_id: attemptId, status: 'scored', score_percent: pct, passed: pct >= 80, items: [{ item_id: C1, points: 4, points_awarded: c }, { item_id: S1, points: 1, points_awarded: s }] };
    },
    issueCredential: async () => { state.creds++; return { id: `dddddddd-0000-4000-8000-00000000000${state.creds}`, public_ref: `LC-GRADE-REF${state.creds}` }; },
    getAttempt: async id => ({ id, status: state.attempts.get(id), passed: state.last?.pct >= 80, score_percent: state.last?.pct ?? 0,
      items: [{ item_id: C1, points: 4, points_awarded: state.last?.c ?? null }, { item_id: S1, points: 1, points_awarded: state.last?.s ?? null }] }),
  };
}

before(async () => {
  db = await startTestDb();
  app = new pg.Pool({ connectionString: db.appUrl });
  const u = await app.query(`insert into app_user (external_ref, email, display_name) values ('reli_GRADER01', 'g@example.org', 'Grace Learner') returning id, external_ref, display_name, email`);
  user = u.rows[0];
  await app.query(`insert into product (code, core_course_id, title, rank_code, price_cents) values ('NC-ORG-001', $1, 'NC Employment Law Essentials', 'orange', 19900)`, [COURSE]);
  await grantEntitlement(app, { userId: user.id, key: 'course:NC-ORG-001', source: 'comp:test' });
  core = fakeCore();
  transport = createMemoryTransport();
  svc = createLearningService({ db: app, core, mail: createMailer({ db: app, transport, from: 'reli@example.org' }) });
});
after(async () => { await app.end(); await db.stop(); });

test('grading flow: needs_grading -> answer key read server-side -> per-element points posted -> fail below 80 percent, no credential, missed elements named with citations', async () => {
  const { attempt } = await svc.startAssessment(user, ASSESS);
  const thin = 'A signed written authorization that states the reason, signed on or before payday; the general acknowledgment at hire is not enough.';
  const { result, credential, grading } = await svc.submitAssessment(user, attempt.id, [
    { item_id: C1, response: [thin] }, { item_id: S1, response: ['a'] }]);
  assert.equal(core.state.keyReads, 1);
  assert.deepEqual(core.state.graded.at(-1), [{ item_id: C1, points_awarded: 1 }]);
  assert.equal(result.status, 'scored');
  assert.equal(result.passed, false, `${result.score_percent}% is below 80`);
  assert.equal(credential, null);
  assert.deepEqual(grading[0].elements, [true, false, false, false]);
  const view = await svc.attemptView(user, attempt.id);
  const els = view.elements.get(C1);
  assert.equal(els.length, 4);
  assert.equal(els[0].matched, true);
  assert.equal(els.filter(e => !e.matched).length, 3);
  assert.match(els[2].citation, /95-25\.8\(c\)/, 'the seven-day notice element carries its governing citation');
  assert.equal(transport.sent.length, 0, 'no credential mail on a fail');
  const stored = await app.query('select grading, graded_at from attempt_link where core_attempt_id = $1', [attempt.id]);
  assert.ok(stored.rows[0].graded_at);
  assert.equal(JSON.stringify(stored.rows[0].grading).includes('authorization'), false, 'the app stores outcomes, never model element text');
});

test('grading flow: a full answer passes, the Core issues the credential, it is linked, and the credentialIssued mail is sent with the rank name', async () => {
  const { attempt } = await svc.startAssessment(user, ASSESS);
  const full = 'The employer needs a written authorization signed by the cashier that states the reason, signed on or before payday. A general acknowledgment at hire is not enough. The employee must get advance written notice of the actual amount and notice of the right to withdraw the authorization. For a shortage the employer has to give 7 days written notice of the amount before the payday. Because it is an overtime week the deduction can only bring pay down to minimum wage for the 40 regular hours and cannot touch the 6 overtime hours.';
  const { result, credential } = await svc.submitAssessment(user, attempt.id, [{ item_id: C1, response: [full] }, { item_id: S1, response: ['a'] }]);
  assert.equal(result.passed, true);
  assert.equal(result.score_percent, 100);
  assert.equal(credential.public_ref, 'LC-GRADE-REF1');
  const cl = await app.query('select public_ref from credential_link where user_id = $1', [user.id]);
  assert.equal(cl.rows.length, 1);
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].to, 'g@example.org');
  assert.match(transport.sent[0].subject, /Orange Belt earned/);
  assert.match(transport.sent[0].text, /LC-GRADE-REF1/);
  const log = await app.query(`select template, status from email_log where user_id = $1`, [user.id]);
  assert.deepEqual(log.rows, [{ template: 'credential_issued', status: 'sent' }]);
});
