import { withDoor, getPipelineHandlers } from '@/lib/console-http.mjs';

export async function POST(request) {
  return withDoor(request, 'console', (req, ctx) => getPipelineHandlers('console').signOff(req, ctx));
}
