import { notFound } from 'next/navigation';
import { DoorBadge } from '@/components/DoorBadge';
import { LessonBlock } from '@/components/LessonBlocks';
import { requireLearner, getLearning } from '@/lib/dojo.mjs';
import { NotEntitledError, CoreUnavailableError, CoreRequestError } from '@/lib/learning.mjs';
import { Degraded } from '../../courses/[id]/page';

export const dynamic = 'force-dynamic';

export default async function Assess({ params }) {
  const { attemptId } = await params;
  const { user } = await requireLearner(`/assess/${attemptId}`);
  let v;
  try {
    v = await getLearning().attemptView(user, attemptId);
  } catch (e) {
    if (e instanceof NotEntitledError) notFound();
    if (e instanceof CoreRequestError && e.status === 404) notFound();
    if (e instanceof CoreUnavailableError) return <Degraded />;
    throw e;
  }
  if (v.attempt.status !== 'in_progress') {
    return (
      <div className="reading stack-6">
        <div className="section-head"><DoorBadge door="dojo" /><h1>This attempt is already submitted</h1></div>
        <a className="btn btn-primary" href={`/results/${attemptId}`}>See the result</a>
      </div>
    );
  }
  const a = v.assessment;
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <p className="eyebrow">Assessment · pass mark {a.pass_percent}%</p>
        <h1>{a.title}</h1>
        <p className="lede">Answer every item, then submit once. Scoring happens on the server; you will see which elements you got and which to revisit.</p>
      </div>
      <form method="post" action={`/api/learn/attempts/${attemptId}/submit`} className="card">
        {a.items.map((it, n) => (
          <fieldset className="item" key={it.id} style={{ border: 0, margin: 0, padding: 'var(--s5) 0' }}>
            <legend>{n + 1}. {(it.prompt ?? []).map((b, i) => <LessonBlock key={i} block={b} />)}</legend>
            {it.kind === 'multi' && <p className="muted small">Select all that apply.</p>}
            {(it.options ?? []).map(op => (
              <label className="option" key={op.id}>
                <input type={it.kind === 'multi' ? 'checkbox' : 'radio'} name={`item:${it.id}`} value={op.id} />
                <span>{op.text}</span>
              </label>
            ))}
            {it.kind === 'constructed' && <textarea className="textarea" name={`item:${it.id}`} rows={4} />}
          </fieldset>
        ))}
        <div className="lesson-nav">
          <span className="muted">{a.items.length} items</span>
          <button className="btn btn-primary" type="submit">Submit answers</button>
        </div>
      </form>
    </div>
  );
}
