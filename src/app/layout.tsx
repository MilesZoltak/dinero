import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dinero | Wealth & Accounts Tracker',
  description: 'Track all your cash, credit cards, investments, 401ks, and HSAs under one roof.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Dinero',
  },
};

export const viewport = {
  themeColor: '#0b0d10',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="bg-glow-1"></div>
        <div className="bg-glow-2"></div>
        {children}
      </body>
    </html>
  );
}
