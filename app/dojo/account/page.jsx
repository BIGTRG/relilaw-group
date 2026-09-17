import { DoorBadge } from '@/components/DoorBadge';
import { requireLearner } from '@/lib/dojo.mjs';
import { getAuthServices } from '@/lib/auth/http.mjs';

export const dynamic = 'force-dynamic';

// Account details. One identity forever: the email and name can change, the
// learner reference and every credential earned under it do not.
export default async function Account({ searchParams }) {
  const { user } = await requireLearner('/account');
  const sp = (await searchParams) ?? {};
  const { db } = getAuthServices();
  const { rows: creds } = await db.query('select public_ref, issued_at from credential_link where user_id = $1 order by issued_at desc', [user.id]);
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <h1>Your account</h1>
        <p className="lede">Change your email or name here. Your learner reference and your credentials stay exactly as they are.</p>
      </div>
      {sp.saved === '1' && <div className="callout callout-ok" role="status">Saved.</div>}
      {sp.error && <div className="callout callout-risk" role="alert">{String(sp.error).slice(0, 200)}</div>}
      <form method="post" action="/api/learn/profile" className="card stack">
        <div className="field">
          <label className="label" htmlFor="displayName">Display name</label>
          <input className="input" id="displayName" name="displayName" defaultValue={user.display_name} required maxLength={200} autoComplete="name" />
        </div>
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" defaultValue={user.email} required maxLength={254} autoComplete="email" />
        </div>
        <div className="field">
          <span className="label" id="ref-label">Learner reference</span>
          <p className="cite-ref" aria-labelledby="ref-label" style={{ margin: 0 }}>{user.external_ref}</p>
          <p className="muted small" style={{ margin: 'var(--s1) 0 0' }}>Permanent. This is how the credential registry knows you, whatever your email or employer.</p>
        </div>
        <div><button className="btn btn-primary" type="submit">Save changes</button></div>
      </form>
      {creds.length > 0 && (
        <section className="card card-tight">
          <h2 className="h3">Your credentials</h2>
          <ul className="syllabus">
            {creds.map(c => (
              <li className="syllabus-lesson" key={c.public_ref}>
                <a href={`/verify/${c.public_ref}`}>{c.public_ref}</a>
                <span className="mins">{new Date(c.issued_at).toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
