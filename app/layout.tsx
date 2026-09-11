import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'] });
const siteUrl = process.env.SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'https://sonic-linz.clear-guppy-9870.chatgpt.site');

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Sonic Linz — The city speaks in music',
  description: 'Hear Linz street history transmitted as music and decoded through sound.',
  openGraph: {
    title: 'SONIC LINZ',
    description: 'The city speaks in music.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'SONIC LINZ — The city speaks in music' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SONIC LINZ',
    description: 'The city speaks in music.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
