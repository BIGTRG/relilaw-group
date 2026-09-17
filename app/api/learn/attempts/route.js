import { withLearner, seeOther } from '@/lib/learn-routes.mjs';

export async function POST(request) {
  return withLearner(request, async ({ user, form, learning }) => {
    const assessmentId = String(form.get('assessmentId') ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(assessmentId)) return seeOther('/');
    const { attempt } = await learning.startAssessment(user, assessmentId);
    return seeOther(`/assess/${attempt.id}`);
  });
}
