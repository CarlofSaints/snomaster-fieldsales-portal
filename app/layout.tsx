import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SnoMaster BA Measurement',
  description: 'Business Analyst performance measurement dashboard',
  icons: { icon: '/snomaster-logo.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
