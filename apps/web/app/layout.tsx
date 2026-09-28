import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'SocialOS', template: '%s · SocialOS' },
  description: 'Plan, schedule and publish social media for every brand from one place.',
  icons: {
    icon: [{ url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' }],
    apple: '/brand/apple-touch-icon.png',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
