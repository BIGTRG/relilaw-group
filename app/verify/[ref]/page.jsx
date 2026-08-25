import { Credential } from '@/components/Credential';

// The public verify page (§8, Console module 07) — the most-shared URL this
// product will ever have. Server-rendered, no auth, rate-limited at nginx.
// M2 wires this to GET /v1/verify/:ref on the Core; until then it renders
// the production markup from a fixture so the design can be approved.
export default async function VerifyPage({ params }) {
  const { ref } = await params;
  const found = ref === 'RELI-DEMO-0001';
  return (
    <div className="reading stack-6">
      <div className="rank-rule" />
      <h1>Credential verification</h1>
      {found ? (
        <>
          <Credential
            holder="Maria Alvarez"
            what="NC Employment Law — Orange Belt (NC-ORG-001)"
            refCode="RELI-DEMO-0001"
            issuedOn="2026-08-24"
            rank={{ name: 'Orange', color: '#CC6B2C' }}
          />
          <p className="muted small">
            This credential was issued by Robinson Employment Law Institute and is
            current as of today. Verification reflects the registry in real time;
            a revoked credential shows as revoked immediately.
          </p>
        </>
      ) : (
        <div className="empty">
          <h4>No credential matches this reference</h4>
          <p>Check the reference code exactly as printed. References are case-sensitive.</p>
        </div>
      )}
    </div>
  );
}
