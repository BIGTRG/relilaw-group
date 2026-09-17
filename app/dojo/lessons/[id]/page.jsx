import { notFound } from 'next/navigation';
import { DoorBadge } from '@/components/DoorBadge';
import { LessonBlock, Sources, citationView } from '@/components/LessonBlocks';
import { requireLearner, getLearning } from '@/lib/dojo.mjs';
import { NotEntitledError, CoreUnavailableError, CoreRequestError } from '@/lib/learning.mjs';
import { Degraded } from '@/components/Degraded';

export const dynamic = 'force-dynamic';

export default async function Lesson({ params }) {
  const { id } = await params;
  const { user } = await requireLearner(`/lessons/${id}`);
  let v;
  try {
    v = await getLearning().lessonView(user, id);
  } catch (e) {
    if (e instanceof NotEntitledError) notFound();
    if (e instanceof CoreRequestError && e.status === 404) notFound();
    if (e instanceof CoreUnavailableError) return <Degraded />;
    throw e;
  }
  const { lesson } = v;
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <p className="eyebrow"><a href={`/courses/${v.course.id}`}>{v.course.title}</a> · Lesson {v.position} of {v.total}</p>
        <h1>{lesson.title}</h1>
        {lesson.summary && <p className="lede">{lesson.summary}</p>}
      </div>
      <article className="lesson">
        {(lesson.blocks ?? []).map((b, i) => <LessonBlock key={i} block={b} />)}
        {lesson.citations?.length > 0 && <Sources citations={lesson.citations.map(c => citationView(c))} />}
      </article>
      <div className="lesson-nav">
        <div>{v.prev ? <a className="btn btn-ghost" href={`/lessons/${v.prev.id}`}>Previous</a> : <a className="btn btn-ghost" href={`/courses/${v.course.id}`}>Course</a>}</div>
        <form method="post" action="/api/learn/complete">
          <input type="hidden" name="lessonId" value={lesson.id} />
          <input type="hidden" name="next" value={v.next ? `/lessons/${v.next.id}` : `/courses/${v.course.id}`} />
          {v.done
            ? (v.next ? <a className="btn btn-primary" href={`/lessons/${v.next.id}`}>Next lesson</a> : <a className="btn btn-primary" href={`/courses/${v.course.id}`}>Back to the course</a>)
            : <button className="btn btn-primary" type="submit">{v.next ? 'Mark complete and continue' : 'Mark complete'}</button>}
        </form>
      </div>
    </div>
  );
}
