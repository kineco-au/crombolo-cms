import { CromboloLiveReload } from '@crombolo/next-integration/client'
import type { ReactNode } from 'react'
import './globals.css'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <CromboloLiveReload />
      </body>
    </html>
  )
}
