// Shared bits for the form-post learn routes: they take a classic form
// submission (works without JavaScript), act through the learning service,
// and answer with a 303 redirect. Errors redirect to a legible page.
import 'server-only';
import { currentSession, getAuthServices } from './auth/http.mjs';
import { getLearning } from './dojo.mjs';
import { NotEntitledError, CoreUnavailableError, CoreRequestError } from './learning.mjs';

export const seeOther = to => new Response(null, { status: 303, headers: { location: to } });

export async function withLearner(request, fn) {
  const s = await currentSession();
  if (!s) return seeOther('/login');
  const { db } = getAuthServices();
  const { rows } = await db.query('select id, external_ref, email, display_name, status from app_user where id = $1', [s.session.userId]);
  const user = rows[0];
  if (!user || user.status !== 'active') return seeOther('/login');
  const form = await request.formData();
  try {
    return await fn({ user, form, learning: getLearning() });
  } catch (e) {
    if (e instanceof NotEntitledError) return seeOther('/library');
    if (e instanceof CoreUnavailableError) return seeOther('/?paused=1');
    if (e instanceof CoreRequestError) {
      // e.g. max attempts reached, attempt already submitted: show the problem plainly
      const msg = e.problem?.detail ?? e.problem?.title ?? 'The learning service rejected that action.';
      return seeOther(`/?notice=${encodeURIComponent(msg)}`);
    }
    throw e;
  }
}

const SAFE = /^\/(?!\/)[\w\-./?=&%]*$/;
export const safePath = (p, fallback = '/') => (typeof p === 'string' && SAFE.test(p) ? p : fallback);
