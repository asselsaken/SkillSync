/**
 * Find terms in job postings that look like skills but are not in the ontology.
 *
 * Signal: job requirements list skills together ("Python, Airflow, or SQL").
 * When a list contains at least one known skill, its other items are likely
 * skills too. Terms are ranked by how many postings list them.
 */

import { extractSkillIds } from '../rdf/semantic-matcher'
import { RDFSkill } from '../rdf/types'
import { splitSections } from '../jobs/text'
import { NormalizedJob } from '../jobs/types'

export interface SkillCandidate {
  term: string // most common spelling
  postings: number // number of postings listing it
  companies: number
  coOccursWith: { skill: string; count: number }[] // known skills listed alongside it
  examples: string[] // lines it appeared in
}

const MAX_WORDS = 3
const MIN_LENGTH = 2
const MAX_LENGTH = 30
const MAX_EXAMPLES = 3
const EXAMPLE_LENGTH = 160

/** Leading phrases removed from list items ("experience with Airflow" → "Airflow"). */
const LEAD_IN =
  /^(?:(?:and|or|the|a|an|e\.g\.?|eg|i\.e\.?|such as|including|incl\.?|like|using|with|in|of|on|via|plus|any|some|other|modern|strong|solid|deep|hands-on|hands on|working|practical|professional|production|proven|demonstrated|(?:\d+\+?\s*)?years?(?: of)?|experience(?: with| in| using)?|expertise(?: with| in)?|proficiency(?: with| in)?|proficient(?: with| in)?|knowledge(?: of)?|familiarity(?: with)?|familiar(?: with)?|understanding(?: of)?|background(?: in)?|skills?(?: in)?|languages?(?: like| such as)?|tools?(?: like| such as)?|frameworks?(?: like| such as)?)\s+)+/i

const TRAIL = /\s+(?:etc\.?|and more|or similar|or equivalent|or related|experience|skills?|preferred|a plus|is a plus|frameworks?|tools?|languages?)$/i

/** Common words that show up in requirement lists but are not skills. */
const STOPWORDS = new Set(
  `ability abilities communication collaboration leadership ownership teamwork problem solving problem-solving
  written verbal english degree bachelor bachelors bachelor's master masters master's phd ms bs ba
  computer science engineering mathematics math physics statistics related field fields equivalent
  experience years year industry startup startups customers customer users stakeholders teams team
  products product design designs systems system services service tools tooling platforms platform
  infrastructure applications application software hardware data code coding development developer developers
  technologies technology frameworks framework libraries library languages language scale performance
  reliability security quality testing debugging documentation architecture apis api cloud web mobile
  backend frontend front-end back-end full-stack fullstack distributed large-scale high-quality
  similar other others more etc others' best practices fast-paced ambiguity independently cross-functional
  you we our your their it this that these those them us e.g i.e eg ie etc nice to have nice-to-have
  build develop deploy design implement maintain own create drive lead support manage operate
  preferred required optional bonus plus desired ideally highly`.split(/\s+/),
)

/** Split a requirement line into list items. */
export function listItems(line: string): string[] {
  return line
    .replace(/^[•\-*\s]+/, '')
    .split(/,|;|:|\(|\)|\s\/\s|\s+or\s+|\s+and\s+|\s+&\s+/i)
    .map((s) => cleanItem(s))
    .filter((s): s is string => s !== null)
}

export function cleanItem(raw: string): string | null {
  let s = raw.trim().replace(/^[\s"'“”‘’.\-–—]+|[\s"'“”‘’.!?\-–—]+$/g, '')
  s = s.replace(LEAD_IN, '').replace(TRAIL, '').trim()
  if (s.length < MIN_LENGTH || s.length > MAX_LENGTH) return null
  if (s.split(/\s+/).length > MAX_WORDS) return null
  if (!/[a-z]/i.test(s)) return null
  if (STOPWORDS.has(s.toLowerCase()) || /^nice[- ]to[- ]haves?$/i.test(s)) return null
  if (/^\d/.test(s)) return null
  return s
}

/** Looks like a proper tool/technology name: capitalised, mixed case, digits or symbols. */
const looksLikeName = (s: string) => /[A-Z]|[0-9+#.]/.test(s)

export function findSkillCandidates(
  jobs: NormalizedJob[],
  skills: RDFSkill[],
  options: { minPostings?: number; limit?: number; alreadyReviewed?: Iterable<string> } = {},
): SkillCandidate[] {
  const { minPostings = 5, limit = 200 } = options
  const reviewed = new Set([...(options.alreadyReviewed ?? [])].map((t) => t.toLowerCase()))
  const names = new Map(skills.map((s) => [s.id, s.name]))

  interface Acc {
    spellings: Map<string, number>
    postings: Set<string>
    companies: Set<string>
    coOccurs: Map<string, number>
    examples: string[]
  }
  const acc = new Map<string, Acc>()
  const knownCache = new Map<string, string[]>()
  const knownIds = (item: string) => {
    let ids = knownCache.get(item)
    if (!ids) knownCache.set(item, (ids = extractSkillIds(item, skills)))
    return ids
  }

  for (const job of jobs) {
    const { required, preferred } = splitSections(job.description)
    const seenInJob = new Set<string>()

    for (const line of `${required}\n${preferred}`.split('\n')) {
      const items = listItems(line)
      if (items.length < 2) continue

      const known = items.flatMap(knownIds)
      if (known.length === 0) continue

      for (const item of items) {
        const key = item.toLowerCase()
        if (reviewed.has(key) || knownIds(item).length > 0 || !looksLikeName(item)) continue
        let a = acc.get(key)
        if (!a) acc.set(key, (a = { spellings: new Map(), postings: new Set(), companies: new Set(), coOccurs: new Map(), examples: [] }))
        a.spellings.set(item, (a.spellings.get(item) ?? 0) + 1)
        if (seenInJob.has(key)) continue
        seenInJob.add(key)
        a.postings.add(job.id)
        a.companies.add(job.company.slug)
        for (const id of new Set(known)) a.coOccurs.set(id, (a.coOccurs.get(id) ?? 0) + 1)
        if (a.examples.length < MAX_EXAMPLES) {
          const ex = line.replace(/^[•\-*\s]+/, '').trim()
          a.examples.push(ex.length > EXAMPLE_LENGTH ? ex.slice(0, EXAMPLE_LENGTH) + '…' : ex)
        }
      }
    }
  }

  return [...acc.values()]
    // Require spread across companies so one company's house jargon doesn't qualify
    .filter((a) => a.postings.size >= minPostings && a.companies.size >= 2)
    .map((a) => ({
      term: [...a.spellings.entries()].sort((x, y) => y[1] - x[1])[0][0],
      postings: a.postings.size,
      companies: a.companies.size,
      coOccursWith: [...a.coOccurs.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5)
        .map(([id, count]) => ({ skill: names.get(id) ?? id, count })),
      examples: a.examples,
    }))
    .sort((x, y) => y.postings - x.postings)
    .slice(0, limit)
}
