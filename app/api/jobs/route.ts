/**
 * Jobs API Endpoint
 * 
 * Returns all job postings from the RDF knowledge graph.
 */

import { NextResponse } from 'next/server'
import { rdfStore } from '../../../lib/rdf/store'

export async function GET() {
  try {
    // Initialize RDF store and load ontology files
    await rdfStore.initialize()
    
    // Query all job postings from RDF store
    const rdfJobs = rdfStore.getAllJobPostings()
    
    // Transform to API response format
    const jobs = rdfJobs.map(job => ({
      id: job.id,
      title: job.title,
      company: job.organization,
      location: job.location || 'Remote',
      skills: job.requiredSkills,
      description: job.description,
      url: job.url,
      datePosted: job.datePosted
    }))
    
    return NextResponse.json({ 
      jobs,
      count: jobs.length,
      source: 'RDF Knowledge Graph'
    })
  } catch (error) {
    console.error('Error reading jobs from RDF:', error)
    return NextResponse.json(
      { error: 'Failed to load jobs from knowledge graph' },
      { status: 500 }
    )
  }
}
