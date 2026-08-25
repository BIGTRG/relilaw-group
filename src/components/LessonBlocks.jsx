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

export function Sources({ citations }) {
  return (
    <section className="sources" aria-label="Sources">
      <h4>Sources — checked by a person</h4>
      {citations.map((c, i) => (
        <div className="source" key={i}>
          <span className="src-name">{c.name} <span className="cite-ref">{c.ref}</span></span>
          <span className={`verified${c.stale ? ' stale' : ''}`}>
            verified {c.verifiedOn}{c.reviewer ? ` · ${c.reviewer}` : ''}
          </span>
        </div>
      ))}
    </section>
  );
}
