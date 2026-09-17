import { PipelineBoard } from '@/components/PipelineBoard';
import { requireDoor, getPipeline } from '@/lib/console-http.mjs';

export const dynamic = 'force-dynamic';

export default async function ConsolePipeline({ searchParams }) {
  const { conn } = await requireDoor('console', '/pipeline');
  const sp = await searchParams;
  const versions = await getPipeline().listVersions(conn);
  return (
    <div className="stack-6">
      <div className="section-head">
        <p className="eyebrow">Module 05</p>
        <h1>Content pipeline</h1>
        <p className="lede">The gate. Staff can move a version towards legal review; only a legal reviewer, in the Studio, can publish it. Every state module carries its reviewer's name and the date they signed.</p>
      </div>
      {typeof sp?.notice === 'string' && <p className="notice" role="status">{sp.notice}</p>}
      <PipelineBoard versions={versions} hrefFor={v => `/pipeline/${v.id}`} />
    </div>
  );
}
