import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SaifInvest — Moroccan Portfolio Intelligence',
  description:
    'Portfolio tracking, market research, and investment analytics for the Moroccan market.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
