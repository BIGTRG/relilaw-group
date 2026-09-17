import { AuthForm } from '@/components/AuthForm';
import { DoorBadge } from '@/components/DoorBadge';

export const metadata = { title: 'Sign in · RELI' };

export default async function Login({ searchParams }) {
  const sp = await searchParams;
  const next = typeof sp?.next === 'string' ? sp.next : '/';
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <h1>Sign in</h1>
        <p className="lede">Pick up where you left off.</p>
      </div>
      <section className="card">
        <AuthForm mode="login" next={next} />
      </section>
      <p className="muted">New here? <a href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</a>.</p>
    </div>
  );
}
