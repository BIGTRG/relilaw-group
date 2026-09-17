// One content version: gate, review items, actions, transition log.
// Server component; actions are plain form posts to the door's API.
import { Gate } from './Gate';
import { STATE_LABEL, PUBLISH_REFUSAL } from '@/lib/pipeline.mjs';
import { can } from '@/lib/permissions.mjs';

import { day } from '@/lib/console-auth.mjs';
const Tick = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5 4.6 9 10 3.4" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
);

export function VersionDetail({ version: v, items, log, gate, actor, door, readOnly, notice }) {
  const api = `/api/${door}/pipeline`;
  const roles = actor.roles;
  const canDraft = !readOnly && can(roles, 'draft_content');
  const isLegal = !readOnly && can(roles, 'publish_jurisdiction_content');
  const open = items.filter(i => i.status === 'open');
  const signed = v.signed_at ? { reviewer_name: v.reviewer_name, signed_at: v.signed_at } : null;

  return (
    <div className="stack-6">
      <div className="section-head">
        <p className="eyebrow">{v.core_course_ref} · version {v.core_version_ref}</p>
        <h1>{v.title || v.core_course_ref}</h1>
        <p className="lede">
          {v.state === 'published'
            ? 'Published and immutable. An edit creates a new draft that walks the whole path again.'
            : `In ${STATE_LABEL[v.state]}. ${open.length} attorney-review item${open.length === 1 ? '' : 's'} outstanding.`}
        </p>
      </div>

      {notice && <p className="notice" role="status">{notice}</p>}

      <section className="card" aria-labelledby="gate-h">
        <h2 id="gate-h" className="visually-hidden">Gate</h2>
        <Gate state={v.state} signed={signed} openItems={open.length} />
        {v.state !== 'published' && gate?.blockers?.length > 0 && (
          <div className="callout callout-risk" style={{ marginTop: 'var(--s4)' }}>
            <p className="callout-title">Blocked from publication</p>
            <ul className="lb-list">{gate.blockers.map(b => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
      </section>

      {v.state === 'published' && signed && (
        <section className="signature" aria-label="Legal sign-off">
          <div>
            <div className="eyebrow">Signed by</div>
            <div className="sig-name">{signed.reviewer_name}</div>
            <div className="sig-date">{new Date(signed.signed_at).toISOday()} · legal reviewer</div>
            {v.signoff_note && <p className="small" style={{ marginTop: 'var(--s2)' }}>{v.signoff_note}</p>}
          </div>
        </section>
      )}

      <section className="card">
        <div className="spread">
          <h2>Attorney review items</h2>
          <span className={`badge ${open.length ? 'badge-warn' : 'badge-ok'}`}>{open.length} open · {items.length - open.length} resolved</span>
        </div>
        {items.length === 0 && <p className="muted">No review items are queued for {v.core_course_ref}.</p>}
        <ul className="review-list">
          {items.map(it => (
            <li key={it.id} className={`review-item ${it.status}`}>
              <span className="ri-mark" aria-hidden="true">{it.status === 'resolved' && <Tick />}</span>
              <div className="ri-body">
                <div className="ri-title">{it.title}</div>
                {it.detail && <div className="ri-detail">{it.detail}</div>}
                <div className="ri-meta">
                  {it.status === 'resolved'
                    ? `Resolved by ${it.resolved_by_name ?? 'legal'} · ${day(it.resolved_at)}`
                    : `Open since ${day(it.opened_at)}`}
                </div>
              </div>
              {it.status === 'open' && isLegal && v.state !== 'published' && door === 'studio' && (
                <form method="post" action={`${api}/resolve`}>
                  <input type="hidden" name="itemId" value={it.id} />
                  <input type="hidden" name="versionId" value={v.id} />
                  <button className="btn btn-secondary btn-sm" type="submit">Resolve</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      {v.state !== 'published' && (
        <section className="card" aria-labelledby="actions-h">
          <h2 id="actions-h">Actions</h2>
          <div className="actions-row">
            {v.state === 'draft' && canDraft && (
              <form method="post" action={`${api}/transition`}>
                <input type="hidden" name="versionId" value={v.id} />
                <input type="hidden" name="to" value="sme_review" />
                <button className="btn btn-primary" type="submit">Send to SME review</button>
              </form>
            )}
            {v.state === 'sme_review' && canDraft && (
              <>
                <form method="post" action={`${api}/transition`}>
                  <input type="hidden" name="versionId" value={v.id} />
                  <input type="hidden" name="to" value="legal_review" />
                  <button className="btn btn-primary" type="submit">Send to legal review</button>
                </form>
                <form method="post" action={`${api}/transition`}>
                  <input type="hidden" name="versionId" value={v.id} />
                  <input type="hidden" name="to" value="draft" />
                  <button className="btn btn-ghost" type="submit">Return to draft</button>
                </form>
              </>
            )}
            {v.state === 'legal_review' && isLegal && door === 'studio' && (
              <>
                <form method="post" action={`${api}/signoff`} className="stack" style={{ flex: 1, minWidth: 280 }}>
                  <input type="hidden" name="versionId" value={v.id} />
                  <label className="field">
                    <span>Sign-off note (recorded permanently with your name and the date)</span>
                    <textarea className="input textarea" name="reason" rows={3} required
                      placeholder="Reviewed all lessons and citations against current N.C. Gen. Stat.; eight review items resolved." />
                  </label>
                  <button className="btn btn-primary" type="submit" disabled={open.length > 0}
                    aria-describedby={open.length > 0 ? 'signoff-block' : undefined}>
                    Sign off and publish
                  </button>
                  {open.length > 0 && <p id="signoff-block" className="refusal">Resolve every open review item first. {open.length} remain{open.length === 1 ? 's' : ''}.</p>}
                </form>
                <form method="post" action={`${api}/transition`}>
                  <input type="hidden" name="versionId" value={v.id} />
                  <input type="hidden" name="to" value="draft" />
                  <button className="btn btn-ghost" type="submit">Return to draft</button>
                </form>
              </>
            )}
            {v.state === 'legal_review' && !isLegal && (
              <div className="stack" style={{ gap: 'var(--s2)' }}>
                <button className="btn btn-primary" type="button" disabled aria-describedby="publish-refusal">Sign off and publish</button>
                <p id="publish-refusal" className="refusal">{PUBLISH_REFUSAL}</p>
              </div>
            )}
            {readOnly && <p className="muted small">Auditor sessions are read-only.</p>}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Transition log</h2>
        <p className="muted small">Append-only. Every step records actor, role, from-state, to-state and reason.</p>
        {log.length === 0 && <p className="muted">No transitions yet.</p>}
        {log.length > 0 && (
          <div className="scroll-x">
            <table className="table log">
              <thead><tr><th scope="col">When</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Actor</th><th scope="col">Role</th><th scope="col">Reason</th></tr></thead>
              <tbody>
                {log.map(t => (
                  <tr key={t.id}>
                    <td><time dateTime={new Date(t.at).toISOString()}>{new Date(t.at).toISOString().replace('T', ' ').slice(0, 16)}</time></td>
                    <td>{t.from_state ? STATE_LABEL[t.from_state] : 'New'}</td>
                    <td>{STATE_LABEL[t.to_state]}</td>
                    <td>{t.actor_name ?? 'system'}</td>
                    <td><span className="cite-ref">{t.actor_role}</span></td>
                    <td>{t.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
