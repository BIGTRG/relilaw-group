import { LegalDocument } from '../_lib/LegalDocument.jsx';
import { readLegalMarkdown } from '../_lib/markdown.mjs';

// Static, server-rendered. The text lives in content/legal/privacy.md.
export const dynamic = 'force-static';

export const metadata = {
  title: 'Privacy Policy · Robinson Employment Law Institute',
  description: 'Robinson Employment Law Institute Privacy Policy (draft pending attorney review).',
};

export default function Page() {
  return <LegalDocument slug="privacy" markdown={readLegalMarkdown('privacy')} />;
}
