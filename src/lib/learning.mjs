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

export const entitlementKeyFor = code => `course:${code}`;

export function createLearningService({ db, core }) {
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
    const [course, progress] = await Promise.all([core.getCourse(courseId), core.getEnrollment(enrollmentId)]);
    const done = new Set(progress.completed_lesson_ids ?? []);
    const lessons = course.lessons.filter(l => l.status === 'published').map(l => ({ ...l, done: done.has(l.id) }));
    const modules = course.modules.map(m => ({ ...m, lessons: lessons.filter(l => l.module_id === m.id) }));
    const next = lessons.find(l => !l.done) ?? null;
    return {
      course: { id: course.id, title: course.title, summary: course.summary, rank_id: course.rank_id },
      modules, lessons, progress, next,
      assessment: (course.assessments ?? []).find(a => a.status === 'published') ?? null,
      enrollmentId,
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
      'select core_assessment_id, core_enrollment_id from attempt_link where core_attempt_id = $1 and user_id = $2',
      [attemptId, user.id]);
    return rows[0] ?? null;
  }

  /** answers: [{ item_id, response }] */
  async function submitAssessment(user, attemptId, answers) {
    const link = await ownsAttempt(user, attemptId);
    if (!link) throw new NotEntitledError('attempt');
    if (answers.length) await core.answerAttempt({ attemptId, answers });
    const result = await core.submitAttempt(attemptId);
    let credential = null;
    if (result.passed) {
      const cred = await core.issueCredential(attemptId);
      const assessment = await core.getAssessment(link.core_assessment_id);
      await db.query(
        `insert into credential_link (core_credential_id, user_id, core_course_id, public_ref)
         values ($1, $2, $3, $4) on conflict (core_credential_id) do nothing`,
        [cred.id, user.id, assessment.course_id, cred.public_ref]);
      credential = cred;
    }
    return { result, credential };
  }

  async function attemptView(user, attemptId) {
    const link = await ownsAttempt(user, attemptId);
    if (!link) throw new NotEntitledError('attempt');
    const [attempt, assessment] = await Promise.all([core.getAttempt(attemptId), core.getAssessment(link.core_assessment_id)]);
    const { rows } = await db.query(
      `select public_ref from credential_link where user_id = $1 and core_course_id = $2 order by issued_at desc limit 1`,
      [user.id, assessment.course_id]);
    return { attempt, assessment, credentialRef: rows[0]?.public_ref ?? null };
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
    ensureLearner, catalogue, ranks, ensureEnrollment, enrollmentFor, courseView, lessonView,
    completeLesson, startAssessment, submitAssessment, attemptView, home,
  };
}

export class NotEntitledError extends Error {
  constructor(what) { super(`not entitled: ${what}`); this.name = 'NotEntitledError'; this.what = what; }
}

export { CoreUnavailableError, CoreRequestError };
