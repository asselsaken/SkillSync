/**
 * SPARQL Query Engine for SkillMatch
 * 
 * Provides SPARQL query capabilities using Neo4j (n10s)
 * Fallback to N3 store is disabled
 */

import { neo4jStore } from './neo4j-store'
import { PREFIXES, SPARQL_PREFIXES, RDFSkill, RDFJobPosting, SemanticMatch, SkillMatchDetail } from './types'

/**
 * Common SPARQL queries for the SkillMatch ontology
 */
export const SPARQL_QUERIES = {
  // Get all skills with their relationships
  ALL_SKILLS: `
    ${SPARQL_PREFIXES}
    SELECT ?skill ?name ?alias ?broader ?narrower ?similar ?equivalent
    WHERE {
      ?skill a sm:Skill .
      ?skill sm:skillName ?name .
      OPTIONAL { ?skill sm:skillAlias ?alias }
      OPTIONAL { ?skill sm:broaderSkill ?broader }
      OPTIONAL { ?skill sm:narrowerSkill ?narrower }
      OPTIONAL { ?skill sm:similarTo ?similar }
      OPTIONAL { ?skill sm:equivalentSkill ?equivalent }
    }
  `,

  // Get all job postings with required skills
  ALL_JOBS: `
    ${SPARQL_PREFIXES}
    SELECT ?job ?title ?description ?location ?org ?skill
    WHERE {
      ?job a sm:JobPosting .
      ?job sm:jobTitle ?title .
      ?job sm:jobDescription ?description .
      ?job sm:postedBy ?orgUri .
      ?orgUri sm:organizationName ?org .
      ?job sm:requiresSkill ?skill .
      OPTIONAL { ?job sm:location ?location }
    }
  `,

  // Find jobs matching a person's skills (with semantic matching)
  MATCH_PERSON_TO_JOBS: `
    ${SPARQL_PREFIXES}
    SELECT ?job ?title ?org ?matchType ?personSkill ?jobSkill
    WHERE {
      ?person a sm:Person .
      ?person sm:hasSkill ?personSkill .
      ?job a sm:JobPosting .
      ?job sm:jobTitle ?title .
      ?job sm:postedBy ?orgUri .
      ?orgUri sm:organizationName ?org .
      ?job sm:requiresSkill ?jobSkill .
      
      # Match conditions (union of different match types)
      {
        # Exact match
        FILTER(?personSkill = ?jobSkill)
        BIND("exact" AS ?matchType)
      }
      UNION
      {
        # Equivalent skills
        ?personSkill sm:equivalentSkill ?jobSkill .
        BIND("equivalent" AS ?matchType)
      }
      UNION
      {
        # Person has narrower (more specific) skill
        ?personSkill sm:broaderSkill ?jobSkill .
        BIND("narrower" AS ?matchType)
      }
      UNION
      {
        # Person has broader (more general) skill
        ?personSkill sm:narrowerSkill ?jobSkill .
        BIND("broader" AS ?matchType)
      }
      UNION
      {
        # Similar skills
        ?personSkill sm:similarTo ?jobSkill .
        BIND("similar" AS ?matchType)
      }
    }
  `,

  // Find similar skills for a given skill
  SIMILAR_SKILLS: `
    ${SPARQL_PREFIXES}
    SELECT ?skill ?related ?relationType
    WHERE {
      ?skill a sm:Skill .
      {
        ?skill sm:similarTo ?related .
        BIND("similar" AS ?relationType)
      }
      UNION
      {
        ?skill sm:equivalentSkill ?related .
        BIND("equivalent" AS ?relationType)
      }
      UNION
      {
        ?skill sm:broaderSkill ?related .
        BIND("broader" AS ?relationType)
      }
      UNION
      {
        ?skill sm:narrowerSkill ?related .
        BIND("narrower" AS ?relationType)
      }
    }
  `,

  // Get skill hierarchy (for visualization)
  SKILL_HIERARCHY: `
    ${SPARQL_PREFIXES}
    SELECT ?parent ?child ?parentName ?childName
    WHERE {
      ?child sm:broaderSkill ?parent .
      ?parent sm:skillName ?parentName .
      ?child sm:skillName ?childName .
    }
    ORDER BY ?parentName ?childName
  `,

  // Count skills per job
  SKILLS_PER_JOB: `
    ${SPARQL_PREFIXES}
    SELECT ?job ?title (COUNT(?skill) AS ?skillCount)
    WHERE {
      ?job a sm:JobPosting .
      ?job sm:jobTitle ?title .
      ?job sm:requiresSkill ?skill .
    }
    GROUP BY ?job ?title
    ORDER BY DESC(?skillCount)
  `,

  // Find jobs requiring a specific skill or related skills
  JOBS_BY_SKILL: `
    ${SPARQL_PREFIXES}
    SELECT ?job ?title ?org ?matchType
    WHERE {
      ?targetSkill sm:skillName ?skillName .
      ?job a sm:JobPosting .
      ?job sm:jobTitle ?title .
      ?job sm:postedBy ?orgUri .
      ?orgUri sm:organizationName ?org .
      
      {
        ?job sm:requiresSkill ?targetSkill .
        BIND("exact" AS ?matchType)
      }
      UNION
      {
        ?targetSkill sm:broaderSkill ?broader .
        ?job sm:requiresSkill ?broader .
        BIND("broader" AS ?matchType)
      }
      UNION
      {
        ?targetSkill sm:narrowerSkill ?narrower .
        ?job sm:requiresSkill ?narrower .
        BIND("narrower" AS ?matchType)
      }
    }
  `,
}

