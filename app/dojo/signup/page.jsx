import { AuthForm } from '@/components/AuthForm';
import { DoorBadge } from '@/components/DoorBadge';

export const metadata = { title: 'Create account · RELI' };

export default async function Signup({ searchParams }) {
  const sp = await searchParams;
  const next = typeof sp?.next === 'string' ? sp.next : '/';
  return (
    <div className="reading stack-6">
      <div className="section-head">
        <DoorBadge door="dojo" />
        <h1>Create your account</h1>
        <p className="lede">Your progress, ranks and credentials live here. Your email is never your learner identifier.</p>
      </div>
      <section className="card">
        <AuthForm mode="signup" next={next} />
      </section>
      <p className="muted">Already have an account? <a href={`/login?next=${encodeURIComponent(next)}`}>Sign in</a>.</p>
    </div>
  );
}
