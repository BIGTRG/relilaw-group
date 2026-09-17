import { Credential } from '@/components/Credential';
import { createCoreClient, CoreUnavailableError, CoreRequestError } from '@/lib/core-client.mjs';

// The public verify page (§8, Console module 07) — the most-shared URL this
// product will ever have. Server-rendered, no auth, rate-limited at nginx,
// answered live from the Core registry. Never cached.
export const dynamic = 'force-dynamic';

const REF = /^[A-Za-z0-9-]{6,40}$/;

export default async function VerifyPage({ params }) {
  const { ref } = await params;
  let record = null, state = 'missing';
  if (REF.test(ref)) {
    try {
      record = await createCoreClient().verifyCredential(ref);
      state = record?.status === 'revoked' || record?.revoked_at ? 'revoked' : 'valid';
    } catch (e) {
      if (e instanceof CoreUnavailableError) state = 'paused';
      else if (!(e instanceof CoreRequestError && e.status === 404)) throw e;
    }
  }
  return (
    <div className="reading stack-6">
      <div className="rank-rule" />
      <h1>Credential verification</h1>
      {state === 'valid' && (
        <>
          <Credential
            holder={record.learner_name}
            what={record.course_title}
            refCode={record.public_ref}
            issuedOn={String(record.issued_at).slice(0, 10)}
            rank={{ name: record.rank_name ?? '', color: 'var(--accent)' }}
          />
          <p className="muted small">
            Issued by {record.issuer}. This page reads the credential registry live; a revoked credential shows as revoked immediately.
          </p>
        </>
      )}
      {state === 'revoked' && (
        <div className="empty">
          <span className="badge badge-risk">Revoked</span>
          <h4>This credential has been revoked</h4>
          <p>Reference {record.public_ref} was issued to {record.learner_name} for {record.course_title} and is no longer valid{record.revoked_at ? ` as of ${String(record.revoked_at).slice(0, 10)}` : ''}.</p>
        </div>
      )}
      {state === 'missing' && (
        <div className="empty">
          <h4>No credential matches this reference</h4>
          <p>Check the reference code exactly as printed. References are case-sensitive.</p>
        </div>
      )}
      {state === 'paused' && (
        <div className="empty">
          <h4>Verification is paused</h4>
          <p>The registry is not answering right now. Try again in a minute; nothing about the credential has changed.</p>
        </div>
      )}
    </div>
  );
}
