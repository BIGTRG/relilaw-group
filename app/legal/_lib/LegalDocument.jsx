import { parseBlocks, documentMeta, headingId } from './markdown.mjs';

// Server-rendered legal document. Tokens only (legal.css); the draft callout
// is mandatory until an attorney has signed the text and the placeholders in
// square brackets are filled.
export function LegalDocument({ markdown, slug }) {
  const blocks = parseBlocks(markdown);
  const { title, dates } = documentMeta(blocks);
  const sections = blocks.filter((b) => b.type === 'h' && b.level === 2);
  const body = blocks.filter((b) => !(b.type === 'h' && b.level === 1) && !dates.includes(b.text));
  return (
    <article className="legal reading" aria-labelledby={`${slug}-title`}>
      <div className="rank-rule" aria-hidden="true" />
      <p className="eyebrow">Robinson Employment Law Institute</p>
      <h1 id={`${slug}-title`}>{title}</h1>
      {dates.length > 0 && (
        <p className="legal-dates">{dates.map((d, i) => <span key={i}>{d}</span>)}</p>
      )}

      <div className="callout callout-warn legal-draft" role="note">
        <p className="callout-title">DRAFT — requires licensed attorney review before publication</p>
        <p>This document is a working draft prepared for review. Items in square brackets are placeholders. It is not in force until an attorney licensed in North Carolina has reviewed it and this notice has been removed.</p>
      </div>

      {sections.length > 3 && (
        <nav className="legal-toc" aria-label="Sections">
          <p className="legal-toc-title">Contents</p>
          <ul>
            {sections.map((s) => <li key={s.text}><a href={`#${headingId(s.text)}`}>{s.text}</a></li>)}
          </ul>
        </nav>
      )}

      {body.map((b, i) => {
        if (b.type === 'h') {
          const id = headingId(b.text);
          if (b.level === 2) return <h2 key={i} id={id}>{b.text}</h2>;
          return <h3 key={i} id={id}>{b.text}</h3>;
        }
        if (b.type === 'ul') return <ul key={i}>{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>;
        return <p key={i}>{b.text}</p>;
      })}

      <nav className="legal-related" aria-label="Other legal documents">
        <a href="/legal/terms">Terms of Service</a>
        <a href="/legal/privacy">Privacy Policy</a>
        <a href="/legal/disclaimer">Training Disclaimer</a>
      </nav>
    </article>
  );
}
