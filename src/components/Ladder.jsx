// The belt ladder rail — the emotional centre of the product (§brand 9.2).
// Ranks arrive as DATA from the Learning Core (colour included); nothing
// here hardcodes a belt. `current` is the learner's rank order.
export function Ladder({ ranks, current }) {
  return (
    <div className="scroll-x" role="list" aria-label="Rank ladder">
      <div className="ladder">
        {ranks.map(r => {
          const state = r.order < current ? 'done' : r.order === current ? 'now' : '';
          return (
            <div role="listitem" key={r.order} className={`rung ${state}`}
                 aria-current={state === 'now' ? 'step' : undefined}>
              <span className="node" style={{ '--rank-fill': r.color }}>
                {state === 'done' && (
                  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M3 8.5 6.5 12 13 4.5" stroke="var(--rank-ink, #fff)" strokeWidth="2.2"
                          strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="name">{r.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