/**
 * SPARQL Query Engine
 * 
 * Uses Neo4j with neosemantics plugin for real SPARQL queries.
 * Fallback is disabled.
 */
class SPARQLEngine {
  /**
   * Initialize and require Neo4j
   */
  private async initialize(): Promise<void> {
    const neo4jUri = process.env.NEO4J_URI
    if (!neo4jUri) {
      throw new Error('NEO4J_URI is not set. Neo4j is required (fallback disabled).')
    }

    await neo4jStore.initialize()
  }

  /**
   * Execute a SPARQL query (real SPARQL if Neo4j, simulated if N3)
   */
  async executeSPARQL(sparqlQuery: string): Promise<any[]> {
    await this.initialize()
    
    return await neo4jStore.executeSPARQL(sparqlQuery)
  }

  /**
   * Get all skills with their semantic relationships using SPARQL
   */
  async queryAllSkills(): Promise<RDFSkill[]> {
    await this.initialize()
    
    return await neo4jStore.getAllSkills()
  }

  /**
   * Get all job postings using SPARQL
   */
  async queryAllJobs(): Promise<RDFJobPosting[]> {
    await this.initialize()
    
    return await neo4jStore.getAllJobPostings()
  }

  /**
   * Find skills related to a given skill using SPARQL
   */
  async queryRelatedSkills(skillId: string): Promise<{
    skill: RDFSkill | undefined
    equivalent: RDFSkill[]
    broader: RDFSkill[]
    narrower: RDFSkill[]
    similar: RDFSkill[]
  }> {
    await this.initialize()

    const skill = await neo4jStore.getSkill(skillId)
    if (!skill) {
      return { skill: undefined, equivalent: [], broader: [], narrower: [], similar: [] }
    }

    const allSkills = await neo4jStore.getAllSkills()
    const skillMap = new Map(allSkills.map(s => [s.id, s]))

    return {
      skill,
      equivalent: skill.equivalentSkills.map(id => skillMap.get(id)).filter(Boolean) as RDFSkill[],
      broader: skill.broaderSkills.map(id => skillMap.get(id)).filter(Boolean) as RDFSkill[],
      narrower: skill.narrowerSkills.map(id => skillMap.get(id)).filter(Boolean) as RDFSkill[],
      similar: skill.similarSkills.map(id => skillMap.get(id)).filter(Boolean) as RDFSkill[],
    }
  }

