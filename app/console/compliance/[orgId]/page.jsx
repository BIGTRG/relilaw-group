import { notFound } from 'next/navigation';
import { requireDoor } from '@/lib/console-http.mjs';
import { complianceReport, complianceMembers } from '@/lib/console.mjs';

import { day } from '@/lib/console-auth.mjs';
export const dynamic = 'force-dynamic';

export default async function OrgCompliance({ params }) {
  const { orgId } = await params;
  const { conn } = await requireDoor('console', `/compliance/${orgId}`);
  const [org] = await complianceReport(conn, { orgScope: /^[0-9a-f-]{36}$/i.test(orgId) ? orgId : null }).catch(() => []);
  if (!org) notFound();
  const members = await complianceMembers(conn, orgId);
  return (
    <div className="stack-6">
      <div className="section-head">
        <p className="eyebrow"><a href="/compliance">Compliance</a> · organisation</p>
        <h1>{org.org_name}</h1>
        <p className="lede">{org.completed} of {org.members} members hold a current credential.</p>
      </div>
      <section className="card"><div className="scroll-x"><table className="table">
        <thead><tr><th scope="col">Member</th><th scope="col">Enrolled</th><th scope="col">Completed</th><th scope="col">Credential</th></tr></thead>
        <tbody>{members.map(m => (
          <tr key={m.user_id}>
            <td>{m.display_name}<br /><span className="muted small">{m.email}</span></td>
            <td>{m.enrolled_at ? day(m.enrolled_at) : 'Not yet'}</td>
            <td>{m.completed_at ? day(m.completed_at) : 'In progress'}</td>
            <td>{m.credential_ref ? <a className="cite-ref" href={`/verify/${m.credential_ref}`}>{m.credential_ref}</a> : ''}</td>
          </tr>))}</tbody>
      </table></div></section>
    </div>
  );
}
