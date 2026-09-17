// Dojo top bar. Plain links; the door is decided by host, paths stay relative.
import { ThemeToggle } from '@/components/ThemeToggle';

export function DojoNav({ signedIn }) {
  return (
    <nav className="topbar" aria-label="Dojo">
      <div className="topbar-inner">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          <span>RELI</span>
        </a>
        {signedIn ? (
          <div className="topbar-links">
            <a href="/">Home</a>
            <a href="/library">Library</a>
            <a href="/account">Account</a>
            <ThemeToggle />
            <form action="/api/auth/logout" method="post"><button className="btn btn-ghost btn-sm" type="submit">Sign out</button></form>
          </div>
        ) : (
          <div className="topbar-links">
            <ThemeToggle />
            <a href="/login">Sign in</a>
            <a className="btn btn-primary btn-sm" href="/signup">Create account</a>
          </div>
        )}
      </div>
    </nav>
  );
}
