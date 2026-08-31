import type { Metadata } from 'next';
import './globals.css';
import SignOffNotice from '@/components/SignOffNotice';

export const metadata: Metadata = {
  title: 'SnoMaster BA Measurement',
  description: 'Business Analyst performance measurement dashboard',
  icons: { icon: '/snomaster-logo.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SignOffNotice />
        {children}
      </body>
    </html>
  );
}
