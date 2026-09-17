import { requireDoor } from '@/lib/console-http.mjs';
import { getCore } from '@/lib/dojo.mjs';
import { staleContent } from '@/lib/console.mjs';

import { day } from '@/lib/console-auth.mjs';
export const dynamic = 'force-dynamic';

export default async function Stale({ searchParams }) {
  await requireDoor('console', '/stale');
  const sp = await searchParams;
  const days = Number(sp?.days) || 180;
  const res = await staleContent(getCore(), days);
  return (
    <div className="stack-6">
      <div className="section-head">
        <p className="eyebrow">Module 06</p>
        <h1>Stale content</h1>
        <p className="lede">Citations whose verified-on date is older than {res.days} days, or missing. Almost nobody re-verifies every jurisdiction, every session, forever. This list is the moat.</p>
      </div>
      <form method="get" className="filter-form">
        <label className="field"><span>Older than (days)</span><input className="input" type="number" name="days" min="1" max="3650" defaultValue={res.days} /></label>
        <button className="btn btn-secondary" type="submit">Refresh</button>
      </form>
      {res.degraded && <div className="callout callout-warn"><p className="callout-title">The learning service is not answering</p><p>The stale-content query lives in the Core. Try again in a minute; nothing here has changed.</p></div>}
      {!res.degraded && res.items.length === 0 && <div className="empty"><h4>Nothing stale</h4><p>Every citation has been verified within {res.days} days.</p></div>}
      {!res.degraded && res.items.length > 0 && (
        <section className="card"><div className="scroll-x"><table className="table">
          <thead><tr><th scope="col">Citation</th><th scope="col">Lesson</th><th scope="col">Course</th><th scope="col">Verified on</th></tr></thead>
          <tbody>{res.items.map((c, i) => (
            <tr key={c.id ?? c.citation_id ?? i}>
              <td><span className="cite-ref">{c.ref ?? c.citation_ref ?? c.name ?? ''}</span>{c.name && c.ref ? <><br /><span className="small muted">{c.name}</span></> : null}</td>
              <td>{c.lesson_title ?? c.lesson?.title ?? c.lesson_id ?? ''}</td>
              <td>{c.course_title ?? c.course?.title ?? c.course_id ?? ''}</td>
              <td>{c.verified_on ? <span className="badge badge-warn">{day(c.verified_on)}</span> : <span className="badge badge-risk">Never</span>}</td>
            </tr>))}</tbody>
        </table></div></section>
      )}
    </div>
  );
}
