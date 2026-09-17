import { requireDoor } from '@/lib/console-http.mjs';
import { listCredentials } from '@/lib/registry.mjs';
import { can } from '@/lib/permissions.mjs';

import { day } from '@/lib/console-auth.mjs';
export const dynamic = 'force-dynamic';

export default async function Registry({ searchParams }) {
  const { conn, actor, readOnly } = await requireDoor('console', '/registry');
  const sp = await searchParams;
  const q = typeof sp?.q === 'string' ? sp.q.slice(0, 80) : '';
  const rows = await listCredentials(conn, { q });
  const canRevoke = !readOnly && can(actor.roles, 'revoke_credential');
  return (
    <div className="stack-6">
      <div className="section-head">
        <p className="eyebrow">Module 07</p>
        <h1>Credential registry</h1>
        <p className="lede">Every credential issued, to whom, when, for which course. Revocation needs a reason, is permanent, and shows on the public verify page immediately.</p>
      </div>
      {typeof sp?.revoked === 'string' && (
        <p className="notice" role="status">Credential {sp.revoked} revoked{sp.local === '1' ? '. Recorded in this registry; the Core has no revoke endpoint yet, so the verify page reads the revocation from here.' : ' here and in the Core.'}</p>
      )}
      {typeof sp?.notice === 'string' && <p className="notice" role="status">{sp.notice}</p>}
      <form method="get" className="filter-form">
        <label className="field"><span>Search by reference, name, email or course</span><input className="input" name="q" defaultValue={q} /></label>
        <button className="btn btn-secondary" type="submit">Search</button>
      </form>
      {rows.length === 0 && <div className="empty"><h4>No credentials match</h4><p>{q ? 'Try a shorter search.' : 'Credentials appear here as learners pass the assessment.'}</p></div>}
      {rows.length > 0 && (
        <section className="card"><div className="scroll-x"><table className="table">
          <thead><tr><th scope="col">Reference</th><th scope="col">Holder</th><th scope="col">Course</th><th scope="col">Issued</th><th scope="col">Status</th>{canRevoke && <th scope="col">Revoke</th>}</tr></thead>
          <tbody>{rows.map(c => (
            <tr key={c.core_credential_id}>
              <td><a className="cite-ref" href={`/verify/${c.public_ref}`}>{c.public_ref}</a></td>
              <td>{c.display_name}<br /><span className="muted small">{c.email}</span></td>
              <td>{c.product_title ?? c.product_code ?? c.core_course_id}</td>
              <td>{day(c.issued_at)}</td>
              <td>{c.revoked_at
                ? <span className="badge badge-risk">Revoked {day(c.revoked_at)}</span>
                : <span className="badge badge-ok">Active</span>}
                {c.revoked_at && <div className="small muted">{c.revoke_reason} ({c.revoked_by_name ?? 'staff'})</div>}
              </td>
              {canRevoke && (
                <td>{!c.revoked_at && (
                  <form method="post" action="/api/console/registry/revoke" className="inline-form">
                    <input type="hidden" name="credentialId" value={c.core_credential_id} />
                    <label className="visually-hidden" htmlFor={`why-${c.core_credential_id}`}>Reason for revoking {c.public_ref}</label>
                    <input id={`why-${c.core_credential_id}`} className="input" name="reason" placeholder="Reason (required)" required style={{ width: 200 }} />
                    <button className="btn btn-danger btn-sm" type="submit">Revoke</button>
                  </form>
                )}</td>
              )}
            </tr>))}</tbody>
        </table></div></section>
      )}
    </div>
  );
}
