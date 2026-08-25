import { DoorBadge } from '@/components/DoorBadge';
import { Ladder } from '@/components/Ladder';

// M2 wires this to the session + Learning Core. Until auth lands, the page
// renders the real components against fixture data so every screen Deon
// clicks is the production markup, not a mockup.
import { RANKS, FIXTURE_LEARNER } from '@/fixtures/dojo';

export default function DojoHome() {
  const learner = FIXTURE_LEARNER;
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <h1>Welcome back, {learner.firstName}.</h1>
        <p className="lede">
          You hold the <b>{learner.rank.name} Belt</b> in North Carolina employment law.
          {' '}{learner.nextStep}
        </p>
      </div>
      <section className="card" aria-label="Your rank ladder">
        <Ladder ranks={RANKS} current={learner.rank.order} />
      </section>
      <section className="card card-tight">
        <h3>Continue</h3>
        <p className="muted">{learner.resume.course} — {learner.resume.lesson}</p>
        <a className="btn" href={learner.resume.href}>Resume lesson</a>
      </section>
    </div>
  );
}
