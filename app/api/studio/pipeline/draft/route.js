import { withDoor, getPipelineHandlers } from '@/lib/console-http.mjs';

export async function POST(request) {
  return withDoor(request, 'studio', (req, ctx) => getPipelineHandlers('studio').createDraft(req, ctx));
}
