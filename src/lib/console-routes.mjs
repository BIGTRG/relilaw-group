// Framework-free HTTP handlers for the Console's write actions (price edits,
// credential revocation). Reads happen in the pages. Auditor sessions are
// refused here (403) AND, should any code path forget, by the reli_auditor
// database role they are connected as (spec test 4).

import { authorizeAction, actorFrom, connFor, readBody, refuse, succeed } from './console-auth.mjs';
import { ConsoleError, updatePrice } from './console.mjs';
import { RegistryError, revokeCredential } from './registry.mjs';

function fail(request, e, backTo) {
  if (e instanceof ConsoleError || e instanceof RegistryError) return refuse(request, e.status, e.message, backTo);
  if (e?.code === '42501') return refuse(request, 403, 'The database role refused that action', backTo);
  if (e?.code === 'P0001') return refuse(request, 409, e.message, backTo);
  throw e;
}

export function createConsoleHandlers({ pools, core = null }) {
  const door = 'console';
  return {
    /** POST { code, priceCents, active?, reason? } — staff only, audited. */
    async updatePrice(request, { session }) {
      const body = await readBody(request);
      const back = '/catalogue';
      const auth = authorizeAction({ session, door, capability: 'change_price_or_entitlement' });
      if (!auth.ok) return refuse(request, auth.status, auth.detail, back);
      try {
        const code = String(body.code ?? '').trim();
        const dollars = body.price !== undefined && body.price !== '' ? Math.round(Number(String(body.price).replace(/[^0-9.]/g, '')) * 100) : undefined;
        const priceCents = body.priceCents !== undefined ? Number(body.priceCents) : dollars;
        const active = body.active === undefined ? undefined : (body.active === true || body.active === 'true' || body.active === 'on');
        const p = await updatePrice(connFor(session, pools), { code, priceCents, active, actor: actorFrom(session), reason: body.reason ?? null });
        return succeed(request, { code: p.code, price_cents: p.price_cents }, back);
      } catch (e) {
        return fail(request, e, back);
      }
    },

    /** POST { credentialId, reason } — staff only, one-way, audited. */
    async revokeCredential(request, { session }) {
      const body = await readBody(request);
      const back = '/registry';
      const auth = authorizeAction({ session, door, capability: 'revoke_credential' });
      if (!auth.ok) return refuse(request, auth.status, auth.detail, back);
      try {
        const r = await revokeCredential(connFor(session, pools), {
          credentialId: String(body.credentialId ?? ''), reason: body.reason ?? '', actor: actorFrom(session), core,
        });
        return succeed(request, r, `${back}?revoked=${encodeURIComponent(r.publicRef)}${r.coreRevoked ? '' : '&local=1'}`);
      } catch (e) {
        return fail(request, e, back);
      }
    },
  };
}
