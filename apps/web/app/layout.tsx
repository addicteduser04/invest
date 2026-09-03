import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import './globals.css';

const editorialSerif = Fraunces({
  subsets: ['latin'],
  weight: ['400', '600', '900'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'SaifInvest — Moroccan Portfolio Intelligence',
  description:
    'Portfolio tracking, market research, and investment analytics for the Moroccan market.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={editorialSerif.variable} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
