import { notFound } from 'next/navigation';
import { DoorBadge } from '@/components/DoorBadge';
import { LessonBlock } from '@/components/LessonBlocks';
import { requireLearner, getLearning } from '@/lib/dojo.mjs';
import { NotEntitledError, CoreUnavailableError, CoreRequestError } from '@/lib/learning.mjs';
import { Degraded } from '../../courses/[id]/page';

export const dynamic = 'force-dynamic';

export default async function Results({ params }) {
  const { attemptId } = await params;
  const { user } = await requireLearner(`/results/${attemptId}`);
  let v;
  try {
    v = await getLearning().attemptView(user, attemptId);
  } catch (e) {
    if (e instanceof NotEntitledError) notFound();
    if (e instanceof CoreRequestError && e.status === 404) notFound();
    if (e instanceof CoreUnavailableError) return <Degraded />;
    throw e;
  }
  const { attempt, assessment } = v;
  if (attempt.status === 'in_progress') {
    return (
      <div className="reading stack-6">
        <div className="section-head"><DoorBadge door="dojo" /><h1>Not submitted yet</h1></div>
        <a className="btn btn-primary" href={`/assess/${attemptId}`}>Return to the assessment</a>
      </div>
    );
  }
  const byId = new Map(assessment.items.map(i => [i.id, i]));
  const pending = attempt.status === 'needs_grading';
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <p className="eyebrow">{assessment.title}</p>
        <h1>{pending ? 'Submitted for grading' : attempt.passed ? 'Passed' : 'Not yet'}</h1>
      </div>
      <section className="result">
        <div className="result-head">
          <span className="result-score">
            {pending ? 'Awaiting a grader' : <>Score <b>{attempt.score_percent}%</b> · pass mark {assessment.pass_percent}%</>}
          </span>
          {!pending && <span className={`badge ${attempt.passed ? 'badge-ok' : 'badge-warn'}`}>{attempt.passed ? 'Credential issued' : 'Revisit and retry'}</span>}
        </div>
        <ul className="elements">
          {attempt.items.map(r => {
            const it = byId.get(r.item_id);
            const got = r.points_awarded !== null && r.points_awarded >= r.points;
            const partial = r.points_awarded !== null && r.points_awarded > 0 && !got;
            return (
              <li className={`element ${got ? 'got' : 'miss'}`} key={r.item_id}>
                <span className="mark" aria-hidden="true">{got ? '✓' : partial ? '½' : '×'}</span>
                <div className="body">
                  {(it?.prompt ?? []).map((b, i) => <LessonBlock key={i} block={b} />)}
                  <span className="cite-ref">{r.points_awarded === null ? 'pending' : `${r.points_awarded} of ${r.points} point${r.points === 1 ? '' : 's'}`}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <div className="lesson-nav">
        <a className="btn btn-ghost" href={`/courses/${assessment.course_id}`}>Back to the course</a>
        {attempt.passed && v.credentialRef && <a className="btn btn-primary" href={`/verify/${v.credentialRef}`}>View your credential</a>}
        {!pending && !attempt.passed && (
          <form method="post" action="/api/learn/attempts">
            <input type="hidden" name="assessmentId" value={assessment.id} />
            <button className="btn btn-primary" type="submit">Try again</button>
          </form>
        )}
      </div>
    </div>
  );
}
