/**
 * SPARQL Query API Endpoint
 * 
 * Provides access to the RDF knowledge graph through SPARQL-like queries
 */

import { NextRequest, NextResponse } from 'next/server'
import { sparqlEngine, SPARQL_QUERIES } from '../../../lib/rdf/sparql'
import { semanticMatcher } from '../../../lib/rdf/semantic-matcher'
import { SPARQL_PREFIXES } from '../../../lib/rdf/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type QueryType = 'skills' | 'jobs' | 'related-skills' | 'jobs-by-skill' | 'skill-hierarchy' | 'match' | 'stats'

/**
 * GET /api/sparql
 * 
 * Query the RDF knowledge graph
 * 
 * Query parameters:
 * - type: Query type (skills, jobs, related-skills, jobs-by-skill, skill-hierarchy, match, stats)
 * - skill: Skill name (for related-skills and jobs-by-skill queries)
 * - skills: Comma-separated skill IDs (for match query)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const queryType = searchParams.get('type') as QueryType
    const skillParam = searchParams.get('skill')
    const skillsParam = searchParams.get('skills')

    switch (queryType) {
      case 'skills': {
        // Get all skills with their relationships
        const skills = await sparqlEngine.queryAllSkills()
        return NextResponse.json({
          query: 'ALL_SKILLS',
          sparql: SPARQL_QUERIES.ALL_SKILLS,
          count: skills.length,
          results: skills
        })
      }

      case 'jobs': {
        // Get all job postings
        const jobs = await sparqlEngine.queryAllJobs()
        return NextResponse.json({
          query: 'ALL_JOBS',
          sparql: SPARQL_QUERIES.ALL_JOBS,
          count: jobs.length,
          results: jobs
        })
      }

      case 'related-skills': {
        // Find skills related to a given skill
        if (!skillParam) {
          return NextResponse.json(
            { error: 'Missing skill parameter' },
            { status: 400 }
          )
        }
        const related = await sparqlEngine.queryRelatedSkills(skillParam)
        return NextResponse.json({
          query: 'SIMILAR_SKILLS',
          sparql: SPARQL_QUERIES.SIMILAR_SKILLS,
          skill: skillParam,
          results: related
        })
      }

      case 'jobs-by-skill': {
        // Find jobs requiring a specific skill
        if (!skillParam) {
          return NextResponse.json(
            { error: 'Missing skill parameter' },
            { status: 400 }
          )
        }
        const jobsBySkill = await sparqlEngine.queryJobsBySkill(skillParam)
        return NextResponse.json({
          query: 'JOBS_BY_SKILL',
          sparql: SPARQL_QUERIES.JOBS_BY_SKILL,
          skill: skillParam,
          count: jobsBySkill.length,
          results: jobsBySkill
        })
      }

      case 'skill-hierarchy': {
        // Get skill hierarchy for visualization
        const hierarchy = await sparqlEngine.querySkillHierarchy()
        return NextResponse.json({
          query: 'SKILL_HIERARCHY',
          sparql: SPARQL_QUERIES.SKILL_HIERARCHY,
          count: hierarchy.length,
          results: hierarchy
        })
      }

      case 'match': {
        // Match skills to jobs
        if (!skillsParam) {
          return NextResponse.json(
            { error: 'Missing skills parameter (comma-separated skill IDs)' },
            { status: 400 }
          )
        }
        const skillIds = skillsParam.split(',').map(s => s.trim())
        const matches = await sparqlEngine.matchPersonToJobs(skillIds)
        return NextResponse.json({
          query: 'MATCH_PERSON_TO_JOBS',
          sparql: SPARQL_QUERIES.MATCH_PERSON_TO_JOBS,
          inputSkills: skillIds,
          count: matches.length,
          results: matches.slice(0, 10) // Top 10 matches
        })
      }

      case 'stats': {
        // Get ontology statistics
        const stats = await semanticMatcher.getOntologyStats()
        return NextResponse.json({
          query: 'ONTOLOGY_STATS',
          results: stats
        })
      }

      default:
        return NextResponse.json({
          error: 'Invalid query type',
          availableTypes: ['skills', 'jobs', 'related-skills', 'jobs-by-skill', 'skill-hierarchy', 'match', 'stats'],
          examples: [
            '/api/sparql?type=skills',
            '/api/sparql?type=jobs',
            '/api/sparql?type=related-skills&skill=python',
            '/api/sparql?type=jobs-by-skill&skill=machine-learning',
            '/api/sparql?type=skill-hierarchy',
            '/api/sparql?type=match&skills=python,sql,pandas',
            '/api/sparql?type=stats',
          ]
        }, { status: 400 })
    }
  } catch (error) {
    console.error('SPARQL query error:', error)
    return NextResponse.json(
      { error: 'Query execution failed' },
      { status: 500 }
    )
  }
}

const UPDATE_KEYWORDS = /\b(INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|ADD|MOVE|COPY)\b/i
const MAX_QUERY_LENGTH = 5000

/**
 * POST /api/sparql
 *
 * Body options:
 * - { "sparql": "SELECT ..." }  run a raw read-only SPARQL query
 * - { "query": "ALL_SKILLS" }   run a named query
 */
export async function POST(request: NextRequest) {
  try {
    const { query, sparql } = await request.json()

    if (typeof sparql === 'string') {
      if (sparql.length > MAX_QUERY_LENGTH) {
        return NextResponse.json({ error: 'Query too long' }, { status: 400 })
      }
      if (UPDATE_KEYWORDS.test(sparql.replace(/"[^"]*"|'[^']*'/g, ''))) {
        return NextResponse.json({ error: 'Only read-only queries (SELECT, ASK, CONSTRUCT, DESCRIBE) are allowed' }, { status: 400 })
      }
      try {
        const results = await sparqlEngine.executeSPARQL(SPARQL_PREFIXES + sparql)
        return NextResponse.json({ sparql, count: results.length, results })
      } catch (error) {
        return NextResponse.json({ error: `Invalid SPARQL: ${(error as Error).message}` }, { status: 400 })
      }
    }

    if (!query) {
      return NextResponse.json(
        { error: 'Missing "sparql" or "query" in request body' },
        { status: 400 }
      )
    }

    // For now, we only support predefined queries
    // Custom SPARQL would require a full SPARQL parser
    const queryName = query.toUpperCase().replace(/-/g, '_')
    
    if (queryName in SPARQL_QUERIES) {
      const sparqlText = SPARQL_QUERIES[queryName as keyof typeof SPARQL_QUERIES]
      
      // Execute based on query type
      let results
      switch (queryName) {
        case 'ALL_SKILLS':
          results = await sparqlEngine.queryAllSkills()
          break
        case 'ALL_JOBS':
          results = await sparqlEngine.queryAllJobs()
          break
        case 'SKILL_HIERARCHY':
          results = await sparqlEngine.querySkillHierarchy()
          break
        default:
          return NextResponse.json(
            { error: 'Query not supported for POST execution' },
            { status: 400 }
          )
      }

      return NextResponse.json({
        query: queryName,
        sparql: sparqlText,
        count: Array.isArray(results) ? results.length : 1,
        results
      })
    }

    return NextResponse.json(
      { 
        error: 'Unknown query',
        availableQueries: Object.keys(SPARQL_QUERIES)
      },
      { status: 400 }
    )
  } catch (error) {
    console.error('SPARQL POST error:', error)
    return NextResponse.json(
      { error: 'Query execution failed' },
      { status: 500 }
    )
  }
}

