import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/providers/AuthProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { StartupPerfCapture } from '@/components/dev/StartupPerfCapture'
import { InstallBanner } from '@/components/ui/InstallBanner'
import { ConnectivityProvider } from '@/providers/ConnectivityProvider'
import { SyncStatusProvider } from '@/providers/SyncStatusProvider'
import { DiagnosticsMessageBoxProvider } from '@/providers/DiagnosticsMessageBox'
import { SyncStoreBridge } from '@/components/sync/SyncStoreBridge'
import { AppLayoutGateLogger } from '@/components/dev/AppLayoutGateLogger'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://myfamilist.com'),
  title: 'MyFamiList',
  description: 'Shared list application for family and friends',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
  openGraph: {
    title: 'MyFamiList',
    description: 'Shared list application for family and friends',
    url: 'https://myfamilist.com',
    siteName: 'MyFamiList',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'MyFamiList - Shared lists for family and friends',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MyFamiList',
    description: 'Shared list application for family and friends',
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
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider>
          <AuthProvider>
            <ToastProvider>
              <DiagnosticsMessageBoxProvider>
                <ConnectivityProvider>
                  <SyncStatusProvider>
                    <SyncStoreBridge />
                    <AppLayoutGateLogger />
                    <StartupPerfCapture />
                    <main className="min-h-screen flex items-start justify-start sm:items-start sm:justify-center p-0 sm:p-5">
                      {children}
                    </main>
                    <InstallBanner />
                  </SyncStatusProvider>
                </ConnectivityProvider>
              </DiagnosticsMessageBoxProvider>
            </ToastProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
