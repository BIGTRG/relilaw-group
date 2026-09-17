'use client';
// One client component for sign-in and sign-up. Posts JSON to the auth API;
// on success navigates to `next`. No framework magic, no third-party auth UI.
import { useState } from 'react';

export function AuthForm({ mode, next = '/' }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const isSignup = mode === 'signup';

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    const res = await fetch(isSignup ? '/api/auth/signup' : '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.detail ?? data.error ?? 'Something went wrong.'); setBusy(false); return; }
    if (data.mfaRequired) { setError('This account requires a second factor. Sign in on the door it belongs to.'); setBusy(false); return; }
    window.location.assign(next.startsWith('/') ? next : '/');
  }

  return (
    <form className="stack" onSubmit={onSubmit} noValidate>
      {isSignup && (
        <label className="field">
          <span>Your name</span>
          <input className="input" name="displayName" autoComplete="name" required />
        </label>
      )}
      <label className="field">
        <span>Email</span>
        <input className="input" name="email" type="email" autoComplete="email" required />
      </label>
      <label className="field">
        <span>Password{isSignup ? ' (12 characters or more)' : ''}</span>
        <input className="input" name="password" type="password" autoComplete={isSignup ? 'new-password' : 'current-password'} minLength={isSignup ? 12 : undefined} required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'One moment' : isSignup ? 'Create account' : 'Sign in'}
      </button>
    </form>
  );
}
