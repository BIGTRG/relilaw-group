import { STATES, STATE_LABEL } from '@/lib/pipeline.mjs';

import { day } from '@/lib/console-auth.mjs';
export function PipelineBoard({ versions, hrefFor }) {
  return (
    <div className="board">
      {STATES.map(s => {
        const items = versions.filter(v => v.state === s);
        return (
          <section key={s} className={`board-col${s === 'legal_review' ? ' is-gate' : ''}`} aria-label={STATE_LABEL[s]}>
            <h3><span>{STATE_LABEL[s]}</span><span>{items.length}</span></h3>
            {items.length === 0 && <p className="muted small">Nothing here.</p>}
            {items.map(v => (
              <a key={v.id} className="board-card" href={hrefFor(v)}>
                <div className="bc-ref">{v.core_course_ref} · {v.core_version_ref}</div>
                {v.title && <div className="bc-title">{v.title}</div>}
                <div className="bc-meta">
                  {v.state !== 'published' && <span>{v.open_items} open item{v.open_items === 1 ? '' : 's'}</span>}
                  {v.state === 'published' && v.reviewer_name && <span>Signed {v.reviewer_name} {day(v.signed_at)}</span>}
                  <span>{day(v.updated_at)}</span>
                </div>
              </a>
            ))}
          </section>
        );
      })}
    </div>
  );
}
