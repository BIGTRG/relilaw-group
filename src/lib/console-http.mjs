// Next-side wiring for the Studio and Console: session resolution, pools per
// role, service singletons. Everything decision-making lives in the
// framework-free modules (console-auth, pipeline, console, registry).
import 'server-only';
import pg from 'pg';
import { redirect } from 'next/navigation';
import { currentSession, getAuthServices, requestDoor } from './auth/http.mjs';
import { getRedis } from './infra/redis.mjs';
import { getCore } from './dojo.mjs';
import { createPipeline } from './pipeline.mjs';
import { createPipelineHandlers } from './pipeline-routes.mjs';
import { createConsoleHandlers } from './console-routes.mjs';
import { authorizeDoor, connFor, actorFrom } from './console-auth.mjs';

let auditorPool;
/** The reli_auditor pool: read-only at the database-role level. */
export function getAuditorPool() {
  if (!auditorPool) {
    const url = process.env.DATABASE_URL_AUDITOR;
    if (!url) throw new Error('DATABASE_URL_AUDITOR is not set');
    auditorPool = new pg.Pool({ connectionString: url, max: 4 });
  }
  return auditorPool;
}

export function getPools() {
  return {
    app: getAuthServices().db,
    get auditor() { return getAuditorPool(); },
  };
}

/** The Core client plus the approval mirror used by the sign-off path. */
let coreWithApprovals;
export function getPipelineCore() {
  if (!coreWithApprovals) {
    const core = getCore();
    coreWithApprovals = Object.assign(Object.create(core), {
      recordApproval: ({ subjectKind, subjectId, approverRole, approverRef, note, idempotencyKey }) =>
        core._internals.request('POST', '/v1/approvals', {
          body: { subject_kind: subjectKind, subject_id: subjectId, approver_role: approverRole, approver_ref: approverRef, note },
          idempotencyKey,
        }),
    });
  }
  return coreWithApprovals;
}

let pipeline;
export function getPipeline() {
  if (!pipeline) pipeline = createPipeline({ db: getAuthServices().db, core: getPipelineCore() });
  return pipeline;
}

const handlers = {};
export function getPipelineHandlers(door) {
  if (!handlers[door]) handlers[door] = createPipelineHandlers({ pipeline: getPipeline(), door });
  return handlers[door];
}

let consoleHandlers;
export function getConsoleHandlers() {
  if (!consoleHandlers) consoleHandlers = createConsoleHandlers({ pools: getPools(), core: getCore() });
  return consoleHandlers;
}

/**
 * For pages: the verified session for this door plus the user row and the
 * pool the session may use. Redirects to the door's /login otherwise.
 */
export async function requireDoor(door, nextPath = '/') {
  const s = await currentSession();
  const auth = authorizeDoor({ session: s?.session, door });
  if (!auth.ok) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const { db } = getAuthServices();
  const { rows } = await db.query(
    'select id, external_ref, email, display_name, status from app_user where id = $1', [s.session.userId]);
  const user = rows[0];
  if (!user || user.status !== 'active') redirect('/login');
  return { user, session: s.session, conn: connFor(s.session, getPools()), actor: actorFrom(s.session), readOnly: auth.readOnly };
}

/** For route handlers: resolve the session and hand off to a pure handler. */
export async function withDoor(request, door, handler) {
  const hostDoor = await requestDoor();
  const s = await currentSession();
  // A route mounted under /api/studio must be reached through the Studio host.
  const session = hostDoor === door ? s?.session ?? null : null;
  return handler(request, { session });
}

export { getRedis };
