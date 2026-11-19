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
  applyUrl?: string
  isRemote?: boolean
  matchScore: number
  summary: string
  reasons: string[]
  matchedSkills: SkillMatchDetail[]
  missingSkills: string[]
  /** Ranking key: coverage smoothed so jobs with very few detected requirements don't dominate */
  rankScore: number
}

/**
 * Pseudo-requirements added when ranking. A posting where only 1 skill was
 * detected and matched is weak evidence of fit, so it ranks below a posting
 * where 8 of 9 requirements are matched (100% → 25, 89% → 67).
 */
export const RANKING_PRIOR = 3

type RelateFn = (personSkillId: string, jobSkillId: string) => Promise<SkillRelation>

// ------------------------------------------------------------------ extraction

const escapeRegex = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')

const patternCache = new Map<string, RegExp>()

/**
 * Pattern for `term` as a standalone token.
 * Allows + # . inside a token (C++, C#, Node.js) but not around it, so "R"
 * does not match inside "for" and "Java" does not match "JavaScript".
 * "/" separates tokens ("Python/R", "JavaScript/TypeScript"); slash terms
 * such as "CI/CD" still win because the longest overlapping match is kept.
 * A trailing sentence period is allowed ("...and Python.").
 */
function termPattern(term: string): RegExp {
  const key = term.toLowerCase()
  let pattern = patternCache.get(key)
  if (!pattern) {
    pattern = new RegExp(`(^|[^a-z0-9+.#])${escapeRegex(key)}(?=$|[^a-z0-9+#]|\\.(?:$|[^a-z0-9]))`, 'g')
    patternCache.set(key, pattern)
  }
  return pattern
}

/**
 * Exact-case pattern for ambiguous names such as "Go". Also refuses a following
 * hyphen, so "Go-to-market" is not read as the Go language.
 */
function caseSensitivePattern(term: string): RegExp {
  const key = `cs:${term}`
  let pattern = patternCache.get(key)
  if (!pattern) {
    pattern = new RegExp(`(^|[^A-Za-z0-9+.#])${escapeRegex(term)}(?=$|[^A-Za-z0-9+#-]|\\.(?:$|[^A-Za-z0-9]))`, 'g')
    patternCache.set(key, pattern)
  }
  return pattern
}

export function containsWholeTerm(text: string, term: string): boolean {
  if (!term) return false
  const pattern = termPattern(term)
  pattern.lastIndex = 0
  return pattern.test(text.toLowerCase())
}

interface Span {
  start: number
  end: number
  skill: RDFSkill
}

/**
 * Return the ids of ontology skills mentioned by name or alias in `text`.
 *
 * - A match inside a longer match is dropped: "A/B testing" yields A/B Testing,
 *   not also the generic Testing. Partially overlapping matches both count.
 * - Of skills declared equivalent (e.g. LLMs ≡ Large Language Models) only the
 *   first mentioned is kept, so one concept is not counted twice.
 */
export function extractSkillIds(text: string, skills: RDFSkill[]): string[] {
  const lower = text.toLowerCase()
  const spans: Span[] = []

  const addMatches = (source: string, term: string, pattern: RegExp, skill: RDFSkill) => {
    for (const m of source.matchAll(pattern)) {
      const start = (m.index ?? 0) + m[1].length
      spans.push({ start, end: start + term.length, skill })
    }
  }

  for (const skill of skills) {
    const terms = skill.caseSensitive ? skill.aliases : [skill.name, ...skill.aliases]
    for (const term of new Set(terms.map((t) => t.toLowerCase()))) {
      if (term && lower.includes(term)) addMatches(lower, term, termPattern(term), skill)
    }
    if (skill.caseSensitive && text.includes(skill.name)) {
      addMatches(text, skill.name, caseSensitivePattern(skill.name), skill)
    }
  }

  // Longest spans first; a span is dropped if it lies inside a kept span of another skill
  // ("testing" inside "A/B testing"). Partial overlaps both count: "streaming data
  // pipelines" mentions Stream Processing and Data Pipelines.
  spans.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
  const kept: Span[] = []
  for (const span of spans) {
    const inside = kept.some((k) => k.skill.id !== span.skill.id && k.start <= span.start && span.end <= k.end)
    if (!inside) kept.push(span)
  }

  // First mention order, collapsing equivalent skills.
  kept.sort((a, b) => a.start - b.start)
  const found: RDFSkill[] = []
  for (const { skill } of kept) {
    if (found.some((f) => f.id === skill.id)) continue
    const isEquivalent = found.some((f) => f.equivalentSkills.includes(skill.id) || skill.equivalentSkills.includes(f.id))
    if (!isEquivalent) found.push(skill)
  }
  return found.map((s) => s.id)
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
): Promise<{ score: number; rankScore: number; matchedSkills: SkillMatchDetail[]; missingSkills: string[] }> {
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
  const rankScore = Math.round((weighted / (total + RANKING_PRIOR)) * 100)

  return { score, rankScore, matchedSkills, missingSkills }
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
    // Many jobs share requirements, so each (candidate skill, job skill) pair is resolved once.
    const cache = new Map<string, Promise<SkillRelation>>()
    const relate: RelateFn = (p, j) => {
      const key = `${p}|${j}`
      let relation = cache.get(key)
      if (!relation) {
        relation = store.areSkillsRelated(p, j)
        cache.set(key, relation)
      }
      return relation
    }

    const results: MatchedJob[] = []
    for (const job of jobs) {
      const { score, rankScore, matchedSkills, missingSkills } = await scoreJob(job, personSkillIds, skillNames, relate)
      if (matchedSkills.length === 0) continue
      results.push({
        id: job.id,
        title: job.title,
        company: job.organization,
        location: job.location || 'Remote',
        skills: job.requiredSkills.map((id) => skillNames.get(id) ?? id),
        description: job.description,
        url: job.url,
        applyUrl: job.applyUrl ?? job.url,
        isRemote: job.isRemote,
        matchScore: score,
        summary: generateSummary(job.description),
        reasons: generateReasons(matchedSkills),
        matchedSkills,
        missingSkills,
        rankScore,
      })
    }

    return results.sort((a, b) => b.rankScore - a.rankScore || b.matchScore - a.matchScore)
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
