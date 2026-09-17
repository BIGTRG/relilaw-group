// The legible degraded state (spec section 1, test 13). Rendered whenever the
// Core is unreachable: a design-system callout, announced to assistive tech,
// no stack trace, no blank screen, and no claim the app cannot stand behind.
import { DoorBadge } from '@/components/DoorBadge';

export function DegradedCallout({ what = 'The learning service is not answering right now.', children = null }) {
  return (
    <div className="callout callout-warn" role="status" aria-live="polite" data-degraded="core">
      <div className="callout-title">Paused</div>
      <p style={{ margin: 0 }}>{what} Your progress is safe. Try again in a minute.</p>
      {children}
    </div>
  );
}

/** Whole-page degraded state for Dojo pages that cannot render without the Core. */
export function Degraded({ title = 'Paused', what }) {
  return (
    <div className="reading stack-6">
      <div className="section-head"><DoorBadge door="dojo" /><h1>{title}</h1></div>
      <DegradedCallout what={what} />
      <p><a className="btn btn-secondary" href="/">Back to the Dojo</a></p>
    </div>
  );
}
