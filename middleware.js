// One codebase, three doors. The Host header decides which building you are
// standing in; nginx terminates TLS per subdomain and (for the Console)
// enforces the IP allow-list before traffic ever reaches Node.
import { NextResponse } from 'next/server';

const DOOR_BY_HOST = [
  [/^app\./, '/dojo'],
  [/^studio\./, '/studio'],
  [/^admin\./, '/console'],
];

export function middleware(req) {
  const host = req.headers.get('host') ?? '';
  const { pathname } = req.nextUrl;

  // Shared public surfaces live on the Dojo host only.
  const isPublic = pathname.startsWith('/verify') || pathname.startsWith('/preview');

  let door = process.env.DOOR_OVERRIDE || null; // dev convenience only
  for (const [re, d] of DOOR_BY_HOST) if (re.test(host)) door = d;

  // A path from one door must not be reachable through another door's host.
  for (const [, d] of DOOR_BY_HOST) {
    if (pathname.startsWith(d) && door !== d) {
      return new NextResponse('not found', { status: 404 });
    }
  }
  if (isPublic || pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next();
  }
  if (door && !pathname.startsWith(door)) {
    const url = req.nextUrl.clone();
    url.pathname = `${door}${pathname === '/' ? '' : pathname}`;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon).*)'] };
