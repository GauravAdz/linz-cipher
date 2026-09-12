import type { Metadata, Viewport } from 'next';
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
  title: 'LinzSings — Listen to the city',
  description: 'Linz city has something to sing to you. Hold your phone near the music and listen.',
  openGraph: {
    title: 'LinzSings — Listen to the city',
    description: 'Linz city has something to sing to you.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'LinzSings — Listen to the city' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'LinzSings — Listen to the city',
    description: 'Linz city has something to sing to you.',
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#050b14',
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
