import { notFound } from 'next/navigation';
import { VersionDetail } from '@/components/VersionDetail';
import { requireDoor, getPipeline } from '@/lib/console-http.mjs';

export const dynamic = 'force-dynamic';

export default async function ConsoleVersion({ params, searchParams }) {
  const { id } = await params;
  const { actor, readOnly, conn } = await requireDoor('console', `/pipeline/${id}`);
  const sp = await searchParams;
  const pipeline = getPipeline();
  const version = await pipeline.getVersion(id, conn);
  if (!version) notFound();
  const [items, log, gate] = await Promise.all([
    pipeline.reviewItems(version.core_course_ref, conn), pipeline.transitions(version.id, conn), pipeline.gateStatus(version.id, conn),
  ]);
  return (
    <VersionDetail version={version} items={items} log={log} gate={gate} actor={actor} door="console" readOnly={readOnly}
      notice={typeof sp?.notice === 'string' ? sp.notice : null} />
  );
}
