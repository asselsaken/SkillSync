/**
 * Jobs API Endpoint
 *
 * Returns all job postings from the RDF knowledge graph.
 */

import { NextResponse } from 'next/server'
import { getGraphStore } from '../../../lib/rdf/graph-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const store = await getGraphStore()
    const [rdfJobs, skills] = await Promise.all([store.getAllJobPostings(), store.getAllSkills()])
    const skillNames = new Map(skills.map((s) => [s.id, s.name]))

    const jobs = rdfJobs.map((job) => ({
      id: job.id,
      title: job.title,
      company: job.organization,
      location: job.location || 'Remote',
      skills: job.requiredSkills.map((id) => skillNames.get(id) ?? id),
      description: job.description,
      url: job.url,
      datePosted: job.datePosted,
    }))

    return NextResponse.json({ jobs, count: jobs.length, source: 'RDF Knowledge Graph', backend: store.backend })
  } catch (error) {
    console.error('Error reading jobs from RDF:', error)
    return NextResponse.json({ error: 'Failed to load jobs from knowledge graph' }, { status: 500 })
  }
}
