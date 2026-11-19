'use client'

import { useEffect, useState } from 'react'

interface Job {
  id: string
  title: string
  company: string
  location: string
  isRemote: boolean
  department?: string
  employmentType?: string
  salary?: string
  skills: string[]
  preferredSkills: string[]
  summary: string
  url?: string
  applyUrl?: string
  datePosted?: string
}

interface JobsResponse {
  jobs: Job[]
  total: number
  totalAll: number
  page: number
  totalPages: number
  companies: string[]
}

const SKILLS_SHOWN = 6

const selectClass =
  "px-3 pr-8 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600 min-w-[160px] appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px_12px] bg-[right_12px_center] bg-no-repeat"

function formatDate(iso?: string): string | null {
  if (!iso) return null
  const date = new Date(iso + 'T00:00:00')
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function JobsPage() {
  const [data, setData] = useState<JobsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [query, setQuery] = useState('')
  const [company, setCompany] = useState('')
  const [remoteOnly, setRemoteOnly] = useState(false)
  const [page, setPage] = useState(1)

  // Debounce typing so we don't query on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => setPage(1), [query, company, remoteOnly])

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (query) params.set('q', query)
    if (company) params.set('company', company)
    if (remoteOnly) params.set('remote', '1')

    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/jobs?${params}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json) => {
        if (json.error) throw new Error(json.error)
        setData(json)
        setError(null)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message || 'Failed to load jobs')
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [query, company, remoteOnly, page])

  const jobs = data?.jobs ?? []
  const totalPages = data?.totalPages ?? 1

  return (
    <main className="min-h-screen p-8 md:p-12 max-w-7xl mx-auto relative">
      <header className="mb-8 md:hidden flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-zinc-900 dark:bg-white rounded-lg flex items-center justify-center">
            <span className="text-white dark:text-zinc-950 font-bold text-lg">S</span>
          </div>
          <span className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">SkillMatch</span>
        </div>
      </header>

      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4 text-zinc-900 dark:text-white tracking-tight">All Jobs</h1>
        <p className="text-zinc-500 dark:text-zinc-400">
          {data
            ? `${data.totalAll.toLocaleString()} open technical roles from ${data.companies.length} companies, refreshed from their public job boards`
            : 'Loading open roles…'}
        </p>
      </div>

      {/* Sticky Filter Bar */}
      <div className="sticky top-0 z-40 bg-zinc-50/95 dark:bg-zinc-950/95 backdrop-blur-xl border-b border-zinc-200 dark:border-zinc-800 -mx-8 px-8 py-4 mb-8 shadow-sm">
        <div className="flex flex-col md:flex-row gap-4 max-w-7xl mx-auto md:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="search"
              placeholder="Search title, company, location or skill…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search jobs"
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 outline-none transition-all"
            />
            <svg className="w-4 h-4 absolute left-3 top-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <div className="flex gap-3 items-center flex-wrap">
            <select value={company} onChange={(e) => setCompany(e.target.value)} aria-label="Company" className={selectClass}>
              <option value="">All companies</option>
              {data?.companies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer select-none px-3 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
              <input
                type="checkbox"
                checked={remoteOnly}
                onChange={(e) => setRemoteOnly(e.target.checked)}
                className="accent-zinc-900 dark:accent-white"
              />
              Remote only
            </label>
          </div>
        </div>
        {data && (
          <p className="text-xs text-zinc-500 mt-3 max-w-7xl mx-auto">
            {data.total.toLocaleString()} {data.total === 1 ? 'job' : 'jobs'} match
          </p>
        )}
      </div>

      {/* Job List */}
      <div className="space-y-4" aria-busy={loading}>
        {error ? (
          <div className="text-center py-20 text-red-600 dark:text-red-400">{error}</div>
        ) : loading && !data ? (
          <div className="text-center py-20 text-zinc-400">Loading opportunities…</div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-20 text-zinc-400 bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
            No jobs found matching your criteria.
          </div>
        ) : (
          <>
            <div className={`grid gap-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              {jobs.map((job) => {
                const posted = formatDate(job.datePosted)
                const meta = [job.location, job.employmentType, posted && `Posted ${posted}`].filter(Boolean)
                return (
                  <article
                    key={job.id}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-xl hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex justify-between items-start gap-4 mb-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-zinc-900 dark:text-white">{job.title}</h3>
                        <p className="text-sm text-zinc-500 mt-1 font-medium">
                          <span className="text-zinc-800 dark:text-zinc-200">{job.company}</span>
                          {meta.length > 0 && <> • {meta.join(' • ')}</>}
                        </p>
                      </div>
                      {job.isRemote && (
                        <span className="shrink-0 px-2.5 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 rounded-full text-xs font-medium">
                          Remote
                        </span>
                      )}
                    </div>

                    {job.summary && (
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-4 line-clamp-3">{job.summary}</p>
                    )}
                    {job.salary && <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-4">💰 {job.salary}</p>}

                    <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                      <div className="flex flex-wrap gap-2 flex-1">
                        {job.skills.slice(0, SKILLS_SHOWN).map((skill) => (
                          <span
                            key={skill}
                            className="px-2.5 py-1 bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded-md text-xs font-medium"
                          >
                            {skill}
                          </span>
                        ))}
                        {job.skills.length > SKILLS_SHOWN && (
                          <span className="px-2.5 py-1 text-zinc-400 text-xs font-medium">+{job.skills.length - SKILLS_SHOWN}</span>
                        )}
                      </div>

                      {job.applyUrl && (
                        <a
                          href={job.applyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                          Apply
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>

            {totalPages > 1 && (
              <nav className="flex justify-center gap-2 mt-8 pb-8" aria-label="Pagination">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-zinc-900"
                >
                  Previous
                </button>
                <span className="px-4 py-2 text-sm text-zinc-500 flex items-center">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-zinc-900"
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </main>
  )
}
