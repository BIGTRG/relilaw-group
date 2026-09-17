// Framework-free HTTP handlers for the content pipeline. Each takes the raw
// Request and a context { session } and returns a Response, so the tests can
// call them exactly as Next does (spec test 1: staff route call -> 403,
// crafted POST -> 403). The Next files under app/api/{studio,console}/pipeline
// only resolve the session cookie and delegate here.
//
// There is deliberately no handler for "publish". There is a handler for
// "sign off", and it accepts only a legal-role, MFA-verified session on the
// Studio door; then it runs pipeline.signOff(), which is the reli_legal path.

import { authorizeDoor, authorizeAction, actorFrom, readBody, refuse, succeed, safePath } from './console-auth.mjs';
import { PipelineError, PUBLISH_REFUSAL } from './pipeline.mjs';

const UUID = /^[0-9a-f-]{36}$/i;

function fail(request, e, backTo) {
  if (e instanceof PipelineError) return refuse(request, e.status, e.message, backTo);
  // Database-level refusals (the SQL gate) read as a 403 with the SQL reason,
  // never as a stack trace.
  if (e?.code === '42501') return refuse(request, 403, 'The database role refused that action', backTo);
  if (e?.code === 'P0001') return refuse(request, 409, e.message.replace(/^GATE: /, ''), backTo);
  throw e;
}

export function createPipelineHandlers({ pipeline, door }) {
  const versionPath = id => (door === 'studio' ? `/versions/${id}` : `/pipeline/${id}`);

  return {
    /** POST { versionId, to, reason } — a single non-publishing step. */
    async transition(request, { session }) {
      const body = await readBody(request);
      const back = UUID.test(body.versionId ?? '') ? versionPath(body.versionId) : '/';
      // Anyone asking for `published` through this handler is refused first,
      // regardless of role: publication is not a transition you request.
      if (body.to === 'published' || body.force || body.force_publish || body.override) {
        return refuse(request, 403, PUBLISH_REFUSAL, back);
      }
      const auth = authorizeAction({ session, door, capability: 'draft_content' });
      if (!auth.ok) return refuse(request, auth.status, auth.detail, back);
      try {
        const v = await pipeline.transition({
          versionId: String(body.versionId ?? ''), to: String(body.to ?? ''), reason: body.reason ?? null,
          actor: actorFrom(session),
        });
        return succeed(request, { state: v.state }, safePath(body.next, back));
      } catch (e) {
        return fail(request, e, back);
      }
    },

    /** POST { itemId, versionId } — legal only. */
    async resolveItem(request, { session }) {
      const body = await readBody(request);
      const back = UUID.test(body.versionId ?? '') ? versionPath(body.versionId) : '/';
      const auth = authorizeAction({ session, door, capability: 'publish_jurisdiction_content' });
      if (!auth.ok) return refuse(request, auth.status, auth.detail, back);
      try {
        await pipeline.resolveReviewItem({ itemId: String(body.itemId ?? ''), actor: actorFrom(session) });
        return succeed(request, {}, back);
      } catch (e) {
        return fail(request, e, back);
      }
    },

    /** POST { versionId, reason } — THE gate. Legal role + MFA, Studio door only. */
    async signOff(request, { session }) {
      const body = await readBody(request);
      const back = UUID.test(body.versionId ?? '') ? versionPath(body.versionId) : '/';
      if (door !== 'studio') return refuse(request, 403, PUBLISH_REFUSAL, back);
      const auth = authorizeAction({ session, door, capability: 'publish_jurisdiction_content' });
      if (!auth.ok) return refuse(request, auth.status === 401 ? 401 : 403, auth.status === 401 ? auth.detail : PUBLISH_REFUSAL, back);
      if (session.mfaVerified !== true) return refuse(request, 403, 'A verified second factor is required to sign off', back);
      try {
        const r = await pipeline.signOff({
          versionId: String(body.versionId ?? ''), reason: body.reason ?? '', actor: actorFrom(session),
        });
        return succeed(request, { signoffId: r.signoffId, signedAt: r.signedAt, state: r.version.state }, back);
      } catch (e) {
        return fail(request, e, back);
      }
    },

    /** POST { courseRef, versionRef, title } — new draft (authors, instructors, legal, staff). */
    async createDraft(request, { session }) {
      const body = await readBody(request);
      const auth = authorizeAction({ session, door, capability: 'draft_content' });
      if (!auth.ok) return refuse(request, auth.status, auth.detail, '/');
      const courseRef = String(body.courseRef ?? '').trim().toUpperCase();
      const versionRef = String(body.versionRef ?? '').trim();
      if (!/^[A-Z0-9-]{3,40}$/.test(courseRef) || !/^[\w.-]{1,40}$/.test(versionRef)) {
        return refuse(request, 400, 'Course reference and version label are required', '/');
      }
      try {
        const v = await pipeline.createDraft({ courseRef, versionRef, title: String(body.title ?? '').slice(0, 200), actor: actorFrom(session) });
        return succeed(request, { id: v.id }, versionPath(v.id));
      } catch (e) {
        if (e?.code === '23505') return refuse(request, 409, 'That version already exists', '/');
        return fail(request, e, '/');
      }
    },

    /** GET — board data for the session's door (JSON). */
    async board(request, { session }) {
      const auth = authorizeDoor({ session, door });
      if (!auth.ok) return refuse(request, auth.status, auth.detail, '/login');
      return Response.json({ versions: await pipeline.listVersions() });
    },
  };
}
