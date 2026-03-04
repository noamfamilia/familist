import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/providers/AuthProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { InstallBanner } from '@/components/ui/InstallBanner'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://myfamilist.com'),
  title: 'MyFamiList',
  description: 'A collaborative shared lists application for families',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
  openGraph: {
    title: 'MyFamiList',
    description: 'A collaborative shared lists application for families',
    url: 'https://myfamilist.com',
    siteName: 'MyFamiList',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'MyFamiList - Shared lists for families',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MyFamiList',
    description: 'A collaborative shared lists application for families',
    images: ['/og-image.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'MyFamiList',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#2aa198',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <ToastProvider>
            <main className="min-h-screen flex items-center justify-center p-0 sm:p-5">
              {children}
            </main>
            <InstallBanner />
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
