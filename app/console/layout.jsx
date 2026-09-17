import '@/components/door.css';
import { DoorNav, CONSOLE_LINKS } from '@/components/DoorNav';
import { currentSession, getAuthServices } from '@/lib/auth/http.mjs';
import { authorizeDoor } from '@/lib/console-auth.mjs';

export const metadata = { title: 'The Console · RELI' };

export default async function ConsoleLayout({ children }) {
  const s = await currentSession();
  let user = null;
  if (s && authorizeDoor({ session: s.session, door: 'console' }).ok) {
    const { rows } = await getAuthServices().db.query('select display_name from app_user where id = $1', [s.session.userId]);
    if (rows[0]) user = { display_name: rows[0].display_name, roles: s.session.roles };
  }
  return (
    <>
      <DoorNav door="console" user={user} links={user ? CONSOLE_LINKS : []} />
      <div className="wide">{children}</div>
    </>
  );
}
