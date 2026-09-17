import { LegalDocument } from '../_lib/LegalDocument.jsx';
import { readLegalMarkdown } from '../_lib/markdown.mjs';

// Static, server-rendered. The text lives in content/legal/terms.md.
export const dynamic = 'force-static';

export const metadata = {
  title: 'Terms of Service · Robinson Employment Law Institute',
  description: 'Robinson Employment Law Institute Terms of Service (draft pending attorney review).',
};

export default function Page() {
  return <LegalDocument slug="terms" markdown={readLegalMarkdown('terms')} />;
}
