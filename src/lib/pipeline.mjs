// The content pipeline (Console module 05, the Studio). SERVER ONLY.
//
//   draft -> sme_review -> legal_review -> published
//
// Two layers enforce the gate and this file is the upper one:
//   - permissions.mjs decides who may ask for a transition (the spec matrix:
//     publish_jurisdiction_content is held by `legal` alone);
//   - migration 003 + roles.sql make `published` unreachable without a
//     publish_signoff row, which only the reli_legal database role can write.
// signOff() is the one code path that opens a reli_legal connection. It
// demands a verified legal-role session with MFA before it does, and the
// pool every other function uses is reli_app, which cannot write a sign-off.
// There is no force flag, no env override and no admin route.

import pg from 'pg';
import { can } from './permissions.mjs';

export const STATES = Object.freeze(['draft', 'sme_review', 'legal_review', 'published']);

export const STATE_LABEL = Object.freeze({
  draft: 'Draft',
  sme_review: 'SME review',
  legal_review: 'Legal review',
  published: 'Published',
});

// Which capability a caller needs for each step. Publishing is not listed:
// it is not a transition anyone requests, it is the result of signOff().
const STEP_CAPABILITY = Object.freeze({
  'draft>sme_review': 'draft_content',
  'sme_review>legal_review': 'draft_content',
  'sme_review>draft': 'draft_content',
  'legal_review>draft': 'publish_jurisdiction_content', // sending back from legal review is legal's call
});

export class PipelineError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
    this.status = status;
  }
}

export const PUBLISH_REFUSAL = 'Only a legal reviewer can publish jurisdiction content';

const UUID = /^[0-9a-f-]{36}$/i;

/** The role a session acts under for a given capability (first matching role). */
export function actingRole(roles, capability) {
  const order = ['legal', 'staff', 'author', 'instructor', 'org_admin', 'employee', 'learner', 'auditor'];
  return order.find(r => roles.includes(r) && can([r], capability)) ?? null;
}

