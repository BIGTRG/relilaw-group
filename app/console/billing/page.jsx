import { requireDoor } from '@/lib/console-http.mjs';
import { billingLedger } from '@/lib/console.mjs';

import { day } from '@/lib/console-auth.mjs';
export const dynamic = 'force-dynamic';

const money = (cents, cur) => cents == null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format(Number(cents) / 100);
const dashboard = process.env.STRIPE_DASHBOARD_URL || 'https://dashboard.stripe.com/test/payments';

export default async function Billing() {
  const { conn } = await requireDoor('console', '/billing');
  const { events, entitlements } = await billingLedger(conn);
  return (
    <div className="stack-6">
      <div className="section-head">
        <p className="eyebrow">Module 04</p>
        <h1>Billing</h1>
        <p className="lede">Payments live in the processor's own dashboard; this page is the read-only ledger of what it told us and what we granted. Refunds and disputes revoke the entitlement through one path.</p>
        <p><a className="btn btn-secondary" href={dashboard} rel="noopener noreferrer" target="_blank">Open the payments dashboard</a></p>
      </div>
      <section className="card">
        <h2>Entitlement ledger</h2>
        {entitlements.length === 0 && <p className="muted">No entitlements granted yet.</p>}
        {entitlements.length > 0 && <div className="scroll-x"><table className="table">
          <thead><tr><th scope="col">Holder</th><th scope="col">Key</th><th scope="col">Source</th><th scope="col">Granted</th><th scope="col">Status</th></tr></thead>
          <tbody>{entitlements.map(e => (
            <tr key={e.id}>
              <td>{e.display_name}<br /><span className="muted small">{e.email}</span></td>
              <td><span className="cite-ref">{e.key}</span></td>
              <td><span className="cite-ref">{e.source}</span></td>
              <td>{day(e.granted_at)}</td>
              <td>{e.revoked_at ? <span className="badge badge-risk">Revoked{e.revoke_reason ? `: ${e.revoke_reason}` : ''}</span>
                : e.expires_at && new Date(e.expires_at) < new Date() ? <span className="badge badge-warn">Expired</span>
                : <span className="badge badge-ok">Active</span>}</td>
            </tr>))}</tbody>
        </table></div>}
      </section>
      <section className="card">
        <h2>Webhook events</h2>
        {events.length === 0 && <p className="muted">No events received yet.</p>}
        {events.length > 0 && <div className="scroll-x"><table className="table">
          <thead><tr><th scope="col">Received</th><th scope="col">Type</th><th scope="col">Object</th><th scope="col" className="num">Amount</th><th scope="col">Processed</th></tr></thead>
          <tbody>{events.map(ev => (
            <tr key={ev.id}>
              <td>{new Date(ev.received_at).toISOString().replace('T', ' ').slice(0, 16)}</td>
              <td><span className="cite-ref">{ev.type}</span></td>
              <td><span className="cite-ref">{ev.object_id ?? ''}</span></td>
              <td className="num">{money(ev.amount_total, ev.currency)}</td>
              <td>{ev.processed_at ? <span className="badge badge-ok">Processed</span> : <span className="badge badge-warn">Pending</span>}</td>
            </tr>))}</tbody>
        </table></div>}
      </section>
    </div>
  );
}
