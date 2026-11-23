import Link from 'next/link'

const REPO = 'https://github.com/asselsaken/SkillSync'

const steps = [
  {
    title: 'Read your skills',
    body: 'Your résumé is scanned for 220+ skills and their other spellings. Short or ambiguous names are matched carefully: "R" is not found inside "for", and "Go" only counts as the language.',
  },
  {
    title: 'Understand how skills relate',
    body: 'A knowledge graph (RDF/OWL) knows that PostgreSQL is a kind of SQL, that PyTorch and TensorFlow are close substitutes, and that "AWS, GCP or Azure" means any one cloud. Matches are credited accordingly.',
  },
  {
    title: 'Rank real openings and explain why',
    body: 'Thousands of current postings from company job boards are scored by how many of their requirements you cover. Every result shows which requirements you meet, how, and what is missing.',
  },
]

const facts = [
  'Jobs refresh daily from the public Greenhouse, Lever and Ashby job boards of 67 tech companies.',
  'The skill graph grows: new skills found in postings are proposed by Claude, checked by strict rules and SHACL validation, and reviewed in a pull request before they go live.',
  'Your résumé is processed in memory and never stored.',
]

export default function AboutPage() {
  return (
    <main className="min-h-screen p-6 md:p-12 max-w-4xl mx-auto">
      <header className="mb-10 md:hidden flex items-center gap-2">
        <div className="w-8 h-8 bg-zinc-900 dark:bg-white rounded-lg flex items-center justify-center">
          <span className="text-white dark:text-zinc-950 font-bold text-lg">S</span>
        </div>
        <span className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">SkillMatch</span>
      </header>

      <h1 className="text-4xl md:text-5xl font-bold mb-6 text-zinc-900 dark:text-white tracking-tighter leading-tight">
        Skills-first job matching, explained.
      </h1>
      <p className="text-xl text-zinc-600 dark:text-zinc-400 leading-relaxed mb-12">
        Keyword search misses people whose experience is described in different words, and floods them with roles
        that only share a buzzword. SkillMatch compares what you can do with what each job needs, using a graph of
        how skills relate, and shows its reasoning.
      </p>

      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">How it works</h2>
      <ol className="grid gap-4 md:grid-cols-3 mb-12">
        {steps.map((s, i) => (
          <li key={s.title} className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            <div className="text-sm font-bold text-zinc-400 mb-2">{i + 1}</div>
            <h3 className="font-semibold text-zinc-900 dark:text-white mb-2">{s.title}</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">{s.body}</p>
          </li>
        ))}
      </ol>

      <ul className="space-y-3 mb-12 text-zinc-700 dark:text-zinc-300">
        {facts.map((f) => (
          <li key={f} className="flex gap-3">
            <span className="text-emerald-600 mt-0.5" aria-hidden="true">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <div className="h-px bg-zinc-200 dark:bg-zinc-800 mb-8" />

      <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6">
        Built by Assel Sakenkyzy. It started as a final project for Info 290 at the UC Berkeley School of
        Information and grew into a working product. Built with Next.js, TypeScript, RDF/OWL, SHACL, SPARQL
        (Oxigraph) and Claude Code.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/" className="px-4 py-2 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-medium">
          Try it with your résumé
        </Link>
        <a href={REPO} target="_blank" rel="noopener noreferrer"
          className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 font-medium text-zinc-800 dark:text-zinc-200">
          Source code on GitHub
        </a>
      </div>
    </main>
  )
}
