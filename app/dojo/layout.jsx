import './dojo.css';
import { DojoNav } from '@/components/DojoNav';
import { currentSession } from '@/lib/auth/http.mjs';

export default async function DojoLayout({ children }) {
  const s = await currentSession();
  return (
    <>
      <DojoNav signedIn={!!s} />
      {children}
    </>
  );
}
