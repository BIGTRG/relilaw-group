// Server helpers for Dojo pages: the signed-in user + a wired learning service.
import 'server-only';
import { redirect } from 'next/navigation';
import { currentSession, getAuthServices } from './auth/http.mjs';
import { createCoreClient } from './core-client.mjs';
import { createLearningService } from './learning.mjs';

let core;
export function getCore() {
  if (!core) core = createCoreClient();
  return core;
}

let learning;
export function getLearning() {
  if (!learning) learning = createLearningService({ db: getAuthServices().db, core: getCore() });
  return learning;
}

/** The signed-in learner, or a redirect to /dojo/login. */
export async function requireLearner(nextPath = '/') {
  const s = await currentSession();
  if (!s) redirect(`/dojo/login?next=${encodeURIComponent(nextPath)}`);
  const { db } = getAuthServices();
  const { rows } = await db.query(
    'select id, external_ref, email, display_name, status from app_user where id = $1', [s.session.userId]);
  const user = rows[0];
  if (!user || user.status !== 'active') redirect('/dojo/login');
  return { user, session: s.session };
}

export const firstName = name => (name ?? '').trim().split(/\s+/)[0] || 'there';
