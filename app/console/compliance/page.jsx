import { requireDoor } from '@/lib/console-http.mjs';
import { complianceReport } from '@/lib/console.mjs';

import { day } from '@/lib/console-auth.mjs';
export const dynamic = 'force-dynamic';

export default async function Compliance() {
  const { conn } = await requireDoor('console', '/compliance');
  const orgs = await complianceReport(conn);
  return (
    <div className="stack-6">
      <div className="section-head">
        <p className="eyebrow">Module 02</p>
        <h1>Compliance reporting</h1>
        <p className="lede">Completion, dates and credentials per organisation. This report never carries quiz answers, question-level scores or attempt detail; the query cannot reach them.</p>
      </div>
      {orgs.length === 0 && <div className="empty"><h4>No organisations yet</h4><p>Seat purchases arrive in phase 2. The report is ready for them.</p></div>}
      {orgs.length > 0 && (
        <section className="card"><div className="scroll-x"><table className="table">
          <thead><tr><th scope="col">Organisation</th><th scope="col" className="num">Members</th><th scope="col" className="num">Enrolled</th><th scope="col" className="num">Completed</th><th scope="col" className="num">Rate</th><th scope="col">Last completion</th></tr></thead>
          <tbody>{orgs.map(o => (
            <tr key={o.org_id}>
              <td><a href={`/compliance/${o.org_id}`}>{o.org_name}</a></td>
              <td className="num">{o.members}</td><td className="num">{o.enrolled}</td><td className="num">{o.completed}</td>
              <td className="num">{o.completion_rate}%</td>
              <td>{o.last_completion_at ? day(o.last_completion_at) : 'None'}</td>
            </tr>))}</tbody>
        </table></div></section>
      )}
    </div>
  );
}
