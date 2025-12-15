import './globals.css'
import type { Metadata } from 'next'
import Sidebar from './components/Sidebar'

export const metadata: Metadata = {
  title: 'SkillSync - Match Your Skills',
  description: 'Find the perfect job match based on your skills',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 min-h-screen flex">
        <Sidebar />
        <div className="flex-1 md:pl-64 transition-all duration-300">
          {children}
        </div>
      </body>
    </html>
  )
}
