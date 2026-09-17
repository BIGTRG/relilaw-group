import { PipelineBoard } from '@/components/PipelineBoard';
import { requireDoor, getPipeline } from '@/lib/console-http.mjs';
import { can } from '@/lib/permissions.mjs';

export const dynamic = 'force-dynamic';

export default async function StudioHome({ searchParams }) {
  const { actor } = await requireDoor('studio', '/');
  const sp = await searchParams;
  const versions = await getPipeline().listVersions();
  const notice = typeof sp?.notice === 'string' ? sp.notice : null;
  return (
    <div className="stack-6">
      <div className="section-head">
        <p className="eyebrow">Content pipeline</p>
        <h1>Draft, review, legal review, published.</h1>
        <p className="lede">Nothing skips the gate. A version becomes published by exactly one action, taken by a legal reviewer, recorded permanently.</p>
      </div>
      {notice && <p className="notice" role="status">{notice}</p>}
      <PipelineBoard versions={versions} hrefFor={v => `/versions/${v.id}`} />
      {can(actor.roles, 'draft_content') && (
        <section className="card card-tight">
          <h2>Start a new draft</h2>
          <p className="muted small">A draft is a pointer to a Core course and a version label. Content itself lives in the Core.</p>
          <form method="post" action="/api/studio/pipeline/draft" className="filter-form">
            <label className="field"><span>Course reference</span><input className="input" name="courseRef" defaultValue="NC-ORG-001" required pattern="[A-Za-z0-9-]{3,40}" /></label>
            <label className="field"><span>Version label</span><input className="input" name="versionRef" placeholder="v2" required pattern="[\w.-]{1,40}" /></label>
            <label className="field" style={{ flex: 1 }}><span>Title</span><input className="input" name="title" placeholder="North Carolina Wage and Hour, Orange Belt" /></label>
            <button className="btn btn-secondary" type="submit">Create draft</button>
          </form>
        </section>
      )}
    </div>
  );
}
