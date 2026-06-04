import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '声メモ2',
  description: '思いついたことを即座に音声で記録',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50">{children}</body>
    </html>
  )
}
