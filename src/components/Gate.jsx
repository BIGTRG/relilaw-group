// The four-step publish gate (design system 9.6). `state` is the version's
// current state; `signed` carries the sign-off when there is one.
import { STATES, STATE_LABEL } from '@/lib/pipeline.mjs';

import { day } from '@/lib/console-auth.mjs';
export function Gate({ state, signed, openItems = 0 }) {
  const idx = STATES.indexOf(state);
  return (
    <div className="scroll-x">
      <ol className="gate" aria-label="Publish gate">
        {STATES.map((s, i) => {
          const cls = i < idx || state === 'published' ? 'done' : i === idx ? 'active' : 'locked';
          return (
            <li key={s} className={`gate-step ${cls}`} aria-current={i === idx ? 'step' : undefined}>
              <span className="gs-name">{STATE_LABEL[s]}</span>
              {s === 'legal_review' && state !== 'published' && (
                <span className="gs-lock">Legal only{openItems > 0 ? ` · ${openItems} open` : ''}</span>
              )}
              {s === 'published' && signed?.signed_at && (
                <span className="gs-meta">{signed.reviewer_name} · {day(signed.signed_at)}</span>
              )}
              {s === 'published' && !signed?.signed_at && <span className="gs-meta">Unsigned</span>}
              {cls === 'done' && s !== 'published' && <span className="gs-meta">Done</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
