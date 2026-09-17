import { requireDoor, getPipeline } from '@/lib/console-http.mjs';
import { complianceReport, recentAudit } from '@/lib/console.mjs';
import { listCredentials } from '@/lib/registry.mjs';

export const dynamic = 'force-dynamic';

export default async function ConsoleHome() {
  const { user, conn, readOnly } = await requireDoor('console', '/');
  const [versions, orgs, creds, audit] = await Promise.all([
    getPipeline().listVersions(conn), complianceReport(conn), listCredentials(conn, { limit: 1000 }), recentAudit(conn, { limit: 12 }),
  ]);
  const inGate = versions.filter(v => v.state === 'legal_review').length;
  const published = versions.filter(v => v.state === 'published').length;
  return (
    <div className="stack-6">
      <div className="section-head">
        <p className="eyebrow">Overview</p>
        <h1>Good to see you, {user.display_name.split(' ')[0]}.</h1>
        <p className="lede">{readOnly ? 'You are reading as an auditor. Nothing on this door will accept a change from this session.' : 'Four modules ship in phase 1: compliance, catalogue, billing and the content pipeline, plus the stale-content query and the credential registry.'}</p>
      </div>
      <div className="stat-row">
        <div className="stat"><div className="stat-value">{inGate}</div><div className="stat-label">Awaiting legal sign-off</div></div>
        <div className="stat"><div className="stat-value">{published}</div><div className="stat-label">Published versions</div></div>
        <div className="stat"><div className="stat-value">{orgs.length}</div><div className="stat-label">Organisations</div></div>
        <div className="stat"><div className="stat-value">{creds.filter(c => !c.revoked_at).length}</div><div className="stat-label">Active credentials</div></div>
      </div>
      <section className="card">
        <h2>Recent audit events</h2>
        {audit.length === 0 && <p className="muted">Nothing recorded yet.</p>}
        {audit.length > 0 && (
          <div className="scroll-x"><table className="table log">
            <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Object</th><th scope="col">Actor</th><th scope="col">Reason</th></tr></thead>
            <tbody>{audit.map(a => (
              <tr key={a.id}>
                <td><time dateTime={new Date(a.at).toISOString()}>{new Date(a.at).toISOString().replace('T', ' ').slice(0, 16)}</time></td>
                <td><span className="cite-ref">{a.action}</span></td>
                <td>{a.object_type} {a.object_ref ? String(a.object_ref).slice(0, 12) : ''}{a.from_state ? ` ${a.from_state} to ${a.to_state}` : ''}</td>
                <td>{a.actor_name ?? 'system'}{a.actor_role ? ` (${a.actor_role})` : ''}</td>
                <td>{a.reason ?? ''}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
