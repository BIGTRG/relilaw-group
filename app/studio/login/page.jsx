import { DoorAuthForm } from '@/components/DoorAuthForm';
import { DoorBadge } from '@/components/DoorBadge';

export const metadata = { title: 'Sign in · The Studio' };

export default async function StudioLogin({ searchParams }) {
  const sp = await searchParams;
  const next = typeof sp?.next === 'string' ? sp.next : '/';
  return (
    <div className="reading stack-6" style={{ padding: 0 }}>
      <div className="section-head">
        <DoorBadge door="studio" />
        <h1>Sign in to the Studio</h1>
        <p className="lede">Authors, instructors and legal reviewers. Invite only. A second factor is required every time.</p>
      </div>
      <section className="card"><DoorAuthForm door="studio" next={next} /></section>
    </div>
  );
}
