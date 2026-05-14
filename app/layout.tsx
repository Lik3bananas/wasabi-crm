import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wasabi CRM',
  description: 'CRM de clientes Wasabi',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="h-full bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  )
}
