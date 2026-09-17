import { DoorBadge } from '@/components/DoorBadge';
import { requireLearner, getLearning } from '@/lib/dojo.mjs';

export const dynamic = 'force-dynamic';
const money = (cents, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(cents / 100);

// Buy buttons are entitlement-aware (§4.2): owned → Continue/Start, purchasable
// → a form post to hosted Checkout, never a live checkout link for something
// already owned. Locked-by-prerequisite arrives with the second rank.
export default async function Library({ searchParams }) {
  const { user } = await requireLearner('/library');
  const sp = (await searchParams) ?? {};
  const items = await getLearning().catalogue(user);
  const justPurchased = sp.purchased === '1';
  const pending = justPurchased && items.some(p => !p.entitled); // webhook not landed yet
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <h1>Library</h1>
        <p className="lede">Every course is reviewed by a named attorney before it is published, with the review date shown on every lesson.</p>
      </div>

      {justPurchased && (
        <div className={`callout ${pending ? 'callout-info' : 'callout-ok'}`} role="status" aria-live="polite">
          <strong>{pending ? 'Payment received.' : 'Purchased — thank you.'}</strong>{' '}
          {pending
            ? <>Your access is being switched on now; this usually takes a few seconds. <a href="/library?purchased=1">Refresh</a> if the course still shows a price.</>
            : <>Your receipt and enrolment confirmation are on their way by email. Your first lesson is ready below.</>}
        </div>
      )}
      {sp.owned === '1' && (
        <div className="callout callout-info" role="status">You already own that course — nothing to buy. Continue below.</div>
      )}
      {sp.checkout === 'failed' && (
        <div className="callout callout-warn" role="alert">We couldn&apos;t open checkout just now. Nothing was charged. Please try again in a moment.</div>
      )}

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
            {p.entitled ? (
              <div className="card-row" style={{ gap: 'var(--s3)' }}>
                <span className="badge badge-ok">Owned</span>
                <a className="btn btn-primary" href={`/courses/${p.core_course_id}`}>{p.enrollmentId ? 'Continue' : 'Start'}</a>
              </div>
            ) : (
              <form method="post" action="/api/billing/checkout" className="card-row" style={{ gap: 'var(--s3)' }}>
                <input type="hidden" name="product_code" value={p.code} />
                <span className="badge badge-plain">{money(p.price_cents, p.currency)}</span>
                <button type="submit" className="btn btn-primary" aria-label={`Buy ${p.title} for ${money(p.price_cents, p.currency)}`}>Buy</button>
              </form>
            )}
          </div>
          {!p.entitled && (
            <p className="muted" style={{ marginTop: 'var(--s3)' }}>
              One payment, permanent access. Checkout is hosted by Stripe; we never see your card number.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
