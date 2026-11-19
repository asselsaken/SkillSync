/**
 * Detect "any of" requirements in job postings.
 *
 * "Experience with AWS, GCP, or Azure" asks for one cloud, not all three.
 * "Python and SQL" asks for both. We look at the words between consecutive
 * skill mentions on a line:
 *
 *   - a run of skills joined only by separators ("," "/" "or" "and/or" "and")
 *     is one list;
 *   - the list is a set of alternatives if it is joined with "or" / "/", or
 *     introduced by an example cue ("e.g.", "such as", "one of", "like"…)
 *     and not joined with "and".
 */

import { extractSkillMentions } from '../rdf/semantic-matcher'
import { RDFSkill } from '../rdf/types'

const SEPARATOR = /^[\s,]*(?:(?:and\/or|or|and|\/|&)[\s,]*)?$/i
const ALTERNATIVE = /\b(or|and\/or)\b|\//i
const CONJUNCTION = /(^|[^/])\band\b(?!\/)|&/i
const EXAMPLE_CUE = /(?:e\.g\.?|eg\.|i\.e\.?|such as|like|including|incl\.?|one of|any of|either|for example|preferably)\s*[:(]?\s*$/i
const CUE_WINDOW = 40

export interface RequirementLine {
  singles: string[] // each required on its own
  groups: string[][] // each satisfied by any member
}

/** Split one line's skill mentions into single requirements and "any of" groups. */
export function analyseLine(line: string, skills: RDFSkill[]): RequirementLine {
  const mentions = extractSkillMentions(line, skills)
  const singles: string[] = []
  const groups: string[][] = []

  let i = 0
  while (i < mentions.length) {
    // Grow a run of mentions separated only by list separators
    let j = i
    let alternative = false
    let conjunction = false
    while (j + 1 < mentions.length) {
      const between = line.slice(mentions[j].end, mentions[j + 1].start)
      if (!SEPARATOR.test(between)) break
      if (ALTERNATIVE.test(between)) alternative = true
      else if (CONJUNCTION.test(between)) conjunction = true
      j++
    }

    const ids = [...new Set(mentions.slice(i, j + 1).map((m) => m.id))]
    const before = line.slice(Math.max(0, mentions[i].start - CUE_WINDOW), mentions[i].start)
    // "AWS, GCP, or Azure" and "(e.g. Python, Java)" are alternatives;
    // "like AWS, MySQL and Kubernetes" lists things that are all used.
    if (ids.length >= 2 && (alternative || (!conjunction && EXAMPLE_CUE.test(before)))) groups.push(ids)
    else singles.push(...ids)
    i = j + 1
  }
  return { singles, groups }
}

/**
 * Combine the lines of a requirements section. A skill that is required on its
 * own anywhere is removed from groups; groups left with fewer than two members
 * are dissolved into single requirements; duplicate groups are merged.
 */
export function analyseRequirements(text: string, skills: RDFSkill[]): { singles: string[]; groups: string[][] } {
  const singles = new Set<string>()
  const rawGroups: string[][] = []
  for (const line of text.split('\n')) {
    const r = analyseLine(line, skills)
    r.singles.forEach((id) => singles.add(id))
    rawGroups.push(...r.groups)
  }

  const groups: string[][] = []
  const seen = new Set<string>()
  for (const g of rawGroups) {
    const members = g.filter((id) => !singles.has(id))
    if (members.length < 2) {
      members.forEach((id) => singles.add(id))
      continue
    }
    const key = [...members].sort().join('|')
    if (!seen.has(key)) {
      seen.add(key)
      groups.push(members)
    }
  }

  // A skill in several different groups is ambiguous; keep it in the first only.
  const grouped = new Set<string>()
  const result: string[][] = []
  for (const g of groups) {
    const members = g.filter((id) => !grouped.has(id))
    members.forEach((id) => grouped.add(id))
    if (members.length >= 2) result.push(members)
    else members.forEach((id) => singles.add(id))
  }

  return { singles: [...singles], groups: result }
}
