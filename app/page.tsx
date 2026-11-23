'use client'

import { useEffect, useMemo, useState } from 'react'

interface SkillMatchDetail {
  personSkillName: string
  jobSkillName: string
  matchType: 'exact' | 'equivalent' | 'narrower' | 'broader' | 'similar'
  weight: number
}

interface Match {
  id: string
  title: string
  company: string
  location: string
  isRemote?: boolean
  skills: string[]
  summary?: string
  url?: string
  applyUrl?: string
  matchScore: number
  matchedSkills: SkillMatchDetail[]
  missingSkills: string[]
  otherLocations?: string[]
}

interface MatchResponse {
  matches: Match[]
  skillGaps?: { skill: string; jobs: number }[]
  extractedSkills: string[]
  message?: string
  error?: string
}

interface Stats {
  totalJobs: number
  totalSkills: number
  totalOrganizations: number
}

const SAMPLES = [
  { id: 'data-engineer', label: 'Data engineer' },
  { id: 'backend-engineer', label: 'Backend engineer' },
  { id: 'ml-engineer', label: 'ML engineer' },
]
const MAX_BYTES = 5 * 1024 * 1024
const PAGE_SIZE = 10

const MATCH_TYPES: Record<SkillMatchDetail['matchType'], { label: string; className: string }> = {
  exact: { label: 'Exact', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  equivalent: { label: 'Same skill', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  narrower: { label: 'Yours is more specific', className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  similar: { label: 'Related', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  broader: { label: 'Yours is more general', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
}

function scoreStyle(score: number) {
  if (score >= 80) return { bar: 'bg-emerald-500', label: 'Strong match' }
  if (score >= 65) return { bar: 'bg-blue-500', label: 'Good match' }
  return { bar: 'bg-amber-500', label: 'Partial match' }
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<MatchResponse | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [shown, setShown] = useState(PAGE_SIZE)

  // Graph stats for the intro (also warms up the server)
  useEffect(() => {
    fetch('/api/sparql?type=stats')
      .then((r) => r.json())
      .then((j) => j.results && setStats(j.results))
      .catch(() => {})
  }, [])

  const choose = (f: File | undefined) => {
    if (!f) return
    if (f.type !== 'application/pdf') return setError('Please choose a PDF file.')
    if (f.size > MAX_BYTES) return setError('That file is larger than 5 MB.')
    setError('')
    setFile(f)
    setData(null)
  }

  const match = async (f: File) => {
    setLoading(true)
    setError('')
    setData(null)
    setShown(PAGE_SIZE)
    try {
      const form = new FormData()
      form.append('file', f)
      const res = await fetch('/api/match', { method: 'POST', body: form })
      const json: MatchResponse = await res.json().catch(() => ({ error: 'Unexpected server response' }) as MatchResponse)
      if (!res.ok) throw new Error(json.error || 'Matching failed')
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Matching failed')
    } finally {
      setLoading(false)
    }
  }

  const trySample = async (id: string, label: string) => {
    const res = await fetch(`/samples/${id}.pdf`)
    const blob = await res.blob()
    const sample = new File([blob], `Sample résumé – ${label}.pdf`, { type: 'application/pdf' })
    setFile(sample)
    await match(sample)
  }

  const visible = useMemo(
    () => (data?.matches ?? []).filter((m) => !remoteOnly || m.isRemote),
    [data, remoteOnly],
  )

  return (
    <main className="min-h-screen p-6 md:p-12 max-w-5xl mx-auto">
      <header className="mb-10 md:hidden flex items-center gap-2">
        <div className="w-8 h-8 bg-zinc-900 dark:bg-white rounded-lg flex items-center justify-center">
          <span className="text-white dark:text-zinc-950 font-bold text-lg">S</span>
        </div>
        <span className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">SkillMatch</span>
      </header>

      {/* Intro */}
      <section className="max-w-3xl mb-10">
        <h1 className="text-4xl md:text-6xl font-bold tracking-tighter mb-5 text-zinc-900 dark:text-white">
          Find jobs that fit
          <br />
          what you can do.
        </h1>
        <p className="text-lg md:text-xl text-zinc-500 dark:text-zinc-400 leading-relaxed">
          Upload your résumé and see which of
          {stats ? ` ${stats.totalJobs.toLocaleString()} open tech jobs from ${stats.totalOrganizations} companies` : ' today\'s open tech jobs'}
          {' '}fit you best, and why. Related skills count too: PostgreSQL counts as SQL.
        </p>
      </section>

      {/* Upload */}
      <section className="max-w-3xl mb-14">
        <label
          htmlFor="file-upload"
          className={`group block w-full py-12 px-6 border-2 border-dashed rounded-2xl text-center cursor-pointer transition-colors ${
            file ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900' : 'border-zinc-300 dark:border-zinc-700 hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900'
          } ${loading ? 'opacity-60 cursor-wait' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            if (!loading) choose(e.dataTransfer.files[0])
          }}
        >
          <input id="file-upload" type="file" accept="application/pdf,.pdf" className="sr-only" disabled={loading}
            onChange={(e) => choose(e.target.files?.[0])} />
          <svg className="w-10 h-10 mx-auto mb-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          {file ? (
            <>
              <div className="text-lg font-semibold text-zinc-900 dark:text-white break-all">{file.name}</div>
              <div className="text-sm text-zinc-500">Click to choose another file</div>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold text-zinc-900 dark:text-white">Drop your résumé here, or click to choose</div>
              <div className="text-sm text-zinc-500">PDF, up to 5 MB</div>
            </>
          )}
        </label>

        <button
          type="button"
          onClick={() => file && match(file)}
          disabled={loading || !file}
          className="mt-4 w-full py-4 rounded-xl text-lg font-semibold transition-colors bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600 disabled:cursor-not-allowed"
        >
          {loading ? 'Matching…' : 'Find my matches'}
        </button>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">No résumé handy? Try a sample:</span>
          {SAMPLES.map((s) => (
            <button key={s.id} type="button" disabled={loading} onClick={() => trySample(s.id, s.label)}
              className="px-3 py-1.5 rounded-full border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50">
              {s.label}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs text-zinc-500 flex items-center gap-1.5">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          Your résumé is read in memory to find skills and is never stored.
        </p>

        {error && (
          <div role="alert" className="mt-4 p-4 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}
      </section>

      {data && <Results data={data} visible={visible} shown={shown} setShown={setShown} remoteOnly={remoteOnly} setRemoteOnly={setRemoteOnly} />}
    </main>
  )
}

function Results(props: {
  data: MatchResponse
  visible: Match[]
  shown: number
  setShown: (n: number) => void
  remoteOnly: boolean
  setRemoteOnly: (v: boolean) => void
}) {
  const { data, visible, shown, setShown, remoteOnly, setRemoteOnly } = props

  return (
    <section className="space-y-8">
      {/* Skills found */}
      <div className="p-6 bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-3">
          Skills we found ({data.extractedSkills.length})
        </h2>
        <div className="flex flex-wrap gap-2">
          {data.extractedSkills.map((s) => (
            <span key={s} className="px-3 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* What to learn next */}
      {data.skillGaps && data.skillGaps.length > 0 && data.matches.length > 0 && (
        <div className="p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-1">Skills to learn next</h2>
          <p className="text-sm text-zinc-500 mb-4">The requirements you&apos;re missing most often in your top {data.matches.length} matches.</p>
          <ul className="space-y-2">
            {data.skillGaps.map((g) => (
              <li key={g.skill} className="flex items-center gap-3 text-sm">
                <span className="w-44 shrink-0 font-medium text-zinc-800 dark:text-zinc-200 truncate" title={g.skill}>{g.skill}</span>
                <span className="flex-1 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <span className="block h-full bg-zinc-800 dark:bg-zinc-300 rounded-full" style={{ width: `${(g.jobs / data.matches.length) * 100}%` }} />
                </span>
                <span className="w-24 shrink-0 text-right text-zinc-500">{g.jobs} {g.jobs === 1 ? 'job' : 'jobs'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Matches */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
          {data.matches.length === 0 ? 'No strong matches yet' : `Your top ${visible.length} matches`}
        </h2>
        {data.matches.length > 0 && (
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
            <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} className="accent-zinc-900 dark:accent-white" />
            Remote only
          </label>
        )}
      </div>

      {data.matches.length === 0 && (
        <p className="text-zinc-500">
          {data.message ?? 'None of the current openings cover at least half of your skills profile.'} Try adding the tools and
          languages you use to your résumé, or browse all roles on the Jobs page.
        </p>
      )}

      <div className="grid gap-5">
        {visible.slice(0, shown).map((job, i) => (
          <MatchCard key={job.id} job={job} rank={i + 1} />
        ))}
      </div>

      {visible.length > shown && (
        <button type="button" onClick={() => setShown(shown + PAGE_SIZE)}
          className="w-full py-3 rounded-xl border border-zinc-300 dark:border-zinc-700 font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900">
          Show more ({visible.length - shown} left)
        </button>
      )}
    </section>
  )
}

function MatchCard({ job, rank }: { job: Match; rank: number }) {
  const total = job.matchedSkills.length + job.missingSkills.length
  const style = scoreStyle(job.matchScore)
  const href = job.applyUrl || job.url

  return (
    <article className="p-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-bold text-zinc-400">#{rank}</span>
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white">{job.title}</h3>
          </div>
          <p className="text-zinc-500 font-medium mt-1">
            {job.company} • {job.location}
            {job.otherLocations && job.otherLocations.length > 0 && (
              <span title={job.otherLocations.join(' · ')}> +{job.otherLocations.length} more {job.otherLocations.length === 1 ? 'location' : 'locations'}</span>
            )}
            {job.isRemote && (
              <span className="ml-2 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-full text-xs">Remote</span>
            )}
          </p>
        </div>
        <div className="sm:text-right shrink-0">
          <div className="flex sm:justify-end items-center gap-3">
            <div className="w-24 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div className={`h-full ${style.bar}`} style={{ width: `${job.matchScore}%` }} />
            </div>
            <span className="text-lg font-bold text-zinc-900 dark:text-white">{job.matchScore}%</span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            {style.label} · meets {job.matchedSkills.length} of {total} requirements
          </p>
        </div>
      </div>

      {job.summary && <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-4 line-clamp-3">{job.summary}</p>}

      <ul className="space-y-1.5 mb-4" aria-label="Requirements">
        {job.matchedSkills.map((m) => {
          const t = MATCH_TYPES[m.matchType]
          const same = m.personSkillName === m.jobSkillName || m.jobSkillName.split(' / ').includes(m.personSkillName)
          return (
            <li key={m.jobSkillName} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-emerald-600" aria-hidden="true">✓</span>
                <span className="text-zinc-800 dark:text-zinc-200 truncate">
                  {m.jobSkillName}
                  {!same && <span className="text-zinc-500"> ← your {m.personSkillName}</span>}
                </span>
              </span>
              <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${t.className}`}>{t.label}</span>
            </li>
          )
        })}
        {job.missingSkills.map((s) => (
          <li key={s} className="flex items-center gap-2 text-sm">
            <span className="text-red-500" aria-hidden="true">✗</span>
            <span className="text-zinc-500">{s}</span>
            <span className="sr-only">(missing)</span>
          </li>
        ))}
      </ul>

      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400">
          Apply at {job.company}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </a>
      )}
    </article>
  )
}
