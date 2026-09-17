// One codebase, three doors. The Host header decides which building you are
// standing in; nginx terminates TLS per subdomain and (for the Console)
// enforces the IP allow-list before traffic ever reaches Node.
//
// Rewrites re-enter this proxy once more with the server's own bind host
// (localhost) and the original request headers. Those re-entries carry the
// marker header set below; nginx strips the marker from anything arriving
// from outside, so it can only be set by this file.
import { NextResponse } from 'next/server';

const DOOR_BY_HOST = [
  [/^app\./, '/dojo'],
  [/^studio\./, '/studio'],
  [/^admin\./, '/console'],
];
const MARKER = 'x-reli-rewritten';
const ORIGINAL_HOST = 'x-reli-host';
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function middleware(req) {
  const host = req.headers.get('host') ?? '';
  const { pathname } = req.nextUrl;

  // Internal re-entry after a rewrite: already routed, let it through.
  if (req.headers.get(MARKER) === '1' && LOOPBACK.test(host)) return NextResponse.next();

  // Surfaces that are the same on every door, or not pages at all.
  if (pathname.startsWith('/api/') || pathname.startsWith('/verify') || pathname.startsWith('/preview') ||
      pathname.startsWith('/legal') || pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next();
  }

  let door = process.env.DOOR_OVERRIDE || null; // dev convenience only
  for (const [re, d] of DOOR_BY_HOST) if (re.test(host)) door = d;

  // A path from one door must not be reachable through another door's host,
  // nor through a bare IP / unknown host.
  for (const [, d] of DOOR_BY_HOST) {
    if (pathname.startsWith(d) && door !== d) {
      return new NextResponse('not found', { status: 404 });
    }
  }

  if (door && !pathname.startsWith(door)) {
    const url = req.nextUrl.clone();
    url.pathname = `${door}${pathname === '/' ? '' : pathname}`;
    // Behind TLS-terminating nginx, X-Forwarded-Proto makes nextUrl https://
    // while the Node server itself speaks plain http; an https rewrite is then
    // treated as external and proxied over TLS to a plain port. Keep it local.
    url.protocol = 'http:';
    const headers = new Headers(req.headers);
    headers.set(MARKER, '1');
    headers.set(ORIGINAL_HOST, host);
    return NextResponse.rewrite(url, { request: { headers } });
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon).*)'] };
