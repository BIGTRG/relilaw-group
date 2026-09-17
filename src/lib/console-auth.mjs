// Door authorisation for the Studio and the Console, framework-free so the
// tests can drive it with plain objects. The Next wrappers live in
// console-http.mjs.
//
// Rules (§2): the session must have been opened for THIS door, the roles
// must be allowed through it, and MFA must have been verified on it.
// Auditor-only sessions are handed the reli_auditor database pool, so their
// read-only status is enforced by Postgres, not by this file.

import { canEnterDoor, MFA_REQUIRED_DOORS, isReadOnlySession, can } from './permissions.mjs';

export function authorizeDoor({ session, door }) {
  if (!session) return { ok: false, status: 401, detail: 'Sign in to continue' };
  if (session.door !== door) return { ok: false, status: 403, detail: 'This session was opened for a different door' };
  if (!Array.isArray(session.roles) || !canEnterDoor(session.roles, door)) {
    return { ok: false, status: 403, detail: 'Your account cannot access this area' };
  }
  if (MFA_REQUIRED_DOORS.has(door) && session.mfaVerified !== true) {
    return { ok: false, status: 403, detail: 'A verified second factor is required on this door' };
  }
  return { ok: true, readOnly: isReadOnlySession(session.roles) };
}

/** Same as authorizeDoor plus one capability. Auditor-only sessions never pass a write capability. */
export function authorizeAction({ session, door, capability, write = true }) {
  const base = authorizeDoor({ session, door });
  if (!base.ok) return base;
  if (write && base.readOnly) return { ok: false, status: 403, detail: 'Auditor sessions are read-only' };
  if (capability && !can(session.roles, capability)) {
    return { ok: false, status: 403, detail: 'Your role does not hold that capability' };
  }
  return base;
}

/** Pick the database pool a session may use. */
export function connFor(session, pools) {
  return isReadOnlySession(session?.roles ?? []) ? pools.auditor : pools.app;
}

/** The actor object the services take. */
export function actorFrom(session) {
  return { userId: session.userId, roles: session.roles, mfaVerified: session.mfaVerified === true };
}

// ---- response helpers shared by the door route handlers -------------------

export const problem = (status, detail, extra = {}) =>
  Response.json({ type: 'about:blank', title: statusTitle(status), status, detail, ...extra }, { status });

export const seeOther = to => new Response(null, { status: 303, headers: { location: to } });

function statusTitle(s) {
  return { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests', 503: 'Service Unavailable' }[s] ?? 'Error';
}

/** Does this request want JSON back (fetch) rather than a redirect (form post)? */
export function wantsJson(request) {
  const ct = request.headers.get('content-type') ?? '';
  const accept = request.headers.get('accept') ?? '';
  return ct.includes('application/json') || (accept.includes('application/json') && !accept.includes('text/html'));
}

/** Read a JSON or form body into a plain object of strings. */
export async function readBody(request) {
  const ct = request.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/json')) {
      const b = await request.json();
      return b && typeof b === 'object' ? b : {};
    }
    const fd = await request.formData();
    return Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '']));
  } catch {
    return {};
  }
}

const SAFE = /^\/(?!\/)[\w\-./?=&%]*$/;
export const safePath = (p, fallback = '/') => (typeof p === 'string' && SAFE.test(p) ? p : fallback);

/** Answer a failure the way the caller can consume it. */
export function refuse(request, status, detail, backTo = '/') {
  if (wantsJson(request)) return problem(status, detail);
  const sep = backTo.includes('?') ? '&' : '?';
  return seeOther(`${backTo}${sep}notice=${encodeURIComponent(detail)}`);
}

export function succeed(request, body, backTo = '/') {
  if (wantsJson(request)) return Response.json({ ok: true, ...body });
  return seeOther(backTo);
}

/** YYYY-MM-DD from a Date or ISO string; empty for null. */
export const day = d => (d ? new Date(d).toISOString().slice(0, 10) : '');
