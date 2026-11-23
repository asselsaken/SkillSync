import './globals.css'
import type { Metadata } from 'next'
import Sidebar from './components/Sidebar'

export const metadata: Metadata = {
  title: 'SkillMatch: skills-first job matching',
  description:
    'Upload your résumé and get real tech job openings ranked by how well your skills cover them, with the reasons. Powered by a self-growing skill knowledge graph.',
  openGraph: {
    title: 'SkillMatch: skills-first job matching',
    description: 'Real job openings ranked by how well your skills cover them, with the reasons.',
    type: 'website',
  },
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
