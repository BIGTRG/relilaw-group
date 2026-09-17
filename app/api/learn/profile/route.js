import { withLearner, seeOther } from '@/lib/learn-routes.mjs';
import { ProfileError } from '@/lib/learning.mjs';

// Change email / display name. The external_ref never changes (DB trigger);
// the Core learner, enrolments and credentials follow the learner across it.
export async function POST(request) {
  return withLearner(request, async ({ user, form, learning }) => {
    try {
      await learning.updateProfile(user, {
        email: String(form.get('email') ?? user.email),
        displayName: String(form.get('displayName') ?? user.display_name),
      });
    } catch (e) {
      if (e instanceof ProfileError) return seeOther(`/account?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
    return seeOther('/account?saved=1');
  });
}
