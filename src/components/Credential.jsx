export function Credential({ holder, what, refCode, issuedOn, rank }) {
  return (
    <article className="credential">
      <span className="rank-chip">
        <span className="pip" style={{ '--rank-fill': rank.color }} /> {rank.name} Belt
      </span>
      <div className="cred-holder">{holder}</div>
      <div className="cred-what">{what}</div>
      <div className="cred-ref">{refCode} · issued {issuedOn}</div>
    </article>
  );
}
