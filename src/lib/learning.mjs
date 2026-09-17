// Learning service (M2). The seam between an app user and the Learning Core.
// SERVER ONLY. Rules:
// - The Core computes progress, scores and credentials. This module never
//   asserts a completion or a pass; it asks.
// - Visibility of a course goes through hasEntitlement() (the keystone).
//   Nothing here reads a payment record.
// - The app stores IDs only (learner_link, enrollment_link, ...). No content.
// - Core failures surface as { degraded: true } so pages render a legible
//   state instead of a stack trace.

import { CoreUnavailableError, CoreRequestError } from './core-client.mjs';
import { hasEntitlement } from './entitlements.mjs';
import { gradeConstructed } from './grading.mjs';
import { credentialIssued } from './mail/templates.mjs';

export const entitlementKeyFor = code => `course:${code}`;

/**
 * @param {{ db, core, mail?: { send(job): Promise<unknown> } | null, signature?: (db, courseRef) => Promise<object|null> }} deps
 *  mail is optional (tests, SMTP not configured): a credential is issued and
 *  linked whether or not the mail leaves the box. signature is the pipeline's
 *  publishedSignature(db, courseRef); optional so this module does not import
 *  the pipeline.
 */
export function createLearningService({ db, core, mail = null, signature = null }) {
  // ---- identity -----------------------------------------------------------

  /** Ensure the user exists in the Core; return the Core learner id. */
  async function ensureLearner(user, conn = db) {
    const { rows } = await conn.query('select core_learner_id from learner_link where user_id = $1', [user.id]);
    if (rows[0]) return rows[0].core_learner_id;
    const learner = await core.upsertLearner({ externalRef: user.external_ref, displayName: user.display_name });
    await conn.query(
      `insert into learner_link (user_id, core_learner_id) values ($1, $2)
       on conflict (user_id) do nothing`, [user.id, learner.id]);
    return learner.id;
  }

  /** Change the learner's email and/or display name. The external_ref is
   *  permanent (DB trigger) and is the only thing the Core knows the learner
   *  by, so the Core learner id, enrolments, attempts and credentials are
   *  untouched. A display-name change is pushed to the Core by the same
   *  idempotent upsert that created the learner (spec section 1.2, test 12). */
  async function updateProfile(user, { email = user.email, displayName = user.display_name } = {}) {
    const next = { email: String(email ?? '').trim().toLowerCase(), displayName: String(displayName ?? '').trim() };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw new ProfileError('That email address does not look valid.');
    if (!next.displayName) throw new ProfileError('A display name is required.');
    const { rows } = await db.query(
      `update app_user set email = $2, display_name = $3, updated_at = now()
        where id = $1 returning id, external_ref, email, display_name, status`, [user.id, next.email, next.displayName])
      .catch(e => { if (e.code === '23505') throw new ProfileError('That email address is already in use.'); throw e; });
    const updated = rows[0];
    const { rows: link } = await db.query('select core_learner_id from learner_link where user_id = $1', [user.id]);
    if (link[0] && next.displayName !== user.display_name) {
      const learner = await core.upsertLearner({ externalRef: updated.external_ref, displayName: updated.display_name });
      if (learner.id !== link[0].core_learner_id) throw new Error('Core learner identity changed on upsert; external_ref contract broken');
    }
    return updated;
  }

  // ---- catalogue ----------------------------------------------------------

  /** Active products joined with the user's entitlement and enrollment state. */
  async function catalogue(user) {
    const { rows: products } = await db.query(
      `select code, core_course_id, title, rank_code, price_cents, currency from product
        where active order by created_at`);
    const { rows: links } = await db.query(
      'select core_course_id, core_enrollment_id from enrollment_link where user_id = $1', [user.id]);
    const linkBy = new Map(links.map(l => [l.core_course_id, l.core_enrollment_id]));
    const out = [];
    for (const p of products) {
      out.push({
        ...p,
        entitled: await hasEntitlement(db, user.id, entitlementKeyFor(p.code)),
        enrollmentId: linkBy.get(p.core_course_id) ?? null,
      });
    }
    return out;
  }

  async function productForCourse(courseId, conn = db) {
    const { rows } = await conn.query('select * from product where core_course_id = $1 and active', [courseId]);
    return rows[0] ?? null;
  }

  // ---- ranks --------------------------------------------------------------

  /** Ranks as data from the Core: [{ order, name, color, id }] in ladder order. */
  async function ranks() {
    const { items } = await core.listSchemes();
    const scheme = items[0];
    if (!scheme) return { schemeId: null, ranks: [] };
    return {
      schemeId: scheme.id,
      ranks: scheme.ranks.map(r => ({ id: r.id, order: r.position, name: r.name, color: r.meta?.fill ?? null })),
    };
  }

  // ---- enrollment & progress ---------------------------------------------

  /** Enrol if entitled. Idempotent. Returns the enrollment link or throws NotEntitled.
   *  `conn` lets a caller inside a transaction (the payments webhook) enrol
   *  against the grant it has just written but not yet committed. */
  async function ensureEnrollment(user, courseId, conn = db) {
    const product = await productForCourse(courseId, conn);
    if (!product) throw new NotEntitledError('unknown course');
    if (!(await hasEntitlement(conn, user.id, entitlementKeyFor(product.code)))) throw new NotEntitledError(product.code);
    const { rows } = await conn.query(
      'select core_enrollment_id from enrollment_link where user_id = $1 and core_course_id = $2', [user.id, courseId]);
    if (rows[0]) return rows[0].core_enrollment_id;
    const learnerId = await ensureLearner(user, conn);
    const enrollment = await core.enroll({ learnerId, courseId });
    await conn.query(
      `insert into enrollment_link (user_id, core_course_id, core_enrollment_id) values ($1, $2, $3)
       on conflict (user_id, core_course_id) do nothing`, [user.id, courseId, enrollment.id]);
    return enrollment.id;
  }

  async function enrollmentFor(user, courseId) {
    const { rows } = await db.query(
      'select core_enrollment_id from enrollment_link where user_id = $1 and core_course_id = $2', [user.id, courseId]);
    return rows[0]?.core_enrollment_id ?? null;
  }

  /** Course syllabus + this user's progress. Requires entitlement. */
  async function courseView(user, courseId) {
    const enrollmentId = await ensureEnrollment(user, courseId);
    const product = await productForCourse(courseId);
    const [course, progress, signed] = await Promise.all([
      core.getCourse(courseId), core.getEnrollment(enrollmentId),
      signature ? signature(db, product.code).catch(() => null) : null,
    ]);
    const done = new Set(progress.completed_lesson_ids ?? []);
    const lessons = course.lessons.filter(l => l.status === 'published').map(l => ({ ...l, done: done.has(l.id) }));
    const modules = course.modules.map(m => ({ ...m, lessons: lessons.filter(l => l.module_id === m.id) }));
    const next = lessons.find(l => !l.done) ?? null;
    return {
      course: { id: course.id, title: course.title, summary: course.summary, rank_id: course.rank_id },
      modules, lessons, progress, next,
      assessment: (course.assessments ?? []).find(a => a.status === 'published') ?? null,
      enrollmentId,
      product: { code: product.code, title: product.title, rank_code: product.rank_code },
      // The legal-review signature block (spec section 6, module 05). null means
      // the app's pipeline has no published, signed version of this course:
      // the page must say "Draft, pending legal review", never imply a signature.
      signature: signed ?? null,
    };
  }

  /** A lesson in reading order with prev/next, gated by the course's entitlement. */
  async function lessonView(user, lessonId) {
    const lesson = await core.getLesson(lessonId);
    if (lesson.status !== 'published') throw new NotEntitledError('unpublished');
    const view = await courseView(user, lesson.course_id);
    const idx = view.lessons.findIndex(l => l.id === lesson.id);
    return {
      lesson, course: view.course, enrollmentId: view.enrollmentId,
      done: view.lessons[idx]?.done ?? false,
      prev: idx > 0 ? view.lessons[idx - 1] : null,
      next: idx >= 0 && idx < view.lessons.length - 1 ? view.lessons[idx + 1] : null,
      position: idx + 1, total: view.lessons.length,
      assessment: view.assessment,
      allDone: view.lessons.every(l => l.done),
    };
  }

  async function completeLesson(user, lessonId) {
    const lesson = await core.getLesson(lessonId);
    const enrollmentId = await ensureEnrollment(user, lesson.course_id);
    return core.completeLesson({ enrollmentId, lessonId });
  }

  // ---- assessment ---------------------------------------------------------

  async function startAssessment(user, assessmentId) {
    const assessment = await core.getAssessment(assessmentId);
    const enrollmentId = await ensureEnrollment(user, assessment.course_id);
    const attempt = await core.startAttempt({ enrollmentId, assessmentId });
    await db.query(
      `insert into attempt_link (core_attempt_id, user_id, core_enrollment_id, core_assessment_id)
       values ($1, $2, $3, $4) on conflict do nothing`, [attempt.id, user.id, enrollmentId, assessmentId]);
    return { attempt, assessment };
  }

  async function ownsAttempt(user, attemptId) {
    const { rows } = await db.query(
      'select core_assessment_id, core_enrollment_id, grading from attempt_link where core_attempt_id = $1 and user_id = $2',
      [attemptId, user.id]);
    return rows[0] ?? null;
  }

  /** answers: [{ item_id, response }]
   *  Flow: record answers -> Core scores single/multi -> if the Core parks the
   *  attempt at needs_grading, grade the constructed items by element here
   *  (deterministic, src/lib/grading.mjs) against the admin-scoped answer key
   *  and post the points back -> the Core finalises score and pass/fail ->
   *  on a pass the Core issues the credential and we link it and mail it. */
  async function submitAssessment(user, attemptId, answers) {
    const link = await ownsAttempt(user, attemptId);
    if (!link) throw new NotEntitledError('attempt');
    if (answers.length) await core.answerAttempt({ attemptId, answers });
    let result = await core.submitAttempt(attemptId);
    let grading = null;
    if (result.status === 'needs_grading') {
      const [assessment, key] = await Promise.all([
        core.getAssessment(link.core_assessment_id), core.getAnswerKey(link.core_assessment_id)]);
      const graded = gradeConstructed({ items: assessment.items, answerKey: key.items, answers });
      grading = graded.detail;
      await db.query('update attempt_link set grading = $2, graded_at = now() where core_attempt_id = $1',
        [attemptId, JSON.stringify(grading)]);
      result = await core.gradeAttempt({ attemptId, grades: graded.grades });
    }
    let credential = null;
    if (result.passed) {
      const cred = await core.issueCredential(attemptId);
      const assessment = await core.getAssessment(link.core_assessment_id);
      const { rowCount } = await db.query(
        `insert into credential_link (core_credential_id, user_id, core_course_id, public_ref)
         values ($1, $2, $3, $4) on conflict (core_credential_id) do nothing`,
        [cred.id, user.id, assessment.course_id, cred.public_ref]);
      credential = cred;
      if (rowCount && mail && user.email) {
        const product = await productForCourse(assessment.course_id);
        let rankName = null;
        try {
          const course = await core.getCourse(assessment.course_id);
          rankName = (await ranks()).ranks.find(r => r.id === course.rank_id)?.name ?? null;
        } catch { /* the mail still goes without the rank name */ }
        try {
          await mail.send({ userId: user.id, to: user.email,
            ...credentialIssued({ user, product: product ?? { title: assessment.title, code: '' }, publicRef: cred.public_ref, rankName }) });
        } catch { /* logged as failed by the mailer; never un-issues */ }
      }
    }
    return { result, credential, grading };
  }

  /** The attempt, its assessment and, for constructed items, the model
   *  elements with matched/missed per element so the result teaches. The
   *  answer key is read server-side (admin scope) ONLY for a submitted attempt
   *  the caller owns, and only the graded outcome is rendered. */
  async function attemptView(user, attemptId) {
    const link = await ownsAttempt(user, attemptId);
    if (!link) throw new NotEntitledError('attempt');
    const [attempt, assessment] = await Promise.all([core.getAttempt(attemptId), core.getAssessment(link.core_assessment_id)]);
    const { rows } = await db.query(
      `select public_ref from credential_link where user_id = $1 and core_course_id = $2 order by issued_at desc limit 1`,
      [user.id, assessment.course_id]);
    let elements = null; // Map(item_id -> [{ element, citation, matched }])
    const grading = link.grading;
    if (grading && attempt.status !== 'in_progress') {
      const key = await core.getAnswerKey(link.core_assessment_id);
      const keyBy = new Map(key.items.map(k => [k.id, k]));
      elements = new Map();
      for (const g of grading) {
        const k = keyBy.get(g.item_id);
        if (!k || !Array.isArray(k.answer_key)) continue;
        elements.set(g.item_id, k.answer_key.map((el, i) => ({ element: el.element, citation: el.citation ?? null, matched: g.elements[i] === true })));
      }
    }
    return { attempt, assessment, credentialRef: rows[0]?.public_ref ?? null, elements };
  }

  // ---- home ---------------------------------------------------------------

  /** Everything the Dojo home needs in one call. Degrades instead of throwing. */
  async function home(user) {
    try {
      const [{ ranks: ladder }, cat] = await Promise.all([ranks(), catalogue(user)]);
      const { rows: creds } = await db.query(
        'select core_course_id, public_ref, issued_at from credential_link where user_id = $1 order by issued_at desc', [user.id]);
      // current rank = highest rank of any course the learner holds a credential for
      let currentOrder = 1;
      const courseRank = new Map();
      for (const p of cat) {
        if (creds.some(c => c.core_course_id === p.core_course_id)) {
          const course = await core.getCourse(p.core_course_id);
          const r = ladder.find(x => x.id === course.rank_id);
          if (r) { courseRank.set(p.core_course_id, r); currentOrder = Math.max(currentOrder, r.order); }
        }
      }
      // resume target: first entitled product with an unfinished lesson
      let resume = null;
      for (const p of cat) {
        if (!p.entitled) continue;
        const v = await courseView(user, p.core_course_id);
        if (v.next) { resume = { courseId: p.core_course_id, courseTitle: v.course.title, lesson: v.next, progress: v.progress }; break; }
        if (v.assessment && !creds.some(c => c.core_course_id === p.core_course_id)) {
          resume = { courseId: p.core_course_id, courseTitle: v.course.title, assessment: v.assessment, progress: v.progress }; break;
        }
      }
      return { degraded: false, ranks: ladder, currentOrder, catalogue: cat, credentials: creds, resume };
    } catch (e) {
      if (e instanceof CoreUnavailableError) return { degraded: true, ranks: [], currentOrder: 1, catalogue: [], credentials: [], resume: null };
      throw e;
    }
  }

  return {
    ensureLearner, updateProfile, catalogue, ranks, ensureEnrollment, enrollmentFor, courseView, lessonView,
    completeLesson, startAssessment, submitAssessment, attemptView, home,
  };
}

export class ProfileError extends Error {
  constructor(msg) { super(msg); this.name = 'ProfileError'; }
}

export class NotEntitledError extends Error {
  constructor(what) { super(`not entitled: ${what}`); this.name = 'NotEntitledError'; this.what = what; }
}

export { CoreUnavailableError, CoreRequestError };
