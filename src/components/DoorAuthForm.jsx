'use client';
// Sign-in for the MFA-required doors (Studio, Console). Password first, then
// a six-digit authenticator code or a recovery code. An account arriving
// without an authenticator is walked through setting one up before the
// session is opened; nothing about the door is reachable until it is.
import { useState } from 'react';

async function post(url, body, method = 'POST') {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

export function DoorAuthForm({ door, next = '/' }) {
  const [step, setStep] = useState('password'); // password | code | setup | confirm | recovery
  const [pending, setPending] = useState(null);
  const [setup, setSetup] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = () => window.location.assign(next.startsWith('/') ? next : '/');

  async function onPassword(e) {
    e.preventDefault(); setBusy(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const { ok, data } = await post('/api/auth/login', Object.fromEntries(fd.entries()));
    setBusy(false);
    if (!ok) { setError(data.detail ?? 'Sign-in failed.'); return; }
    if (!data.mfaRequired) { go(); return; }
    setPending(data.pendingToken);
    setStep(data.totpEnrolled ? 'code' : 'setup');
  }

  async function onCode(e) {
    e.preventDefault(); setBusy(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const code = String(fd.get('code') ?? '').replace(/\s+/g, '');
    const method = fd.get('method') === 'recovery' ? 'recovery' : 'totp';
    const { ok, data } = await post('/api/auth/mfa', { pendingToken: pending, method, code });
    setBusy(false);
    if (!ok) { setError(data.detail ?? 'That code did not verify.'); if (data.status === 401 && /expired/i.test(data.detail ?? '')) setStep('password'); return; }
    go();
  }

  async function beginSetup() {
    setBusy(true); setError(null);
    const { ok, data } = await post('/api/studio/totp', { pendingToken: pending });
    setBusy(false);
    if (!ok) { setError(data.detail ?? 'Could not start authenticator setup.'); return; }
    setSetup(data); setStep('confirm');
  }

  async function onConfirm(e) {
    e.preventDefault(); setBusy(true); setError(null);
    const code = String(new FormData(e.currentTarget).get('code') ?? '').replace(/\s+/g, '');
    const c = await post('/api/studio/totp', { pendingToken: pending, code }, 'PUT');
    if (!c.ok) { setBusy(false); setError(c.data.detail ?? 'That code did not verify.'); return; }
    setRecovery(c.data.recoveryCodes ?? []);
    // Same code, same 30-second window: open the session now so the recovery
    // codes are shown once from inside a verified state.
    const m = await post('/api/auth/mfa', { pendingToken: pending, method: 'totp', code });
    setBusy(false);
    if (!m.ok) { setError('Authenticator saved. Sign in again with a fresh code.'); setStep('password'); return; }
    setStep('recovery');
  }

  return (
    <div className="stack">
      {step === 'password' && (
        <form className="stack" onSubmit={onPassword} noValidate>
          <label className="field"><span>Email</span>
            <input className="input" name="email" type="email" autoComplete="email" required /></label>
          <label className="field"><span>Password</span>
            <input className="input" name="password" type="password" autoComplete="current-password" required /></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'One moment' : 'Continue'}</button>
        </form>
      )}

      {step === 'code' && (
        <form className="stack" onSubmit={onCode} noValidate>
          <p className="muted">Enter the six-digit code from your authenticator app, or one of your recovery codes.</p>
          <label className="field"><span>Code</span>
            <input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus /></label>
          <label className="row" style={{ gap: 'var(--s2)' }}>
            <input type="checkbox" name="method" value="recovery" /> <span>This is a recovery code</span>
          </label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="row">
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Checking' : 'Verify and enter'}</button>
            <button className="btn btn-ghost" type="button" onClick={() => { setStep('password'); setError(null); }}>Start over</button>
          </div>
        </form>
      )}

      {step === 'setup' && (
        <div className="stack">
          <div className="callout callout-info">
            <p className="callout-title">This door requires a second factor</p>
            <p>Your password checked out. Before you can enter, set up an authenticator app (any TOTP app: 1Password, Bitwarden, Google Authenticator, Authy). It takes about a minute.</p>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn btn-primary" type="button" onClick={beginSetup} disabled={busy}>{busy ? 'One moment' : 'Set up my authenticator'}</button>
        </div>
      )}

      {step === 'confirm' && setup && (
        <form className="stack" onSubmit={onConfirm} noValidate>
          <p>Add a new account in your authenticator app and enter this key by hand, or open the link on a phone that has the app installed.</p>
          <p className="cite-ref" style={{ fontSize: 'var(--t-lg)', letterSpacing: '.12em', wordBreak: 'break-all' }}>{setup.secret}</p>
          <p><a className="btn btn-secondary btn-sm" href={setup.otpauthUrl}>Open in authenticator app</a></p>
          <label className="field"><span>Six-digit code shown by the app</span>
            <input className="input" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus /></label>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Checking' : 'Confirm and enter'}</button>
        </form>
      )}

      {step === 'recovery' && recovery && (
        <div className="stack">
          <div className="callout callout-warn">
            <p className="callout-title">Save these recovery codes now</p>
            <p>Each works once if you lose your authenticator. They are shown one time only.</p>
          </div>
          <ul className="lb-list" style={{ columns: 2 }}>
            {recovery.map(c => <li key={c} className="cite-ref">{c}</li>)}
          </ul>
          <button className="btn btn-primary" type="button" onClick={go}>I have saved them, continue</button>
        </div>
      )}
    </div>
  );
}
