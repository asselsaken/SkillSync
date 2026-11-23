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
  /** Other locations of the same role (same company and title), collapsed into this match */
  otherLocations?: string[]
}

/**
 * Companies often post one role per city. Keep the best-ranked posting per
 * (company, title) and list the other locations on it. Input must be ranked.
 */
export function collapseDuplicates(matches: MatchedJob[]): MatchedJob[] {
  const byRole = new Map<string, MatchedJob>()
  for (const m of matches) {
    const key = `${m.company}|${m.title}`.toLowerCase()
    const first = byRole.get(key)
    if (!first) byRole.set(key, { ...m, otherLocations: [] })
    else if (m.location && m.location !== first.location && !first.otherLocations!.includes(m.location)) first.otherLocations!.push(m.location)
  }
  return [...byRole.values()]
}

/**
 * Pseudo-requirements added when ranking. A posting where only 1 skill was
 * detected and matched is weak evidence of fit, so it ranks below a posting
 * where 8 of 9 requirements are matched (100% → 25, 89% → 67).
 */
export const RANKING_PRIOR = 3

type RelateFn = (personSkillId: string, jobSkillId: string) => Promise<SkillRelation>

// ------------------------------------------------------------------ extraction

// Escapes regex syntax; valid in unicode mode ("-" needs no escape outside a class)
const escapeRegex = (s: string) => s.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')

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
    // \p{L}: letters of any script, so the "r" in "résumé" is not the R language
    pattern = new RegExp(`(^|[^\\p{L}\\p{N}+.#])${escapeRegex(key)}(?=$|[^\\p{L}\\p{N}+#]|\\.(?:$|[^\\p{L}\\p{N}]))`, 'gu')
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
    pattern = new RegExp(`(^|[^\\p{L}\\p{N}+.#])${escapeRegex(term)}(?=$|[^\\p{L}\\p{N}+#-]|\\.(?:$|[^\\p{L}\\p{N}]))`, 'gu')
    patternCache.set(key, pattern)
  }
  return pattern
}

export function containsWholeTerm(text: string, term: string): boolean {
  if (!term) return false
  const pattern = termPattern(term)
  pattern.lastIndex = 0
  const found = pattern.test(text.toLowerCase())
  pattern.lastIndex = 0
  return found
}

interface Span {
  start: number
  end: number
  skill: RDFSkill
}

export interface SkillMention {
  id: string
  start: number
  end: number
}

/** Like extractSkillIds, but returns every mention with its position, in text order. */
export function extractSkillMentions(text: string, skills: RDFSkill[]): SkillMention[] {
  const lower = text.toLowerCase()
  const spans: Span[] = []

  const addMatches = (source: string, term: string, pattern: RegExp, skill: RDFSkill) => {
    pattern.lastIndex = 0 // cached global regexes keep their position; matchAll copies it
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

  // Text order; of equivalent skills only the first mentioned is used.
  kept.sort((a, b) => a.start - b.start)
  const canonical = new Map<string, string>() // skill id -> id it is reported as
  const reported: RDFSkill[] = []
  for (const { skill } of kept) {
    if (canonical.has(skill.id)) continue
    const equivalent = reported.find((r) => r.equivalentSkills.includes(skill.id) || skill.equivalentSkills.includes(r.id))
    canonical.set(skill.id, equivalent?.id ?? skill.id)
    if (!equivalent) reported.push(skill)
  }
  return kept.map((k) => ({ id: canonical.get(k.skill.id) ?? k.skill.id, start: k.start, end: k.end }))
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
  return [...new Set(extractSkillMentions(text, skills).map((m) => m.id))]
}

// ------------------------------------------------------------------ scoring

/** Requirements of a job: each is a list of alternatives (a single skill is a list of one). */
export function requirementsOf(job: RDFJobPosting): string[][] {
  return [...job.requiredSkills.map((id) => [id]), ...(job.requiredGroups ?? [])]
}

/** Human-readable requirement labels: "Python", "AWS / GCP / Azure". */
export function requirementLabels(job: RDFJobPosting, skillNames: Map<string, string>): string[] {
  return requirementsOf(job).map((alts) => alts.map((id) => skillNames.get(id) ?? id).join(' / '))
}

/**
 * Score one job: for each requirement take the candidate's strongest related
 * skill (for an "any of" group, against any member), then normalise by the
 * number of requirements so that missing ones lower the score.
 */
export async function scoreJob(
  job: RDFJobPosting,
  personSkillIds: string[],
  skillNames: Map<string, string>,
  relate: RelateFn,
): Promise<{ score: number; rankScore: number; matchedSkills: SkillMatchDetail[]; missingSkills: string[] }> {
  const matchedSkills: SkillMatchDetail[] = []
  const missingSkills: string[] = []
  const name = (id: string) => skillNames.get(id) ?? id
  const requirements = requirementsOf(job)

  for (const alternatives of requirements) {
    let best: { personSkillId: string; jobSkillId: string; relation: SkillRelation } | null = null
    search: for (const jobSkillId of alternatives) {
      for (const personSkillId of personSkillIds) {
        const relation = await relate(personSkillId, jobSkillId)
        if (relation.related && (!best || relation.weight > best.relation.weight)) {
          best = { personSkillId, jobSkillId, relation }
          if (relation.weight >= 1) break search
        }
      }
    }

    if (best && best.relation.type !== 'none') {
      matchedSkills.push({
        personSkillUri: PREFIXES.skill + best.personSkillId,
        personSkillName: name(best.personSkillId),
        jobSkillUri: PREFIXES.skill + best.jobSkillId,
        jobSkillName: alternatives.length > 1 ? alternatives.map(name).join(' / ') : name(best.jobSkillId),
        matchType: best.relation.type,
        weight: best.relation.weight,
      })
    } else {
      missingSkills.push(alternatives.map(name).join(' / '))
    }
  }

  const total = requirements.length
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
  // Bullet lists become sentences: "• Build APIs\n• Own on-call" -> "Build APIs. Own on-call."
  const text = description
    .replace(/About the job\n?/gi, '')
    .replace(/About The Role\n?/gi, '')
    .split('\n')
    .map((l) => l.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter(Boolean)
    .map((l) => (/[.!?:;]$/.test(l) ? l : l + '.'))
    .join(' ')
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
        skills: requirementLabels(job, skillNames),
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
