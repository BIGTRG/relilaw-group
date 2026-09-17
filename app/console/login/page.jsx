import { DoorAuthForm } from '@/components/DoorAuthForm';
import { DoorBadge } from '@/components/DoorBadge';

export const metadata = { title: 'Sign in · The Console' };

export default async function ConsoleLogin({ searchParams }) {
  const sp = await searchParams;
  const next = typeof sp?.next === 'string' ? sp.next : '/';
  return (
    <div className="reading stack-6" style={{ padding: 0 }}>
      <div className="section-head">
        <DoorBadge door="console" />
        <h1>Sign in to the Console</h1>
        <p className="lede">Staff and auditors. Allow-listed addresses only; a second factor is required every time; every action is logged.</p>
      </div>
      <section className="card"><DoorAuthForm door="console" next={next} /></section>
    </div>
  );
}
