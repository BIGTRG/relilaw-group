// The Core returns TYPED BLOCKS, never markup (§5). This file is the only
// place that decides what a block looks like. Unknown block types render as
// prose rather than crashing a lesson.
export function LessonBlock({ block }) {
  switch (block.type) {
    case 'trap':
      return (
        <aside className="lb-trap" role="note" aria-label="Common mistake">
          <span className="trap-label">The common mistake</span>
          <p>{block.text}</p>
        </aside>
      );
    case 'list':
      return <ul className="lb-list">{block.items.map((it, i) => <li key={i}>{it}</li>)}</ul>;
    case 'prose':
    default:
      return <p className="lb-prose">{block.text}</p>;
  }
}

const STALE_DAYS = 180;

/** Map a Core citation row to the display shape. Stale = older than 180 days or never verified. */
export function citationView(c, now = Date.now()) {
  const verifiedOn = c.verified_on ? String(c.verified_on).slice(0, 10) : null;
  const ageDays = verifiedOn ? Math.floor((now - Date.parse(verifiedOn)) / 86400000) : null;
  return {
    name: c.authority, ref: c.ref ?? '', url: c.url ?? null,
    verifiedOn, stale: ageDays === null || ageDays > STALE_DAYS, reviewer: c.reviewer ?? null,
  };
}

export function Sources({ citations }) {
  return (
    <section className="sources" aria-label="Sources">
      <h2 className="h4">Sources — checked by a person</h2>
      {citations.map((c, i) => (
        <div className="source" key={i}>
          <span className="src-name">
            {c.url ? <a href={c.url} rel="noopener noreferrer">{c.name}</a> : c.name}
            {c.ref && <> <span className="cite-ref">{c.ref}</span></>}
          </span>
          <span className={`verified${c.stale ? ' stale' : ''}`}>
            {c.verifiedOn ? `verified ${c.verifiedOn}` : 'verification pending'}{c.reviewer ? ` · ${c.reviewer}` : ''}{c.stale && c.verifiedOn ? ' · due for re-check' : ''}
          </span>
        </div>
      ))}
    </section>
  );
}
