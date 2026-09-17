import { notFound } from 'next/navigation';
import { DoorBadge } from '@/components/DoorBadge';
import { requireLearner, getLearning } from '@/lib/dojo.mjs';
import { NotEntitledError, CoreUnavailableError, CoreRequestError } from '@/lib/learning.mjs';

export const dynamic = 'force-dynamic';

export default async function Course({ params }) {
  const { id } = await params;
  const { user } = await requireLearner(`/courses/${id}`);
  let v;
  try {
    v = await getLearning().courseView(user, id);
  } catch (e) {
    if (e instanceof NotEntitledError) return <Locked />;
    if (e instanceof CoreRequestError && e.status === 404) notFound();
    if (e instanceof CoreUnavailableError) return <Degraded />;
    throw e;
  }
  const pct = v.progress.percent_complete;
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <h1>{v.course.title}</h1>
        {v.course.summary && <p className="lede">{v.course.summary}</p>}
        <div className="progress" aria-label={`${pct}% complete`}><i style={{ width: `${pct}%` }} /></div>
        <p className="muted">{v.progress.lessons_completed} of {v.progress.lessons_total} lessons complete</p>
      </div>

      {v.next && (
        <p><a className="btn btn-primary" href={`/lessons/${v.next.id}`}>{v.progress.lessons_completed ? 'Resume' : 'Begin'}: {v.next.title}</a></p>
      )}

      <section className="card">
        <ol className="syllabus">
          {v.modules.map(m => (
            <li className="syllabus-module" key={m.id}>
              <h3>{m.title}</h3>
              <ul className="syllabus">
                {m.lessons.map(l => (
                  <li className={`syllabus-lesson${l.done ? ' done' : ''}`} key={l.id}>
                    <span className="tick" aria-hidden="true">{l.done && (
                      <svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    )}</span>
                    <a href={`/lessons/${l.id}`}>{l.title}</a>
                    {l.est_minutes && <span className="mins">{l.est_minutes} min</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      {v.assessment && (
        <section className="card card-tight">
          <h3>{v.assessment.title}</h3>
          <p className="muted">Pass mark {v.assessment.pass_percent}%.{v.assessment.max_attempts ? ` Up to ${v.assessment.max_attempts} attempts.` : ''}{' '}
            {v.progress.complete ? 'Every lesson is complete; the assessment is open.' : 'Finish every lesson first.'}</p>
          <form method="post" action="/api/learn/attempts">
            <input type="hidden" name="assessmentId" value={v.assessment.id} />
            <button className="btn btn-primary" type="submit" disabled={!v.progress.complete}>Start the assessment</button>
          </form>
        </section>
      )}
    </div>
  );
}

function Locked() {
  return (
    <div className="reading stack-6">
      <div className="section-head"><DoorBadge door="dojo" /><h1>This course is not in your library</h1>
        <p className="lede">Open the library to see what you hold.</p></div>
      <a className="btn btn-secondary" href="/library">Back to the library</a>
    </div>
  );
}
export function Degraded() {
  return (
    <div className="reading stack-6">
      <div className="section-head"><DoorBadge door="dojo" /><h1>Paused</h1>
        <p className="lede">Your progress is safe. The learning service is not answering right now. Try again in a minute.</p></div>
    </div>
  );
}
