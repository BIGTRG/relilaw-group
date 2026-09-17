// Public credential verification (§6 module 07). SERVER ONLY.
// - The page is answered live from the Core's public verify endpoint.
// - Revocation: the Core returns status/revoked_at; the reason lives in this
//   app's registry (credential_link.revoke_reason) and is overlaid here.
// - Rank colour is data from the Core's progression scheme (rank.meta.fill),
//   matched by name because lc_verify does not yet return rank meta.
// - Per-IP rate limit in Redis; over the limit the caller gets a clean 429.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CoreUnavailableError, CoreRequestError } from './core-client.mjs';
import { localRevocation } from './registry.mjs';

export const REF = /^[A-Za-z0-9-]{6,40}$/;

// ---- rate limit -------------------------------------------------------------

export const VERIFY_LIMIT = Number(process.env.VERIFY_RATE_LIMIT_PER_MIN) || 30;
const WINDOW_S = 60;

/** Fixed-window counter per IP. Fails OPEN if Redis is down: a verify page
 *  that cannot be read is a worse failure than one that can be scraped for a minute. */
export function createVerifyLimiter(redis, { limit = VERIFY_LIMIT, windowS = WINDOW_S } = {}) {
  return {
    async check(ip) {
      const key = `verify:rl:${ip || 'unknown'}`;
      try {
        const n = await redis.incr(key);
        if (n === 1) await redis.expire(key, windowS);
        if (n > limit) return { allowed: false, retryAfter: windowS, remaining: 0 };
        return { allowed: true, retryAfter: 0, remaining: limit - n };
      } catch {
        return { allowed: true, retryAfter: 0, remaining: limit, degraded: true };
      }
    },
  };
}

export function clientIp(headers) {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return headers.get('x-real-ip') ?? '0.0.0.0';
}

// ---- rank colour from scheme meta ------------------------------------------

const SCHEME_TTL_MS = 5 * 60_000;
let schemeCache = { at: 0, ranks: [] };

export async function rankMetaByName(core, name, { now = Date.now } = {}) {
  if (!name) return null;
  if (now() - schemeCache.at > SCHEME_TTL_MS) {
    try {
      const { items } = await core.listSchemes();
      schemeCache = { at: now(), ranks: (items ?? []).flatMap(s => s.ranks ?? []) };
    } catch {
      // keep whatever we had; a missing colour is not a failed verification
    }
  }
  const r = schemeCache.ranks.find(x => x.name?.toLowerCase() === String(name).toLowerCase());
  return r ? { name: r.name, position: r.position, fill: r.meta?.fill ?? null, ink: r.meta?.ink ?? null } : null;
}

export function resetRankCache() { schemeCache = { at: 0, ranks: [] }; }

// ---- the record ---------------------------------------------------------------

/**
 * Resolve everything the page shows. Never throws for expected outcomes:
 * state is one of valid | revoked | missing | paused | invalid.
 */
export async function resolveVerification({ core, db, ref }) {
  if (!REF.test(ref ?? '')) return { state: 'invalid', ref };
  let record = null;
  try {
    record = await core.verifyCredential(ref);
  } catch (e) {
    if (e instanceof CoreUnavailableError) return { state: 'paused', ref };
    if (e instanceof CoreRequestError && e.status === 404) return { state: 'missing', ref };
    if (e instanceof CoreRequestError && e.status === 429) return { state: 'paused', ref };
    throw e;
  }
  if (!record?.public_ref) return { state: 'missing', ref };

  const local = db ? await localRevocation(db, record.public_ref).catch(() => null) : null;
  const revoked = record.status === 'revoked' || !!record.revoked_at || !!local;
  const rank = await rankMetaByName(core, record.rank_name);
  return {
    state: revoked ? 'revoked' : 'valid',
    ref,
    record: {
      publicRef: record.public_ref,
      holder: record.learner_name,
      course: record.course_title,
      rankName: record.rank_name ?? null,
      issuer: record.issuer,
      issuedAt: record.issued_at ? String(record.issued_at).slice(0, 10) : null,
      revokedAt: (record.revoked_at ?? local?.revoked_at) ? String(record.revoked_at ?? local.revoked_at).slice(0, 10) : null,
      revokeReason: local?.revoke_reason ?? null,
    },
    rank,
  };
}

// ---- the 429 document ---------------------------------------------------------

let cssCache = null;
async function designSystemCss() {
  if (cssCache !== null) return cssCache;
  try {
    cssCache = await readFile(path.join(process.cwd(), 'brand', 'relidesignsystem.css'), 'utf8');
  } catch {
    cssCache = '';
  }
  return cssCache;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A complete, self-contained HTML document for the rate-limited state. */
export async function renderLimitedDocument({ retryAfter = 60 } = {}) {
  const css = await designSystemCss();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Too many verification requests</title>
<style>${css}</style>
</head>
<body>
<main id="main" class="reading stack-6">
  <div class="rank-rule"></div>
  <p class="eyebrow">Credential verification</p>
  <h1>Too many requests from your connection</h1>
  <p class="lede">The verification registry is checked one credential at a time. Wait about ${esc(retryAfter)} seconds and try the link again.</p>
  <div class="callout callout-info">
    <p class="callout-title">Nothing about the credential has changed</p>
    <p>This limit protects the people named on these pages from bulk collection. It applies per connection, not per credential.</p>
  </div>
  <p class="upl-notice">Robinson Employment Law Institute provides education about employment law, not legal advice. Course content is general legal information reviewed by a licensed attorney on the date shown.</p>
</main>
</body>
</html>`;
}

export async function limitedResponse({ retryAfter = 60 } = {}) {
  return new Response(await renderLimitedDocument({ retryAfter }), {
    status: 429,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'retry-after': String(retryAfter),
      'cache-control': 'no-store',
    },
  });
}

/**
 * Entry used by the page: applies the limiter and resolves the record.
 * Returns { limited: true, retryAfter } or { limited: false, ...verification }.
 */
export async function handleVerifyRequest({ core, db, redis, ref, ip }) {
  const rl = await createVerifyLimiter(redis).check(ip);
  if (!rl.allowed) return { limited: true, retryAfter: rl.retryAfter };
  const v = await resolveVerification({ core, db, ref });
  return { limited: false, ...v };
}
