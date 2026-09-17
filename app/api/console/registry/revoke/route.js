import { withDoor, getConsoleHandlers } from '@/lib/console-http.mjs';

export async function POST(request) {
  return withDoor(request, 'console', (req, ctx) => getConsoleHandlers().revokeCredential(req, ctx));
}
