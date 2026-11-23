/**
 * Jobs API Endpoint
 *
 * GET /api/jobs?q=&company=&remote=1&page=1&pageSize=20
 * Returns one page of job postings from the knowledge graph, newest first,
 * plus the list of companies for filtering.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getGraphStore } from '../../../lib/rdf/graph-store'
import { generateSummary, requirementLabels } from '../../../lib/rdf/semantic-matcher'

export const runtime = 'nodejs'
// Allow for a cold start (loading the graph) on serverless hosts
export const maxDuration = 30
export const dynamic = 'force-dynamic'

const MAX_PAGE_SIZE = 50

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const q = (params.get('q') ?? '').trim().toLowerCase()
    const company = params.get('company') ?? ''
    const remoteOnly = params.get('remote') === '1'
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(params.get('pageSize')) || 20))
    const page = Math.max(1, Number(params.get('page')) || 1)

    const store = await getGraphStore()
    const [allJobs, skills] = await Promise.all([store.getAllJobPostings(), store.getAllSkills()])
    const skillNames = new Map(skills.map((s) => [s.id, s.name]))
    const namesOf = (ids: string[]) => ids.map((id) => skillNames.get(id) ?? id)

    const filtered = allJobs
      .filter((job) => {
        if (company && job.organization !== company) return false
        if (remoteOnly && !job.isRemote) return false
        if (!q) return true
        return (
          job.title.toLowerCase().includes(q) ||
          job.organization.toLowerCase().includes(q) ||
          (job.location ?? '').toLowerCase().includes(q) ||
          requirementLabels(job, skillNames).some((s) => s.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => (b.datePosted ?? '').localeCompare(a.datePosted ?? '') || a.title.localeCompare(b.title))

    const companies = [...new Set(allJobs.map((j) => j.organization))].sort((a, b) => a.localeCompare(b))
    const start = (page - 1) * pageSize

    const jobs = filtered.slice(start, start + pageSize).map((job) => ({
      id: job.id,
      title: job.title,
      company: job.organization,
      location: job.location || (job.isRemote ? 'Remote' : 'Not specified'),
      isRemote: job.isRemote ?? false,
      department: job.department,
      employmentType: job.employmentType,
      salary: job.salary,
      skills: requirementLabels(job, skillNames),
      preferredSkills: namesOf(job.preferredSkills),
      summary: generateSummary(job.description, 300),
      url: job.url,
      applyUrl: job.applyUrl ?? job.url,
      datePosted: job.datePosted,
    }))

    return NextResponse.json({
      jobs,
      total: filtered.length,
      totalAll: allJobs.length,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      companies,
      backend: store.backend,
    })
  } catch (error) {
    console.error('Error reading jobs from RDF:', error)
    return NextResponse.json({ error: 'Failed to load jobs from knowledge graph' }, { status: 500 })
  }
}
