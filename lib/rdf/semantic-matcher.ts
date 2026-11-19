/**
 * Semantic Matcher
 *
 * Extracts ontology skills from free text and ranks job postings by how well
 * a candidate's skills cover each job's requirements, using the skill graph
 * (exact / equivalent / narrower / similar / broader relations).
 *
 * Works with any GraphStore backend (in-memory or Neo4j).
 */

import { getGraphStore, SkillRelation } from './graph-store'
import { MATCH_TYPE_WEIGHTS, PREFIXES, RDFJobPosting, RDFSkill, SkillMatchDetail } from './types'

export interface MatchedJob {
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
  missingSkills: string[]
}

type RelateFn = (personSkillId: string, jobSkillId: string) => Promise<SkillRelation>

// ------------------------------------------------------------------ extraction

const escapeRegex = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')

/**
 * True if `term` appears in `text` as a standalone token.
 * Allows + # . / inside a token (C++, C#, Node.js, CI/CD) but not around it,
 * so "R" does not match inside "for" and "Java" does not match "JavaScript".
 * A trailing sentence period is allowed ("...and Python.").
 */
export function containsWholeTerm(text: string, term: string): boolean {
  if (!term) return false
  const pattern = new RegExp(`(^|[^a-z0-9+.#/])${escapeRegex(term.toLowerCase())}(?=$|[^a-z0-9+#/]|\\.(?:$|[^a-z0-9]))`, 'i')
  return pattern.test(text.toLowerCase())
}

/** Return the ids of all ontology skills mentioned by name or alias in `text`. */
export function extractSkillIds(text: string, skills: RDFSkill[]): string[] {
  const found = new Set<string>()
  for (const skill of skills) {
    if ([skill.name, ...skill.aliases].some((term) => containsWholeTerm(text, term))) {
      found.add(skill.id)
    }
  }
  return Array.from(found)
}

// ------------------------------------------------------------------ scoring

/**
 * Score one job: for each required skill take the candidate's strongest
 * related skill, then normalise by the number of required skills so that
 * missing requirements lower the score.
 */
export async function scoreJob(
  job: RDFJobPosting,
  personSkillIds: string[],
  skillNames: Map<string, string>,
  relate: RelateFn,
): Promise<{ score: number; matchedSkills: SkillMatchDetail[]; missingSkills: string[] }> {
  const matchedSkills: SkillMatchDetail[] = []
  const missingSkills: string[] = []

  for (const jobSkillId of job.requiredSkills) {
    let best: { personSkillId: string; relation: SkillRelation } | null = null
    for (const personSkillId of personSkillIds) {
      const relation = await relate(personSkillId, jobSkillId)
      if (relation.related && (!best || relation.weight > best.relation.weight)) {
        best = { personSkillId, relation }
        if (relation.weight >= 1) break
      }
    }

    if (best && best.relation.type !== 'none') {
      matchedSkills.push({
        personSkillUri: PREFIXES.skill + best.personSkillId,
        personSkillName: skillNames.get(best.personSkillId) ?? best.personSkillId,
        jobSkillUri: PREFIXES.skill + jobSkillId,
        jobSkillName: skillNames.get(jobSkillId) ?? jobSkillId,
        matchType: best.relation.type,
        weight: best.relation.weight,
      })
    } else {
      missingSkills.push(skillNames.get(jobSkillId) ?? jobSkillId)
    }
  }

  const total = job.requiredSkills.length
  const weighted = matchedSkills.reduce((sum, m) => sum + m.weight, 0)
  const score = total > 0 ? Math.min(100, Math.round((weighted / total) * 100)) : 0

  return { score, matchedSkills, missingSkills }
}

export function generateReasons(matchedSkills: SkillMatchDetail[]): string[] {
  const reasons = [...matchedSkills]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((m) => {
      switch (m.matchType) {
        case 'exact':
          return `Strong match: ${m.personSkillName}`
        case 'equivalent':
          return `${m.personSkillName} ≡ ${m.jobSkillName}`
        case 'narrower':
          return `Your ${m.personSkillName} expertise applies to ${m.jobSkillName}`
        case 'broader':
          return `Your ${m.personSkillName} background covers ${m.jobSkillName}`
        case 'similar':
          return `${m.personSkillName} ≈ ${m.jobSkillName}`
      }
    })

  const exact = matchedSkills.filter((m) => m.matchType === 'exact').length
  const semantic = matchedSkills.length - exact
  if (semantic > 0) reasons.push(`${exact} exact + ${semantic} semantic skill matches`)

  return reasons.slice(0, 3)
}

export function generateSummary(description: string, maxLength = 150): string {
  if (!description) return ''
  const text = description
    .replace(/About the job\n?/gi, '')
    .replace(/About The Role\n?/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= maxLength) return text

  const truncated = text.substring(0, maxLength)
  const lastPeriod = truncated.lastIndexOf('.')
  return lastPeriod > maxLength * 0.6 ? truncated.substring(0, lastPeriod + 1) : truncated.trim() + '...'
}

// ------------------------------------------------------------------ service

class SemanticMatcher {
  async extractSkillsFromText(text: string): Promise<string[]> {
    const store = await getGraphStore()
    return extractSkillIds(text, await store.getAllSkills())
  }

  async matchToAllJobs(personSkillIds: string[]): Promise<MatchedJob[]> {
    const store = await getGraphStore()
    const [skills, jobs] = await Promise.all([store.getAllSkills(), store.getAllJobPostings()])
    const skillNames = new Map(skills.map((s) => [s.id, s.name]))
    const relate: RelateFn = (p, j) => store.areSkillsRelated(p, j)

    const results: MatchedJob[] = []
    for (const job of jobs) {
      const { score, matchedSkills, missingSkills } = await scoreJob(job, personSkillIds, skillNames, relate)
      if (matchedSkills.length === 0) continue
      results.push({
        id: job.id,
        title: job.title,
        company: job.organization,
        location: job.location || 'Remote',
        skills: job.requiredSkills.map((id) => skillNames.get(id) ?? id),
        description: job.description,
        url: job.url,
        matchScore: score,
        summary: generateSummary(job.description),
        reasons: generateReasons(matchedSkills),
        matchedSkills,
        missingSkills,
      })
    }

    return results.sort((a, b) => b.matchScore - a.matchScore)
  }

  async getOntologyStats() {
    const store = await getGraphStore()
    const [skills, jobs, people, orgs, totalTriples] = await Promise.all([
      store.getAllSkills(),
      store.getAllJobPostings(),
      store.getAllPeople(),
      store.getAllOrganizations(),
      store.tripleCount(),
    ])

    const count = (key: 'similarSkills' | 'broaderSkills' | 'narrowerSkills' | 'equivalentSkills') =>
      skills.reduce((n, s) => n + s[key].length, 0)

    return {
      backend: store.backend,
      totalSkills: skills.length,
      totalJobs: jobs.length,
      totalPeople: people.length,
      totalOrganizations: orgs.length,
      totalTriples,
      skillRelationships: {
        similar: count('similarSkills'),
        broader: count('broaderSkills'),
        narrower: count('narrowerSkills'),
        equivalent: count('equivalentSkills'),
      },
    }
  }
}

export const semanticMatcher = new SemanticMatcher()
export { MATCH_TYPE_WEIGHTS }
