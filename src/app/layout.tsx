import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dinero | Wealth & Accounts Tracker',
  description: 'Track all your cash, credit cards, investments, 401ks, and HSAs under one roof.',
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