export function createPipeline({ db, legalUrl = process.env.DATABASE_URL_LEGAL, core = null }) {
  // ---- reads ---------------------------------------------------------------

  async function listVersions(conn = db) {
    const { rows } = await conn.query(
      `select v.*, u.display_name as created_by_name,
              (select count(*)::int from review_item r where r.core_course_ref = v.core_course_ref and r.status = 'open') as open_items,
              s.signed_at, su.display_name as reviewer_name
         from content_version v
         left join app_user u on u.id = v.created_by
         left join publish_signoff s on s.core_course_ref = v.core_course_ref and s.core_version_ref = v.core_version_ref
         left join app_user su on su.id = s.reviewer_user_id
        order by v.updated_at desc`);
    return rows;
  }

  async function getVersion(id, conn = db) {
    if (!UUID.test(id)) return null;
    const { rows } = await conn.query(
      `select v.*, u.display_name as created_by_name,
              s.id as signoff_id, s.signed_at, s.note as signoff_note, su.display_name as reviewer_name
         from content_version v
         left join app_user u on u.id = v.created_by
         left join publish_signoff s on s.core_course_ref = v.core_course_ref and s.core_version_ref = v.core_version_ref
         left join app_user su on su.id = s.reviewer_user_id
        where v.id = $1`, [id]);
    return rows[0] ?? null;
  }

  async function reviewItems(courseRef, conn = db) {
    const { rows } = await conn.query(
      `select r.*, ru.display_name as resolved_by_name
         from review_item r left join app_user ru on ru.id = r.resolved_by
        where r.core_course_ref = $1
        order by r.status desc, r.opened_at, r.title`, [courseRef]);
    return rows;
  }

  async function transitions(versionId, conn = db) {
    const { rows } = await conn.query(
      `select t.*, u.display_name as actor_name
         from pipeline_transition t left join app_user u on u.id = t.actor_user_id
        where t.version_id = $1 order by t.at, t.id`, [versionId]);
    return rows;
  }

  /** Is this version publishable right now, and if not, why not. */
  async function gateStatus(versionId, conn = db) {
    const { rows } = await conn.query(
      `select v.state,
              (select count(*)::int from review_item r where r.core_course_ref = v.core_course_ref and r.status = 'open') as open_items,
              exists (select 1 from publish_signoff s where s.core_course_ref = v.core_course_ref and s.core_version_ref = v.core_version_ref) as signed,
              pipeline_publishable(v.id) as publishable
         from content_version v where v.id = $1`, [versionId]);
    const r = rows[0];
    if (!r) return null;
    const blockers = [];
    if (r.state !== 'legal_review' && r.state !== 'published') blockers.push(`Version is in ${STATE_LABEL[r.state]}, not legal review`);
    if (r.open_items > 0) blockers.push(`${r.open_items} attorney-review item${r.open_items === 1 ? '' : 's'} open`);
    if (!r.signed) blockers.push('No legal sign-off recorded');
    return { ...r, blockers };
  }

  // ---- writes (reli_app) ---------------------------------------------------

  async function createDraft({ courseRef, versionRef, title, actor }) {
    if (!can(actor.roles, 'draft_content')) throw new PipelineError('forbidden', 'You cannot draft content', 403);
    const role = actingRole(actor.roles, 'draft_content');
    const { rows } = await db.query(
      `insert into content_version (core_course_ref, core_version_ref, title, created_by)
       values ($1, $2, $3, $4) returning *`, [courseRef, versionRef, title ?? '', actor.userId]);
    await db.query(
      `insert into audit_event (actor_user_id, actor_role, action, object_type, object_ref, to_state)
       values ($1, $2, 'pipeline.draft_created', 'content_version', $3, 'draft')`,
      [actor.userId, role, rows[0].id]);
    return rows[0];
  }

  /**
   * Move a version one step. `to` may never be 'published' here: that word
   * belongs to signOff() and the reli_legal role. Asking is refused with 403
   * before any SQL runs; if the SQL ran anyway the trigger would refuse it.
   */
  async function transition({ versionId, to, reason, actor }) {
    if (to === 'published') throw new PipelineError('publish_forbidden', PUBLISH_REFUSAL, 403);
    if (!STATES.includes(to)) throw new PipelineError('bad_state', 'Unknown state', 400);
    const v = await getVersion(versionId);
    if (!v) throw new PipelineError('not_found', 'Version not found', 404);
    const step = `${v.state}>${to}`;
    const capability = STEP_CAPABILITY[step];
    if (!capability) throw new PipelineError('illegal', `Cannot move from ${STATE_LABEL[v.state]} to ${STATE_LABEL[to]}`, 409);
    if (!can(actor.roles, capability)) throw new PipelineError('forbidden', 'Your role cannot make that transition', 403);
    const role = actingRole(actor.roles, capability);
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into pipeline_transition (version_id, from_state, to_state, actor_user_id, actor_role, reason)
         values ($1, $2, $3, $4, $5, $6)`, [v.id, v.state, to, actor.userId, role, reason ?? null]);
      await client.query('update content_version set state = $2 where id = $1', [v.id, to]);
      await client.query(
        `insert into audit_event (actor_user_id, actor_role, action, object_type, object_ref, from_state, to_state, reason)
         values ($1, $2, 'pipeline.transition', 'content_version', $3, $4, $5, $6)`,
        [actor.userId, role, v.id, v.state, to, reason ?? null]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    return getVersion(v.id);
  }

  /** Legal only: close one attorney-review item. */
  async function resolveReviewItem({ itemId, actor }) {
    if (!can(actor.roles, 'publish_jurisdiction_content')) {
      throw new PipelineError('forbidden', 'Only a legal reviewer can resolve an attorney-review item', 403);
    }
    if (!UUID.test(itemId)) throw new PipelineError('not_found', 'Review item not found', 404);
    const { rows } = await db.query(
      `update review_item set status = 'resolved', resolved_by = $2, resolved_at = now()
        where id = $1 and status = 'open' returning *`, [itemId, actor.userId]);
    if (!rows[0]) throw new PipelineError('not_found', 'Review item not found or already resolved', 404);
    await db.query(
      `insert into audit_event (actor_user_id, actor_role, action, object_type, object_ref, from_state, to_state)
       values ($1, 'legal', 'review_item.resolved', 'review_item', $2, 'open', 'resolved')`, [actor.userId, itemId]);
    return rows[0];
  }

  // ---- the gate (reli_legal) ------------------------------------------------

  /**
   * The single action that publishes jurisdiction content. Requires a
   * session whose roles include `legal` and whose MFA was verified on this
   * door; then, on a SEPARATE connection as the reli_legal database role,
   * records the publish_signoff, the transition and the state change in one
   * transaction. Anything short of that is refused before a connection opens.
   */
  async function signOff({ versionId, reason, actor }) {
    if (!can(actor.roles, 'publish_jurisdiction_content')) throw new PipelineError('publish_forbidden', PUBLISH_REFUSAL, 403);
    if (actor.mfaVerified !== true) throw new PipelineError('mfa_required', 'A verified second factor is required to sign off', 403);
    if (!reason || !String(reason).trim()) throw new PipelineError('reason_required', 'A sign-off needs a reason', 400);
    if (!legalUrl) throw new PipelineError('gate_unavailable', 'The legal sign-off connection is not configured', 503);

    const v = await getVersion(versionId);
    if (!v) throw new PipelineError('not_found', 'Version not found', 404);
    if (v.state !== 'legal_review') throw new PipelineError('not_in_review', `This version is in ${STATE_LABEL[v.state]}, not legal review`, 409);
    const gate = await gateStatus(v.id);
    if (gate.open_items > 0) {
      throw new PipelineError('items_open', `${gate.open_items} attorney-review item${gate.open_items === 1 ? '' : 's'} still open`, 409);
    }

    const legal = new pg.Client({ connectionString: legalUrl });
    await legal.connect();
    try {
      await legal.query('begin');
      const so = await legal.query(
        `insert into publish_signoff (core_course_ref, core_version_ref, reviewer_user_id, reviewer_role, note)
         values ($1, $2, $3, 'legal', $4) returning id, signed_at`,
        [v.core_course_ref, v.core_version_ref, actor.userId, String(reason).trim()]);
      await legal.query(
        `insert into pipeline_transition (version_id, from_state, to_state, actor_user_id, actor_role, reason)
         values ($1, 'legal_review', 'published', $2, 'legal', $3)`, [v.id, actor.userId, String(reason).trim()]);
      await legal.query(`update content_version set state = 'published' where id = $1`, [v.id]);
      await legal.query(
        `insert into audit_event (actor_user_id, actor_role, action, object_type, object_ref, from_state, to_state, reason, meta)
         values ($1, 'legal', 'pipeline.published', 'content_version', $2, 'legal_review', 'published', $3, $4)`,
        [actor.userId, v.id, String(reason).trim(), JSON.stringify({ signoff_id: so.rows[0].id })]);

      // Mirror the approval into the Core (it owns approval rows with
      // approver_role='legal'). If the Core is down we do not publish: the
      // legal record must exist in both places or neither.
      if (core) {
        const { rows: pr } = await legal.query('select core_course_id from product where code = $1', [v.core_course_ref]);
        const { rows: ur } = await legal.query('select external_ref from app_user where id = $1', [actor.userId]);
        if (pr[0]) {
          await core.recordApproval({
            subjectKind: 'course', subjectId: pr[0].core_course_id,
            approverRole: 'legal', approverRef: ur[0]?.external_ref ?? actor.userId,
            note: `${v.core_course_ref} ${v.core_version_ref}: ${String(reason).trim()}`,
            idempotencyKey: `signoff-${so.rows[0].id}`,
          });
        }
      }
      await legal.query('commit');
      return { signoffId: so.rows[0].id, signedAt: so.rows[0].signed_at, version: await getVersion(v.id) };
    } catch (e) {
      await legal.query('rollback').catch(() => {});
      throw e;
    } finally {
      await legal.end();
    }
  }

  return {
    listVersions, getVersion, reviewItems, transitions, gateStatus,
    createDraft, transition, resolveReviewItem, signOff,
  };
}

/**
 * Who signed a course and when. For the Dojo course page and any other
 * surface that must show "reviewed by <attorney> on <date>". Returns the
 * newest published version's sign-off or null.
 */
export async function publishedSignature(db, courseRef) {
  const { rows } = await db.query(
    `select v.core_version_ref, v.published_at, s.signed_at, s.note, u.display_name as reviewer_name
       from content_version v
       join publish_signoff s on s.core_course_ref = v.core_course_ref and s.core_version_ref = v.core_version_ref
       join app_user u on u.id = s.reviewer_user_id
      where v.core_course_ref = $1 and v.state = 'published'
      order by v.published_at desc limit 1`, [courseRef]);
  const r = rows[0];
  if (!r) return null;
  return {
    versionRef: r.core_version_ref,
    reviewerName: r.reviewer_name,
    signedAt: r.signed_at,
    publishedAt: r.published_at,
    note: r.note,
  };
}

/** Placeholder attorney-review items until content/nc-org-001/review-items.json lands. */
export function placeholderReviewItems(courseRef = 'NC-ORG-001', n = 8) {
  return Array.from({ length: n }, (_, i) => ({
    core_course_ref: courseRef,
    title: `Attorney review item ${i + 1}`,
    detail: 'Placeholder queued for attorney review. Replaced by content/nc-org-001/review-items.json.',
  }));
}

/** Upsert review items by (course, title). Never re-opens a resolved item. */
export async function upsertReviewItems(db, items) {
  let inserted = 0, updated = 0;
  for (const it of items) {
    const { rows } = await db.query(
      `select id, status from review_item where core_course_ref = $1 and title = $2`, [it.core_course_ref, it.title]);
    if (rows[0]) {
      await db.query('update review_item set detail = $2 where id = $1', [rows[0].id, it.detail ?? null]);
      updated++;
    } else {
      await db.query(
        'insert into review_item (core_course_ref, title, detail) values ($1, $2, $3)',
        [it.core_course_ref, it.title, it.detail ?? null]);
      inserted++;
    }
  }
  return { inserted, updated };
}
