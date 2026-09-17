// The legal-review status of a course as the learner sees it (spec section 6,
// module 05). Either the published signature block, attributed and dated, or
// an honest "Draft, pending legal review" label. There is no third state.
const day = d => (d ? new Date(d).toISOString().slice(0, 10) : null);

export function ReviewStatus({ signature, courseRef }) {
  if (signature) {
    return (
      <section className="callout callout-ok signature" aria-labelledby="sig-title" data-review="published">
        <div className="callout-title" id="sig-title">Reviewed and published</div>
        <p style={{ margin: 0 }}>
          Signed by <b>{signature.reviewerName}</b>, legal reviewer, on{' '}
          <time dateTime={signature.signedAt}>{day(signature.signedAt)}</time>.
          {' '}Version <span className="cite-ref">{signature.versionRef}</span>
          {signature.publishedAt ? <> published <time dateTime={signature.publishedAt}>{day(signature.publishedAt)}</time>.</> : '.'}
        </p>
        {signature.note && <p className="muted small" style={{ margin: 'var(--s2) 0 0' }}>{signature.note}</p>}
      </section>
    );
  }
  return (
    <section className="callout callout-warn signature" aria-labelledby="sig-title" data-review="draft">
      <div className="callout-title" id="sig-title">Draft, pending legal review</div>
      <p style={{ margin: 0 }}>
        <span className="cite-ref">{courseRef}</span> has not been signed off by a legal reviewer yet. You can work through it,
        but no version of this content is published until an attorney signs it, and the signature will appear here when they do.
      </p>
    </section>
  );
}
