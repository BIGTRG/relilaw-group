import { LegalDocument } from '../_lib/LegalDocument.jsx';
import { readLegalMarkdown } from '../_lib/markdown.mjs';

// Static, server-rendered. The text lives in content/legal/disclaimer.md.
export const dynamic = 'force-static';

export const metadata = {
  title: 'Training Disclaimer · Robinson Employment Law Institute',
  description: 'Robinson Employment Law Institute Training Disclaimer (draft pending attorney review).',
};

export default function Page() {
  return <LegalDocument slug="disclaimer" markdown={readLegalMarkdown('disclaimer')} />;
}
