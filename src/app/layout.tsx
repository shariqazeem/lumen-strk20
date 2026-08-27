import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://lumen-strk20.vercel.app'),
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/icon-192.png', sizes: '192x192' }],
    apple: '/icon-180.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Lumen',
  },
  title: {
    default: 'Lumen — private money, by default',
    template: '%s · Lumen',
  },
  description:
    'Lumen is the private money app for Starknet. Pay, receive and save without publishing a financial profile — every relationship gets its own privacy boundary, and a silent engine keeps your history unlinkable.',
  keywords: ['Starknet', 'STRK20', 'private payments', 'privacy', 'money app'],
  authors: [{ name: 'Shariq Shaukat' }],
  openGraph: {
    title: 'Lumen — private money, by default',
    description:
      'Pay, receive and save on Starknet without publishing a financial profile. Private is the only easy path.',
    type: 'website',
    siteName: 'Lumen',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Lumen — your payments should not become a map of your life.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lumen — private money, by default',
    description:
      'Ordinary money movement should not create a public financial profile. Lumen makes the private path the only easy path.',
    images: ['/og.png'],
  },
}

export const viewport: Viewport = {
  themeColor: '#f3f2f0',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  )
}
