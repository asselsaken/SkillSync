/**
 * SPARQL Query Engine for SkillMatch
 *
 * Named SPARQL queries over the skill graph. Runs on the active GraphStore
 * (in-memory Oxigraph by default, Neo4j + n10s when NEO4J_URI is set).
 */

import { getGraphStore, SparqlRow } from './graph-store'
import { semanticMatcher } from './semantic-matcher'
import { RDFJobPosting, RDFSkill, SemanticMatch, SPARQL_PREFIXES } from './types'

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
 */
class SPARQLEngine {
  /** Run a raw read-only SPARQL query against the graph. */
  async executeSPARQL(sparqlQuery: string): Promise<SparqlRow[]> {
    const store = await getGraphStore()
    return store.executeSPARQL(sparqlQuery)
  }

  async queryAllSkills(): Promise<RDFSkill[]> {
    return (await getGraphStore()).getAllSkills()
  }

  async queryAllJobs(): Promise<RDFJobPosting[]> {
    return (await getGraphStore()).getAllJobPostings()
  }

  async queryRelatedSkills(skillId: string): Promise<{
    skill: RDFSkill | undefined
    equivalent: RDFSkill[]
    broader: RDFSkill[]
    narrower: RDFSkill[]
    similar: RDFSkill[]
  }> {
    const store = await getGraphStore()
    const skill = await store.getSkill(skillId)
    if (!skill) return { skill: undefined, equivalent: [], broader: [], narrower: [], similar: [] }

    const skillMap = new Map((await store.getAllSkills()).map((s) => [s.id, s]))
    const resolve = (ids: string[]) => ids.map((id) => skillMap.get(id)).filter((s): s is RDFSkill => !!s)

    return {
      skill,
      equivalent: resolve(skill.equivalentSkills),
      broader: resolve(skill.broaderSkills),
      narrower: resolve(skill.narrowerSkills),
      similar: resolve(skill.similarSkills),
    }
  }

  async matchPersonToJobs(personSkillIds: string[]): Promise<SemanticMatch[]> {
    const matches = await semanticMatcher.matchToAllJobs(personSkillIds)
    return matches.map((m) => ({
      personUri: '',
      jobUri: m.id,
      score: m.matchScore,
      matchedSkills: m.matchedSkills,
      totalRequiredSkills: m.skills.length,
      totalMatchedSkills: m.matchedSkills.length,
    }))
  }

  async queryJobsBySkill(skillName: string): Promise<{
    job: RDFJobPosting
    matchType: string
  }[]> {
    const store = await getGraphStore()
    const skill = await store.getSkill(skillName)
    if (!skill) return []

    const results: { job: RDFJobPosting; matchType: string; weight: number }[] = []
    for (const job of await store.getAllJobPostings()) {
      let best: { matchType: string; weight: number } | null = null
      for (const requiredSkillId of [...job.requiredSkills, ...(job.requiredGroups ?? []).flat()]) {
        const relation = await store.areSkillsRelated(skill.id, requiredSkillId)
        if (relation.related && (!best || relation.weight > best.weight)) {
          best = { matchType: relation.type, weight: relation.weight }
        }
      }
      if (best) results.push({ job, ...best })
    }

    return results
      .sort((a, b) => b.weight - a.weight)
      .map(({ job, matchType }) => ({ job, matchType }))
  }

  async querySkillHierarchy(): Promise<{ parent: string; child: string; parentName: string; childName: string }[]> {
    const skills = await (await getGraphStore()).getAllSkills()
    const names = new Map(skills.map((s) => [s.id, s.name]))

    return skills
      .flatMap((skill) =>
        skill.broaderSkills.map((parent) => ({
          parent,
          child: skill.id,
          parentName: names.get(parent) ?? parent,
          childName: skill.name,
        })),
      )
      .sort((a, b) => a.parentName.localeCompare(b.parentName) || a.childName.localeCompare(b.childName))
  }
}

export const sparqlEngine = new SPARQLEngine()
