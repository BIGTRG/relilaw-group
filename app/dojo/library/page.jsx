import { DoorBadge } from '@/components/DoorBadge';
import { requireLearner, getLearning } from '@/lib/dojo.mjs';

export const dynamic = 'force-dynamic';
const money = (cents, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(cents / 100);

export default async function Library() {
  const { user } = await requireLearner('/library');
  const items = await getLearning().catalogue(user);
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <h1>Library</h1>
        <p className="lede">Every course is reviewed by a named attorney before it is published, with the review date shown on every lesson.</p>
      </div>
      {items.length === 0 && (
        <div className="empty">No courses are published yet.</div>
      )}
      {items.map(p => (
        <section className="card" key={p.code}>
          <div className="card-row">
            <div>
              <p className="eyebrow">{p.code} · {p.rank_code} belt</p>
              <h3 style={{ margin: 0 }}>{p.title}</h3>
            </div>
            {p.entitled
              ? <a className="btn btn-primary" href={`/courses/${p.core_course_id}`}>{p.enrollmentId ? 'Continue' : 'Start'}</a>
              : <span className="badge badge-plain">{money(p.price_cents, p.currency)}</span>}
          </div>
          {!p.entitled && (
            <p className="muted" style={{ marginTop: 'var(--s3)' }}>
              Checkout opens in the next release. Until then a staff member can grant access.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
