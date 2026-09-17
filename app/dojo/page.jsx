import { DoorBadge } from '@/components/DoorBadge';
import { Ladder } from '@/components/Ladder';
import { requireLearner, getLearning, firstName } from '@/lib/dojo.mjs';

export const dynamic = 'force-dynamic';

export default async function DojoHome() {
  const { user } = await requireLearner('/');
  const home = await getLearning().home(user);
  const current = home.ranks.find(r => r.order === home.currentOrder);

  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <h1>Welcome back, {firstName(user.display_name)}.</h1>
        {home.degraded ? (
          <p className="lede">Your progress is safe. The learning service is not answering right now, so ranks and lessons are paused. Try again in a minute.</p>
        ) : current ? (
          <p className="lede">
            You hold the <b>{current.name} Belt</b> in North Carolina employment law.
            {' '}{nextStepLine(home)}
          </p>
        ) : (
          <p className="lede">Your ladder appears once a course is published.</p>
        )}
      </div>

      {!home.degraded && home.ranks.length > 0 && (
        <section className="card" aria-label="Your rank ladder">
          <Ladder ranks={home.ranks} current={home.currentOrder} />
        </section>
      )}

      {home.resume && (
        <section className="card card-tight">
          <h3>Continue</h3>
          {home.resume.lesson ? (
            <>
              <p className="muted">{home.resume.courseTitle} — {home.resume.lesson.title}</p>
              <div className="progress" aria-label={`${home.resume.progress.percent_complete}% complete`}>
                <i style={{ width: `${home.resume.progress.percent_complete}%` }} />
              </div>
              <p><a className="btn btn-primary" href={`/lessons/${home.resume.lesson.id}`}>Resume lesson</a></p>
            </>
          ) : (
            <>
              <p className="muted">{home.resume.courseTitle} — every lesson is complete. The assessment is open.</p>
              <form method="post" action="/api/learn/attempts">
                <input type="hidden" name="assessmentId" value={home.resume.assessment.id} />
                <button className="btn btn-primary" type="submit">Start the assessment</button>
              </form>
            </>
          )}
        </section>
      )}

      {!home.degraded && !home.resume && (
        <section className="card card-tight">
          <h3>Your library</h3>
          <p className="muted">
            {home.catalogue.some(c => c.entitled)
              ? 'You have finished everything you hold. New courses appear here when they are published and reviewed.'
              : 'You do not hold a course yet. Browse the library to begin.'}
          </p>
          <a className="btn btn-secondary" href="/library">Open the library</a>
        </section>
      )}

      {home.credentials.length > 0 && (
        <section className="card card-tight">
          <h3>Your credentials</h3>
          <ul className="syllabus">
            {home.credentials.map(c => (
              <li className="syllabus-lesson done" key={c.public_ref}>
                <span className="tick" aria-hidden="true">✓</span>
                <a href={`/verify/${c.public_ref}`}>{c.public_ref}</a>
                <span className="mins">{new Date(c.issued_at).toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function nextStepLine(home) {
  const r = home.resume;
  if (!r) return home.catalogue.some(c => c.entitled) ? 'Nothing is waiting on you.' : 'Choose a course to begin.';
  if (r.lesson) {
    const left = r.progress.lessons_total - r.progress.lessons_completed;
    return `${left} lesson${left === 1 ? '' : 's'} stand${left === 1 ? 's' : ''} between you and your next belt.`;
  }
  return 'The assessment stands between you and your next belt.';
}
