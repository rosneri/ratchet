import './globals.css'
import type { ReactNode } from 'react'
import { root } from '../lib/data.ts'

export const metadata = {
  title: 'Ratchet',
  description: 'Every defect becomes a deterministic check.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="masthead">
            <a href="/" className="wordmark">
              ratchet<span>.</span>
            </a>
            <span className="tagline">
              One agent works. Another scrutinises. Every real defect becomes a deterministic check.
            </span>
            <nav>
              <a href="/">checks</a>
              <a href="/runs">runs</a>
            </nav>
            <span className="rootpath">{root()}</span>
          </header>
          {children}
        </div>
      </body>
    </html>
  )
}
