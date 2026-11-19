'use client'

export default function AboutPage() {
  return (
    <main className="min-h-screen p-8 md:p-12 max-w-6xl mx-auto">
      <header className="mb-16 md:hidden flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-zinc-900 dark:bg-white rounded-lg flex items-center justify-center">
            <span className="text-white dark:text-zinc-950 font-bold text-lg">S</span>
          </div>
          <span className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">SkillMatch</span>
        </div>
      </header>

      <div className="max-w-3xl space-y-12">
        <div>
          <h1 className="text-4xl md:text-5xl font-bold mb-8 text-zinc-900 dark:text-white tracking-tighter leading-tight">
            Building a skills-first matching layer for the tech job market.
          </h1>
          <div className="text-xl text-zinc-600 dark:text-zinc-400 leading-relaxed space-y-8">
            <p>
              SkillMatch is building a skills-first matching layer for the tech job market. Instead of ranking people by keywords in their CVs, we normalize skills from both resumes and job postings into a shared semantic graph and match candidates based on what they can actually do.
            </p>
          </div>
        </div>

        <div className="h-px bg-zinc-200 dark:bg-zinc-800 w-full" />

        <div className="grid gap-8 text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed">
          <p>
            Born out of <strong className="text-zinc-900 dark:text-white font-semibold">UC Berkeley’s School of Information</strong>, SkillMatch combines research-grade semantics (ontologies, knowledge graphs, explainable AI) with very practical hiring problems faced by tech candidates and recruiters. Our goal is simple: turn noisy, generic job search into a precise, transparent skill-matching experience for both sides of the market.
          </p>
          
          <p>
            We are starting with data, AI, and software roles in the Bay Area and expanding from there, building the foundation for a global, skill-based talent infrastructure.
          </p>
        </div>
      </div>
    </main>
  )
}
