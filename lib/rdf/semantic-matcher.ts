/**
 * Semantic Matcher
 * 
 * Uses RDF/OWL reasoning to match candidates with jobs based on skill ontology.
 * Applies semantic rules for skill equivalence, hierarchy, and similarity.
 */

import { neo4jStore } from './neo4j-store'
import { 
  PREFIXES, 
  RDFJobPosting,
  SkillMatchDetail,
  MATCH_TYPE_WEIGHTS,
} from './types'

interface MatchedJob {
  id: string
  title: string
  company: string
  location: string
  skills: string[]
  description: string
  url?: string
  matchScore: number
  summary: string
  reasons: string[]
  matchedSkills: SkillMatchDetail[]
}

class SemanticMatcher {
  private initialized = false
  private readonly matchWeights: Record<string, number> = {
    exact: 1.0,
    equivalent: 1.0,
    narrower: 0.85,
    broader: 0.5,
    similar: 0.6,
  }

  /**
   * Initialize the RDF store (Neo4j required)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    
    const neo4jUri = process.env.NEO4J_URI
    if (!neo4jUri) {
      throw new Error('NEO4J_URI is not set. Neo4j is required (fallback disabled).')
    }

    await neo4jStore.initialize()
    this.initialized = true
    console.log('Using Neo4j store with SPARQL queries (fallback disabled)')
  }

  /**
   * Extract and normalize skills from resume text
   */
  async extractSkillsFromText(text: string): Promise<string[]> {
    await this.initialize()
    
    const skills = await neo4jStore.getAllSkills()
    
    const foundSkills: Set<string> = new Set()
    const normalizedText = text.toLowerCase()

    const containsWholeTerm = (term: string) => {
      if (!term) return false
      const escaped = term.toLowerCase().replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
      // Allow +/#/. within a token (for C++, C#, Node.js) but require non-token boundaries around it
      const pattern = new RegExp(`(^|[^a-z0-9+.#/])${escaped}($|[^a-z0-9+.#/])`, 'i')
      return pattern.test(normalizedText)
    }

    for (const skill of skills) {
      // Check main skill name
      if (containsWholeTerm(skill.name)) {
        foundSkills.add(skill.id)
        continue
      }

      // Check aliases
      for (const alias of skill.aliases) {
        if (containsWholeTerm(alias)) {
          foundSkills.add(skill.id)
          break
        }
      }
    }

    return Array.from(foundSkills)
  }

  /**
   * Find the best match type between a person skill and job skill
   */
  private async findMatchType(personSkillId: string, jobSkillId: string): Promise<SkillMatchDetail | null> {
    const relation = await neo4jStore.areSkillsRelated(personSkillId, jobSkillId)
    
    if (!relation.related) return null

    const personSkill = await neo4jStore.getSkill(personSkillId)
    const jobSkill = await neo4jStore.getSkill(jobSkillId)

    if (!personSkill || !jobSkill) return null

    return {
      personSkillUri: PREFIXES.skill + personSkillId,
      personSkillName: personSkill.name,
      jobSkillUri: PREFIXES.skill + jobSkillId,
      jobSkillName: jobSkill.name,
      matchType: relation.type as SkillMatchDetail['matchType'],
      weight: relation.weight,
    }
  }

