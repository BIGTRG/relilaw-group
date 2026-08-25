import '../brand/relidesignsystem.css';
import './fonts.css';
import { Newsreader, Public_Sans, IBM_Plex_Mono } from 'next/font/google';

const display = Newsreader({ subsets: ['latin'], axes: ['opsz'], weight: 'variable', variable: '--nf-display' });
const body = Public_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--nf-body' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--nf-mono' });
import { UplNotice } from '@/components/UplNotice';

export const metadata = {
  title: 'Robinson Employment Law Institute',
  description: 'Verified, rank-based employment law training. Every module reviewed by a named attorney, with the review date shown.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <main id="main">{children}</main>
        <div className="reading" style={{ paddingTop: 0 }}>
          <UplNotice />
        </div>
      </body>
    </html>
  );
}
