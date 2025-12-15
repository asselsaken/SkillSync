'use client'

import { useEffect, useState, useMemo } from 'react'

interface Job {
  id: number
  title: string
  company: string
  location: string
  skills: string[]
  description: string
  url?: string
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTitle, setFilterTitle] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterCompany, setFilterCompany] = useState('')
  const [expandedJobs, setExpandedJobs] = useState<Set<number>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const jobsPerPage = 10

  useEffect(() => {
    fetch('/api/jobs')
      .then(res => res.json())
      .then(data => {
        setJobs(data.jobs || [])
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }, [])

  const filteredJobs = useMemo(() => {
    return jobs.filter(job => {
      const matchesSearch = !searchQuery || 
        job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.location.toLowerCase().includes(searchQuery.toLowerCase()) ||
        job.description.toLowerCase().includes(searchQuery.toLowerCase())
      
      const matchesTitle = !filterTitle || 
        job.title.toLowerCase() === filterTitle.toLowerCase()
      
      const matchesLocation = !filterLocation || 
        job.location.toLowerCase() === filterLocation.toLowerCase()
      
      const matchesCompany = !filterCompany || 
        job.company.toLowerCase() === filterCompany.toLowerCase()
      
      return matchesSearch && matchesTitle && matchesLocation && matchesCompany
    })
  }, [jobs, searchQuery, filterTitle, filterLocation, filterCompany])

  const uniqueTitles = useMemo(() => {
    return [...new Set(jobs.map(job => job.title))].sort()
  }, [jobs])

  const uniqueLocations = useMemo(() => {
    return [...new Set(jobs.map(job => job.location))].sort()
  }, [jobs])

  const uniqueCompanies = useMemo(() => {
    return [...new Set(jobs.map(job => job.company))].sort()
  }, [jobs])

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
    setExpandedJobs(new Set())
  }, [searchQuery, filterTitle, filterLocation, filterCompany])

  // Pagination
  const totalPages = Math.ceil(filteredJobs.length / jobsPerPage)
  const startIndex = (currentPage - 1) * jobsPerPage
  const endIndex = startIndex + jobsPerPage
  const paginatedJobs = filteredJobs.slice(startIndex, endIndex)

  const toggleExpand = (jobId: number) => {
    setExpandedJobs(prev => {
      const newSet = new Set(prev)
      if (newSet.has(jobId)) {
        newSet.delete(jobId)
      } else {
        newSet.add(jobId)
      }
      return newSet
    })
  }

  const isExpanded = (jobId: number) => expandedJobs.has(jobId)

  return (
    <main className="min-h-screen p-8 md:p-12 max-w-7xl mx-auto relative">
      <header className="mb-8 md:hidden flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-zinc-900 dark:bg-white rounded-lg flex items-center justify-center">
            <span className="text-white dark:text-zinc-950 font-bold text-lg">S</span>
          </div>
          <span className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">SkillSync</span>
        </div>
      </header>

      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4 text-zinc-900 dark:text-white tracking-tight">
          All Jobs
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400">
          Browse through {jobs.length} available positions
        </p>
      </div>

      {/* Sticky Filter Bar */}
      <div className="sticky top-0 z-40 bg-zinc-50/95 dark:bg-zinc-950/95 backdrop-blur-xl border-b border-zinc-200 dark:border-zinc-800 -mx-8 px-8 py-4 mb-8 shadow-sm">
        <div className="flex flex-col md:flex-row gap-4 max-w-7xl mx-auto">
          <div className="relative flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 outline-none transition-all"
            />
            <svg className="w-4 h-4 absolute left-3 top-3 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <div className="flex gap-3 overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
            <select
              value={filterTitle}
              onChange={(e) => setFilterTitle(e.target.value)}
              className="px-3 pr-8 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600 min-w-[140px] appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px_12px] bg-[right_12px_center] bg-no-repeat"
            >
              <option value="">All Titles</option>
              {uniqueTitles.map(title => (
                <option key={title} value={title}>{title}</option>
              ))}
            </select>
            
            <select
              value={filterLocation}
              onChange={(e) => setFilterLocation(e.target.value)}
              className="px-3 pr-8 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600 min-w-[140px] appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px_12px] bg-[right_12px_center] bg-no-repeat"
            >
              <option value="">All Locations</option>
              {uniqueLocations.map(location => (
                <option key={location} value={location}>{location}</option>
              ))}
            </select>

            <select
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              className="px-3 pr-8 py-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm outline-none focus:border-zinc-400 dark:focus:border-zinc-600 min-w-[140px] appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%236b7280%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')] bg-[length:12px_12px] bg-[right_12px_center] bg-no-repeat"
            >
              <option value="">All Companies</option>
              {uniqueCompanies.map(company => (
                <option key={company} value={company}>{company}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Job List */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-20 text-zinc-400">
            Loading opportunities...
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-20 text-zinc-400 bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
            No jobs found matching your criteria.
          </div>
        ) : (
          <>
            <div className="grid gap-4">
              {paginatedJobs.map((job) => {
                const expanded = isExpanded(job.id)
                return (
                  <div
                    key={job.id}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-xl hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors group"
                  >
                    <div className="flex justify-between items-start gap-4 mb-3">
                      <div>
                        <h3 className="text-lg font-bold text-zinc-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {job.title}
                        </h3>
                        <p className="text-sm text-zinc-500 mt-1 font-medium">
                          {job.company} • {job.location}
                        </p>
                      </div>
                    </div>

                    <div className={`text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed mb-4 whitespace-pre-wrap ${expanded ? '' : 'line-clamp-3'}`}>
                      {job.description}
                    </div>
                    
                    <button
                      onClick={() => toggleExpand(job.id)}
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline mb-4 block"
                    >
                      {expanded ? 'Show Less' : 'Read More'}
                    </button>

                    <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                      <div className="flex flex-wrap gap-2 flex-1">
                        {job.skills.slice(0, 5).map((skill, idx) => (
                          <span
                            key={idx}
                            className="px-2.5 py-1 bg-zinc-50 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 rounded-md text-xs font-medium"
                          >
                            {skill}
                          </span>
                        ))}
                        {job.skills.length > 5 && (
                          <span className="px-2.5 py-1 text-zinc-400 text-xs font-medium">
                            +{job.skills.length - 5}
                          </span>
                        )}
                      </div>

                      {job.url && (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                        >
                          Apply Now
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-8 pb-8">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-zinc-900"
                >
                  Previous
                </button>
                <span className="px-4 py-2 text-sm text-zinc-500 flex items-center">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-zinc-900"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
