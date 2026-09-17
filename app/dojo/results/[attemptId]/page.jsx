import { notFound } from 'next/navigation';
import { DoorBadge } from '@/components/DoorBadge';
import { LessonBlock } from '@/components/LessonBlocks';
import { Degraded } from '@/components/Degraded';
import { requireLearner, getLearning } from '@/lib/dojo.mjs';
import { NotEntitledError, CoreUnavailableError, CoreRequestError } from '@/lib/learning.mjs';

export const dynamic = 'force-dynamic';

// The assessment result (spec section 5). Constructed items score by element:
// the page names every model element the learner missed with its governing
// citation, rendered as teaching, never as a red X without a reason. The
// score and pass/fail come from the Core; nothing here recomputes them.
export default async function Results({ params }) {
  const { attemptId } = await params;
  const { user } = await requireLearner(`/results/${attemptId}`);
  let v;
  try {
    v = await getLearning().attemptView(user, attemptId);
  } catch (e) {
    if (e instanceof NotEntitledError) notFound();
    if (e instanceof CoreRequestError && e.status === 404) notFound();
    if (e instanceof CoreUnavailableError) return <Degraded title="Result paused" what="Your answers are recorded, but the learning service is not answering right now, so the result cannot be shown." />;
    throw e;
  }
  const { attempt, assessment, elements } = v;
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
  const earned = attempt.items.reduce((s, r) => s + (r.points_awarded ?? 0), 0);
  const possible = attempt.items.reduce((s, r) => s + r.points, 0);
  const missed = attempt.items.filter(r => r.points_awarded !== null && r.points_awarded < r.points).length;
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <p className="eyebrow">{assessment.title}</p>
        <h1>{pending ? 'Submitted for grading' : attempt.passed ? 'Passed' : 'Not yet'}</h1>
      </div>

      <section className="result" aria-labelledby="result-h">
        <div className="result-head" role="status" aria-live="polite">
          <span className="result-score" id="result-h">
            {pending
              ? 'Awaiting a grader'
              : <>Score <b>{attempt.score_percent}%</b> <span className="muted small">({earned} of {possible} points; pass mark {assessment.pass_percent}%)</span></>}
          </span>
          {!pending && (
            <span className={`badge ${attempt.passed ? 'badge-ok' : 'badge-warn'}`}>
              {attempt.passed ? 'Passed the threshold' : `Below the ${assessment.pass_percent}% threshold`}
            </span>
          )}
        </div>
        {!pending && (
          <p className="muted" style={{ margin: 0, padding: 'var(--s3) var(--s5)', borderBottom: '1px solid var(--line)' }}>
            {missed === 0
              ? 'Every element was present in your answers.'
              : `${missed} item${missed === 1 ? '' : 's'} had missing elements. Each missed element is listed below with the authority that governs it.`}
          </p>
        )}
        <ol className="elements">
          {attempt.items.map((r, n) => {
            const it = byId.get(r.item_id);
            const full = r.points_awarded !== null && r.points_awarded >= r.points;
            const partial = r.points_awarded !== null && r.points_awarded > 0 && !full;
            const els = elements?.get(r.item_id) ?? null;
            const state = r.points_awarded === null ? 'pending' : full ? 'got' : 'miss';
            return (
              <li className={`element ${state}`} key={r.item_id}>
                <span className="mark" aria-hidden="true">
                  {full ? <Tick /> : partial ? <Half /> : r.points_awarded === null ? null : <Cross />}
                </span>
                <div className="body">
                  <p className="eyebrow" style={{ margin: '0 0 var(--s1)' }}>Item {n + 1}</p>
                  {(it?.prompt ?? []).map((b, i) => <LessonBlock key={i} block={b} />)}
                  <span className="cite-ref item-score">
                    {r.points_awarded === null
                      ? 'pending'
                      : els
                        ? `${r.points_awarded} of ${r.points} element${r.points === 1 ? '' : 's'}`
                        : `${r.points_awarded} of ${r.points} point${r.points === 1 ? '' : 's'}`}
                  </span>
                  {els && (
                    <div className="stack" style={{ marginTop: 'var(--s3)' }}>
                      {els.some(e => e.matched) && (
                        <p className="muted small" style={{ margin: 0 }}>
                          <b>You identified:</b> {els.filter(e => e.matched).map(e => e.element).join(' ')}
                        </p>
                      )}
                      {els.some(e => !e.matched) && (
                        <div>
                          <p style={{ margin: '0 0 var(--s1)' }}><b>You missed:</b></p>
                          <ul className="missed-elements">
                            {els.filter(e => !e.matched).map((e, i) => (
                              <li key={i}>
                                {e.element}
                                {e.citation && <> <span className="cite-ref">{e.citation}</span></>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {attempt.passed && (
        <section className="callout callout-ok" role="status">
          <div className="callout-title">Credential issued</div>
          <p style={{ margin: 0 }}>
            {v.credentialRef
              ? <>Your public verification reference is <span className="cite-ref">{v.credentialRef}</span>. Anyone you share it with can confirm it without signing in.</>
              : 'Your credential is being recorded. It will appear in the Dojo shortly.'}
          </p>
        </section>
      )}

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

const Tick = () => <svg viewBox="0 0 16 16" fill="none" focusable="false"><path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Cross = () => <svg viewBox="0 0 16 16" fill="none" focusable="false"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
const Half = () => <svg viewBox="0 0 16 16" fill="none" focusable="false"><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" /><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" /></svg>;
