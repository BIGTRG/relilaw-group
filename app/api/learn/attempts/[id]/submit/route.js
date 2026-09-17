import { withLearner, seeOther } from '@/lib/learn-routes.mjs';

export async function POST(request, { params }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return seeOther('/');
  return withLearner(request, async ({ user, form, learning }) => {
    // fields are item:<uuid>; radios give one value, checkboxes several
    const answers = [];
    const seen = new Set();
    for (const key of form.keys()) {
      if (!key.startsWith('item:') || seen.has(key)) continue;
      seen.add(key);
      const itemId = key.slice(5);
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) continue;
      const values = form.getAll(key).map(String).filter(Boolean);
      if (!values.length) continue;
      answers.push({ item_id: itemId, response: values.length === 1 && !values[0].includes('\n') && values[0].length <= 64 ? values : values });
    }
    await learning.submitAssessment(user, id, answers);
    return seeOther(`/results/${id}`);
  });
}
