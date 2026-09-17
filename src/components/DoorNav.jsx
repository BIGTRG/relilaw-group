// Top bar for the Studio and the Console. Paths are relative; the host decides the door.
export function DoorNav({ door, links = [], user, current }) {
  const title = { studio: 'The Studio', console: 'The Console' }[door];
  return (
    <nav className="door-bar" aria-label={title}>
      <div className="door-bar-inner">
        <a className="door-brand" href="/">
          <span className="door-brand-mark" aria-hidden="true" />
          <span>RELI</span>
          <span className="door">{title}</span>
        </a>
        <div className="door-links">
          {links.map(l => (
            <a key={l.href} href={l.href} aria-current={current === l.href ? 'page' : undefined}>{l.label}</a>
          ))}
          {user ? (
            <>
              <span className="door-who">{user.display_name} · {user.roles.join(', ')}</span>
              <form action="/api/auth/logout" method="post"><button className="btn btn-ghost btn-sm" type="submit">Sign out</button></form>
            </>
          ) : (
            <a href="/login">Sign in</a>
          )}
        </div>
      </div>
    </nav>
  );
}

export const CONSOLE_LINKS = [
  { href: '/compliance', label: '02 Compliance' },
  { href: '/catalogue', label: '03 Catalogue' },
  { href: '/billing', label: '04 Billing' },
  { href: '/pipeline', label: '05 Pipeline' },
  { href: '/stale', label: '06 Stale content' },
  { href: '/registry', label: '07 Registry' },
];
