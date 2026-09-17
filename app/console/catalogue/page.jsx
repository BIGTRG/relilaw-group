import { requireDoor } from '@/lib/console-http.mjs';
import { listProducts } from '@/lib/console.mjs';
import { can } from '@/lib/permissions.mjs';

export const dynamic = 'force-dynamic';

const money = (cents, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur || 'usd').toUpperCase() }).format(cents / 100);

export default async function Catalogue({ searchParams }) {
  const { conn, actor, readOnly } = await requireDoor('console', '/catalogue');
  const sp = await searchParams;
  const products = await listProducts(conn);
  const canEdit = !readOnly && can(actor.roles, 'change_price_or_entitlement');
  return (
    <div className="stack-6">
      <div className="section-head">
        <p className="eyebrow">Module 03</p>
        <h1>Catalogue and pricing</h1>
        <p className="lede">What we sell and what it costs. A price change is recorded as an audit event with the before and after. Access is never checked against a price; it is checked against an entitlement.</p>
      </div>
      {typeof sp?.notice === 'string' && <p className="notice" role="status">{sp.notice}</p>}
      <section className="card"><div className="scroll-x"><table className="table">
        <thead><tr><th scope="col">Code</th><th scope="col">Title</th><th scope="col">Rank</th><th scope="col" className="num">Price</th><th scope="col">Active</th>{canEdit && <th scope="col">Change</th>}</tr></thead>
        <tbody>{products.map(p => (
          <tr key={p.code}>
            <td><span className="cite-ref">{p.code}</span></td>
            <td>{p.title}</td>
            <td>{p.rank_code}</td>
            <td className="num">{money(p.price_cents, p.currency)}</td>
            <td><span className={`badge ${p.active ? 'badge-ok' : 'badge-plain'}`}>{p.active ? 'Active' : 'Inactive'}</span></td>
            {canEdit && (
              <td>
                <form method="post" action="/api/console/catalogue/price" className="inline-form">
                  <input type="hidden" name="code" value={p.code} />
                  <label className="visually-hidden" htmlFor={`price-${p.code}`}>New price in dollars for {p.code}</label>
                  <input id={`price-${p.code}`} className="input" name="price" inputMode="decimal" defaultValue={(p.price_cents / 100).toFixed(2)} required />
                  <label className="row" style={{ gap: 'var(--s1)' }}><input type="checkbox" name="active" defaultChecked={p.active} /> <span className="small">Active</span></label>
                  <label className="visually-hidden" htmlFor={`reason-${p.code}`}>Reason</label>
                  <input id={`reason-${p.code}`} className="input" name="reason" placeholder="Reason" style={{ width: 160 }} />
                  <button className="btn btn-secondary btn-sm" type="submit">Save</button>
                </form>
              </td>
            )}
          </tr>))}</tbody>
      </table></div></section>
    </div>
  );
}