  /**
   * Match a person's skills against jobs using SPARQL semantic reasoning
   */
  async matchPersonToJobs(personSkillIds: string[]): Promise<SemanticMatch[]> {
    await this.initialize()
    
    // Use SPARQL query for matching (Neo4j only)
    const sparqlResults = await neo4jStore.matchPersonToJobs(personSkillIds)
    const jobs = await neo4jStore.getAllJobPostings()
    const jobMap = new Map(jobs.map(job => [job.uri, job]))
    
    // Group by job
    const jobMatches = new Map<string, {
      job: RDFJobPosting
      matchedSkills: SkillMatchDetail[]
    }>()
    
    for (const result of sparqlResults) {
      const jobUri = result.job?.value || result.job
      const matchType = result.matchType?.value || result.matchType
      const personSkillUri = result.personSkill?.value || result.personSkill
      const jobSkillUri = result.jobSkill?.value || result.jobSkill
      
      if (!jobMatches.has(jobUri)) {
        const job = jobMap.get(jobUri)
        if (job) {
          jobMatches.set(jobUri, { job, matchedSkills: [] })
        }
      }
      
      const jobMatch = jobMatches.get(jobUri)
      if (jobMatch) {
        const weights: Record<string, number> = {
          exact: 1.0,
          equivalent: 1.0,
          narrower: 0.85,
          broader: 0.5,
          similar: 0.6
        }
        
        // Get skill names
        const personSkill = await neo4jStore.getSkill(personSkillUri.replace(PREFIXES.skill, ''))
        const jobSkill = await neo4jStore.getSkill(jobSkillUri.replace(PREFIXES.skill, ''))
        
        if (personSkill && jobSkill) {
          jobMatch.matchedSkills.push({
            personSkillUri,
            personSkillName: personSkill.name,
            jobSkillUri,
            jobSkillName: jobSkill.name,
            matchType: matchType as SkillMatchDetail['matchType'],
            weight: weights[matchType] || 0
          })
        }
      }
    }
    
    // Convert to SemanticMatch format
    const matches: SemanticMatch[] = []
    for (const [jobUri, { job, matchedSkills }] of jobMatches) {
      // Keep only the best match per required skill
      const bestByJobSkill = new Map<string, SkillMatchDetail>()
      for (const m of matchedSkills) {
        const jobSkillId = m.jobSkillUri.replace(PREFIXES.skill, '')
        const current = bestByJobSkill.get(jobSkillId)
        if (!current || m.weight > current.weight) {
          bestByJobSkill.set(jobSkillId, m)
        }
      }

      const dedupedMatches = Array.from(bestByJobSkill.values())

      const totalRequired = job.requiredSkills.length
      const weightedSum = dedupedMatches.reduce((sum, m) => sum + m.weight, 0)
      const score = totalRequired > 0 
        ? Math.min(100, Math.round((weightedSum / totalRequired) * 100))
        : 0
      
      matches.push({
        personUri: '',
        jobUri: job.uri,
        score,
        matchedSkills: dedupedMatches,
        totalRequiredSkills: totalRequired,
        totalMatchedSkills: dedupedMatches.length,
      })
    }
    
    matches.sort((a, b) => b.score - a.score)
    return matches
  }

  /**
   * Find jobs that require a specific skill or related skills using SPARQL
   */
  async queryJobsBySkill(skillName: string): Promise<{
    job: RDFJobPosting
    matchType: 'exact' | 'broader' | 'narrower' | 'similar'
  }[]> {
    await this.initialize()
    
    const skill = await neo4jStore.getSkill(skillName)
    if (!skill) return []

    const jobs = await neo4jStore.getAllJobPostings()
    const matches: {
      job: RDFJobPosting
      matchType: 'exact' | 'broader' | 'narrower' | 'similar'
      weight: number
    }[] = []

    for (const job of jobs) {
      for (const requiredSkillId of job.requiredSkills) {
        const relation = await neo4jStore.areSkillsRelated(skill.id, requiredSkillId)
        if (relation.related) {
          matches.push({
            job,
            matchType: relation.type as 'exact' | 'broader' | 'narrower' | 'similar',
            weight: relation.weight
          })
        }
      }
    }

    // Prefer strongest relation per job
    const bestPerJob = new Map<string, { job: RDFJobPosting; matchType: 'exact' | 'broader' | 'narrower' | 'similar'; weight: number }>()
    for (const m of matches) {
      const current = bestPerJob.get(m.job.uri)
      if (!current || m.weight > current.weight) {
        bestPerJob.set(m.job.uri, m)
      }
    }

    return Array.from(bestPerJob.values()).map(({ job, matchType }) => ({ job, matchType }))
  }

  /**
   * Get skill hierarchy for visualization using SPARQL
   */
  async querySkillHierarchy(): Promise<{ parent: string; child: string; parentName: string; childName: string }[]> {
    await this.initialize()
    
    const skills = await neo4jStore.getAllSkills()
    const skillMap = new Map(skills.map(s => [s.id, s.name]))

    const hierarchy: { parent: string; child: string; parentName: string; childName: string }[] = []
    for (const skill of skills) {
      for (const broaderId of skill.broaderSkills) {
        hierarchy.push({
          parent: broaderId,
          child: skill.id,
          parentName: skillMap.get(broaderId) || broaderId,
          childName: skill.name
        })
      }
    }

    // Keep ordering stable
    hierarchy.sort((a, b) => a.parentName.localeCompare(b.parentName) || a.childName.localeCompare(b.childName))
    return hierarchy
  }
}

// Export singleton instance
export const sparqlEngine = new SPARQLEngine()
