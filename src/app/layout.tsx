import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ProfitCosmos Omega',
  description: 'Student acquisition system for ProfitCosmos Omega Academy',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
