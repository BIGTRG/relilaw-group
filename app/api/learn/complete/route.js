import { withLearner, seeOther, safePath } from '@/lib/learn-routes.mjs';

export async function POST(request) {
  return withLearner(request, async ({ user, form, learning }) => {
    const lessonId = String(form.get('lessonId') ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(lessonId)) return seeOther('/');
    await learning.completeLesson(user, lessonId);
    return seeOther(safePath(form.get('next')));
  });
}
