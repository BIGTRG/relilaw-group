import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Credential } from '@/components/Credential';
import { getCore } from '@/lib/dojo.mjs';
import { getAuthServices } from '@/lib/auth/http.mjs';
import { handleVerifyRequest, clientIp } from '@/lib/verify.mjs';
import './verify.css';

// The public verify page (§6, module 07): the most-shared URL this product
// will ever have. No login. Answered live from the Core registry, revocation
// reason overlaid from this app's registry, rank colour from the Core's
// scheme data, per-IP rate limit in Redis. Never cached.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { ref } = await params;
  return { title: `Verify ${ref} · RELI`, robots: { index: false } };
}

export default async function VerifyPage({ params }) {
  const { ref } = await params;
  const h = await headers();
  const { db, redis } = getAuthServices();
  const r = await handleVerifyRequest({ core: getCore(), db, redis, ref, ip: clientIp(h) });
  if (r.limited) redirect(`/verify/limited?after=${r.retryAfter}`);

  const rec = r.record;
  const rankColor = r.rank?.fill ?? 'var(--accent)';
  return (
    <div className="reading stack-6 verify">
      <div className="rank-rule" />
      <header className="verify-head">
        <p className="eyebrow">Credential verification</p>
        <h1>{r.state === 'valid' ? 'This credential is valid.' : r.state === 'revoked' ? 'This credential has been revoked.' : r.state === 'paused' ? 'Verification is paused.' : 'No credential matches.'}</h1>
      </header>

      {r.state === 'valid' && (
        <>
          <Credential holder={rec.holder} what={rec.course} refCode={rec.publicRef} issuedOn={rec.issuedAt}
            rank={{ name: rec.rankName ?? '', color: rankColor }} />
          <dl className="verify-facts">
            <div><dt>Status</dt><dd><span className="badge badge-ok">Valid</span></dd></div>
            <div><dt>Issued by</dt><dd>{rec.issuer}</dd></div>
            <div><dt>Issued on</dt><dd><time dateTime={rec.issuedAt}>{rec.issuedAt}</time></dd></div>
            {rec.rankName && <div><dt>Rank</dt><dd><span className="pip" style={{ '--rank-fill': rankColor }} aria-hidden="true" />{rec.rankName} Belt</dd></div>}
          </dl>
          <p className="muted small">This page reads the credential registry live at the moment you opened it. A revoked credential shows as revoked immediately. Reference codes are exact-match and case-sensitive.</p>
        </>
      )}

      {r.state === 'revoked' && (
        <section className="revoked-card" aria-labelledby="revoked-h">
          <span className="badge badge-risk">Revoked</span>
          <h2 id="revoked-h">{rec.publicRef}</h2>
          <p>Issued to <b>{rec.holder}</b> for <b>{rec.course}</b>{rec.issuedAt ? ` on ${rec.issuedAt}` : ''}{rec.revokedAt ? `, revoked on ${rec.revokedAt}` : ''}.</p>
          <dl className="verify-facts">
            <div><dt>Reason</dt><dd>{rec.revokeReason ?? 'No reason was recorded with this revocation.'}</dd></div>
            <div><dt>Issued by</dt><dd>{rec.issuer}</dd></div>
          </dl>
          <p className="muted small">A revoked credential is not valid for any purpose. If you believe this is an error, contact the institute with the reference above.</p>
        </section>
      )}

      {r.state === 'missing' && (
        <div className="empty">
          <h4>No credential matches this reference</h4>
          <p>Check the reference code exactly as printed. References are case-sensitive and match exactly; a partial code returns nothing by design.</p>
        </div>
      )}
      {r.state === 'invalid' && (
        <div className="empty">
          <h4>That does not look like a credential reference</h4>
          <p>References are 6 to 40 letters, digits and dashes.</p>
        </div>
      )}
      {r.state === 'paused' && (
        <div className="empty">
          <h4>The registry is not answering right now</h4>
          <p>Try again in a minute. Nothing about the credential has changed.</p>
        </div>
      )}
    </div>
  );
}