  /**
   * Match resume skills against a job's required skills
   */
  async matchSkillsToJob(personSkillIds: string[], jobRequiredSkillIds: string[]): Promise<{
    matchedSkills: SkillMatchDetail[]
    coverageScore: number
    reasons: string[]
  }> {
    const matchedSkills: SkillMatchDetail[] = []
    const matchedJobSkills = new Set<string>()

    // For each person skill, find the best match among job skills
    for (const personSkillId of personSkillIds) {
      let bestMatch: SkillMatchDetail | null = null
      let bestWeight = 0

      for (const jobSkillId of jobRequiredSkillIds) {
        if (matchedJobSkills.has(jobSkillId)) continue

        const match = await this.findMatchType(personSkillId, jobSkillId)
        if (match && match.weight > bestWeight) {
          bestMatch = match
          bestWeight = match.weight
        }
      }

      if (bestMatch) {
        matchedSkills.push(bestMatch)
        matchedJobSkills.add(bestMatch.jobSkillUri.replace(PREFIXES.skill, ''))
      }
    }

    // Calculate coverage score
    const totalRequired = jobRequiredSkillIds.length
    const weightedSum = matchedSkills.reduce((sum, m) => sum + m.weight, 0)
    const coverageScore = totalRequired > 0 
      ? Math.min(100, Math.round((weightedSum / totalRequired) * 100))
      : 0

    // Generate reasons
    const reasons = this.generateReasons(matchedSkills)

    return { matchedSkills, coverageScore, reasons }
  }

  /**
   * Generate human-readable match reasons
   */
  private generateReasons(matchedSkills: SkillMatchDetail[]): string[] {
    const reasons: string[] = []

    // Sort by weight descending
    const sorted = [...matchedSkills].sort((a, b) => b.weight - a.weight)
    const top3 = sorted.slice(0, 3)

    for (const match of top3) {
      switch (match.matchType) {
        case 'exact':
          reasons.push(`Strong match: ${match.personSkillName}`)
          break
        case 'equivalent':
          reasons.push(`${match.personSkillName} ≡ ${match.jobSkillName}`)
          break
        case 'narrower':
          reasons.push(`Your ${match.personSkillName} expertise applies to ${match.jobSkillName}`)
          break
        case 'broader':
          reasons.push(`Your ${match.personSkillName} background covers ${match.jobSkillName}`)
          break
        case 'similar':
          reasons.push(`${match.personSkillName} ≈ ${match.jobSkillName}`)
          break
      }
    }

    // Add coverage summary
    if (matchedSkills.length > 0) {
      const exactCount = matchedSkills.filter(m => m.matchType === 'exact').length
      const semanticCount = matchedSkills.length - exactCount
      if (semanticCount > 0) {
        reasons.push(`${exactCount} exact + ${semanticCount} semantic skill matches`)
      }
    }

    return reasons.slice(0, 3)
  }

  /**
   * Match person skills against all jobs using SPARQL query
   */
  async matchToAllJobs(personSkillIds: string[]): Promise<MatchedJob[]> {
    await this.initialize()

    // Use SPARQL query for matching (Neo4j only)
    return await this.matchToAllJobsSPARQL(personSkillIds)
  }

