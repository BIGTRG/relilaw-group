import { notFound } from 'next/navigation';
import { VersionDetail } from '@/components/VersionDetail';
import { requireDoor, getPipeline } from '@/lib/console-http.mjs';

export const dynamic = 'force-dynamic';

export default async function StudioVersion({ params, searchParams }) {
  const { id } = await params;
  const { actor, readOnly } = await requireDoor('studio', `/versions/${id}`);
  const sp = await searchParams;
  const pipeline = getPipeline();
  const version = await pipeline.getVersion(id);
  if (!version) notFound();
  const [items, log, gate] = await Promise.all([
    pipeline.reviewItems(version.core_course_ref), pipeline.transitions(version.id), pipeline.gateStatus(version.id),
  ]);
  return (
    <VersionDetail version={version} items={items} log={log} gate={gate} actor={actor} door="studio" readOnly={readOnly}
      notice={typeof sp?.notice === 'string' ? sp.notice : null} />
  );
}