  /**
   * Match person skills to jobs using SPARQL query
   */
  private async matchToAllJobsSPARQL(personSkillIds: string[]): Promise<MatchedJob[]> {
    const sparqlResults = await neo4jStore.matchPersonToJobs(personSkillIds)
    const allJobs = await neo4jStore.getAllJobPostings()
    const jobMap = new Map(allJobs.map(job => [job.uri, job]))
    
    const jobMatches = new Map<string, {
      job: RDFJobPosting
      matches: Array<{
        personSkillId: string
        personSkillName: string
        jobSkillId: string
        jobSkillName: string
        matchType: string
        weight: number
      }>
    }>()

    for (const result of sparqlResults) {
      const jobUri = result.job?.value || result.job
      const matchType = result.matchType?.value || result.matchType
      const personSkillUri = result.personSkill?.value || result.personSkill
      const jobSkillUri = result.jobSkill?.value || result.jobSkill
      const personSkillName = result.personSkillName?.value || result.personSkillName
      const jobSkillName = result.jobSkillName?.value || result.jobSkillName

      if (!jobMatches.has(jobUri)) {
        const job = jobMap.get(jobUri)
        if (job) {
          jobMatches.set(jobUri, { job, matches: [] })
        }
      }

      const jobMatch = jobMatches.get(jobUri)
      if (jobMatch) {
        jobMatch.matches.push({
          personSkillId: personSkillUri.replace(PREFIXES.skill, ''),
          personSkillName: personSkillName || '',
          jobSkillId: jobSkillUri.replace(PREFIXES.skill, ''),
          jobSkillName: jobSkillName || '',
          matchType,
          weight: this.matchWeights[matchType] || 0
        })
      }
    }

    const matchedJobs: MatchedJob[] = []

    for (const [jobUri, { job, matches }] of jobMatches) {
      // Keep only the strongest match per required skill so one skill doesn't inflate the score.
      const bestByJobSkill = new Map<string, {
        personSkillId: string
        personSkillName: string
        jobSkillId: string
        jobSkillName: string
        matchType: string
        weight: number
      }>()

      for (const match of matches) {
        const current = bestByJobSkill.get(match.jobSkillId)
        if (!current || match.weight > current.weight) {
          bestByJobSkill.set(match.jobSkillId, match)
        }
      }

      const matchedSkills: SkillMatchDetail[] = Array.from(bestByJobSkill.values()).map(m => ({
        personSkillUri: PREFIXES.skill + m.personSkillId,
        personSkillName: m.personSkillName,
        jobSkillUri: PREFIXES.skill + m.jobSkillId,
        jobSkillName: m.jobSkillName,
        matchType: m.matchType as SkillMatchDetail['matchType'],
        weight: m.weight
      }))

      // Calculate score using the best match per required skill
      const totalRequired = job.requiredSkills.length
      const weightedSum = matchedSkills.reduce((sum, m) => sum + m.weight, 0)
      const coverageScore = totalRequired > 0 
        ? Math.min(100, Math.round((weightedSum / totalRequired) * 100))
        : 0

      matchedJobs.push({
        id: job.id,
        title: job.title,
        company: job.organization,
        location: job.location || 'Remote',
        skills: job.requiredSkills,
        description: job.description,
        url: job.url,
        matchScore: coverageScore,
        summary: this.generateSummary(job.description),
        reasons: this.generateReasons(matchedSkills),
        matchedSkills,
      })
    }

    // Sort by score descending
    matchedJobs.sort((a, b) => b.matchScore - a.matchScore)

    return matchedJobs
  }

  /**
   * Generate a short summary from job description
   */
  private generateSummary(description: string, maxLength: number = 150): string {
    if (!description) return ''
    
    let text = description
      .replace(/About the job\n?/gi, '')
      .replace(/About The Role\n?/gi, '')
      .replace(/\n+/g, ' ')
      .trim()
    
    if (text.length <= maxLength) {
      return text
    }
    
    const truncated = text.substring(0, maxLength)
    const lastPeriod = truncated.lastIndexOf('.')
    
    if (lastPeriod > maxLength * 0.6) {
      return truncated.substring(0, lastPeriod + 1)
    }
    
    return truncated.trim() + '...'
  }

  /**
   * Get statistics about the ontology
   */
  async getOntologyStats(): Promise<{
    totalSkills: number
    totalJobs: number
    totalPeople: number
    totalOrganizations: number
    totalTriples: number
    skillRelationships: {
      similar: number
      broader: number
      narrower: number
      equivalent: number
    }
  }> {
    await this.initialize()

    const skills = await neo4jStore.getAllSkills()
    const jobs = await neo4jStore.getAllJobPostings()
    const people = await neo4jStore.getAllPeople()
    const orgs = await neo4jStore.getAllOrganizations()

    let similar = 0, broader = 0, narrower = 0, equivalent = 0
    for (const skill of skills) {
      similar += skill.similarSkills.length
      broader += skill.broaderSkills.length
      narrower += skill.narrowerSkills.length
      equivalent += skill.equivalentSkills.length
    }

    return {
      totalSkills: skills.length,
      totalJobs: jobs.length,
      totalPeople: people.length,
      totalOrganizations: orgs.length,
      totalTriples: neo4jStore.size,
      skillRelationships: { similar, broader, narrower, equivalent }
    }
  }
}

// Export singleton instance
export const semanticMatcher = new SemanticMatcher()
