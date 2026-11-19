/**
 * Skill proposals: the reviewed output of `prompts/review-skill-candidates.md`.
 *
 * A proposal batch is plain JSON so a person can read and edit it. Before
 * anything reaches the graph it is checked here (structure, ids, name
 * collisions, relation targets) and then by SHACL.
 */

import * as N3 from 'n3'
import { PREFIXES, RDFSkill } from '../rdf/types'

export interface NewSkillProposal {
  id: string
  name: string
  aliases?: string[]
  broader: string[] // at least one, so the new skill connects to the graph
  similar?: string[]
  equivalent?: string[]
  caseSensitive?: boolean
  description?: string
  evidencePostings?: number
}

export interface AliasProposal {
  skill: string // existing skill id
  aliases: string[]
}

export interface Rejection {
  term: string
  reason: string
}

export interface ProposalBatch {
  reviewedAt: string // YYYY-MM-DD
  reviewer: string
  newSkills: NewSkillProposal[]
  newAliases?: AliasProposal[]
  rejected?: Rejection[]
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_ALIASES = 8
const ALIAS_MIN = 2
const NAME_MAX = 100
const ALIAS_MAX = 60

/**
 * Words that must never become a case-insensitive name or alias: they occur in
 * ordinary English and would create false matches.
 */
const AMBIGUOUS_WORDS = new Set(
  `a an and as at be by do go if in is it me my no of on or so to up us we
  all any are can get has how its new not now one our out see two use who why
  data build code test run ship lead make work team spring swift rust ruby dart
  ray flow beam spark airflow glue pig hive kit core base edge flux helm`.split(/\s+/),
)

export interface ValidationIssue {
  where: string
  message: string
}

/** Check a batch against the current skills. Returns a list of problems (empty = OK). */
export function validateBatch(batch: ProposalBatch, existing: RDFSkill[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const fail = (where: string, message: string) => issues.push({ where, message })

  if (!DATE_PATTERN.test(batch.reviewedAt ?? '')) fail('reviewedAt', 'must be YYYY-MM-DD')
  if (!batch.reviewer) fail('reviewer', 'is required')
  if (!Array.isArray(batch.newSkills)) fail('newSkills', 'must be an array')

  const existingIds = new Set(existing.map((s) => s.id))
  const newIds = new Set<string>()
  // Every name and alias in the graph, lower-cased, mapped to the skill that owns it
  const terms = new Map<string, string>()
  for (const s of existing) for (const t of [s.name, ...s.aliases]) terms.set(t.toLowerCase(), s.id)

  const claim = (where: string, term: string, owner: string, caseSensitive: boolean) => {
    const key = term.toLowerCase()
    const holder = terms.get(key)
    if (holder && holder !== owner) fail(where, `"${term}" is already used by skill "${holder}"`)
    else if (!caseSensitive && AMBIGUOUS_WORDS.has(key)) {
      fail(where, `"${term}" is an ordinary word; use a longer form or set caseSensitive on the name`)
    } else terms.set(key, owner)
  }

  const checkAlias = (where: string, alias: unknown, owner: string) => {
    if (typeof alias !== 'string' || alias.trim() !== alias || alias.length < ALIAS_MIN || alias.length > ALIAS_MAX) {
      fail(where, `alias ${JSON.stringify(alias)} must be a trimmed string of ${ALIAS_MIN}-${ALIAS_MAX} characters`)
      return
    }
    claim(where, alias, owner, false)
  }

  for (const [i, s] of (batch.newSkills ?? []).entries()) {
    const where = `newSkills[${i}] (${s?.id ?? '?'})`
    if (!ID_PATTERN.test(s?.id ?? '')) { fail(where, 'id must be lower-case-hyphenated'); continue }
    if (existingIds.has(s.id) || newIds.has(s.id)) { fail(where, 'id already exists'); continue }
    newIds.add(s.id)

    if (!s.name || s.name.trim() !== s.name || s.name.length > NAME_MAX) fail(where, `name must be 1-${NAME_MAX} trimmed characters`)
    else claim(where, s.name, s.id, s.caseSensitive === true)

    const aliases = s.aliases ?? []
    if (aliases.length > MAX_ALIASES) fail(where, `at most ${MAX_ALIASES} aliases`)
    aliases.forEach((a) => checkAlias(where, a, s.id))

    if (!Array.isArray(s.broader) || s.broader.length === 0) fail(where, 'needs at least one broader skill')
    if (s.evidencePostings !== undefined && !(Number.isInteger(s.evidencePostings) && s.evidencePostings >= 0)) {
      fail(where, 'evidencePostings must be a non-negative integer')
    }
  }

  // Relation targets may be existing skills or skills added in this batch
  const known = (id: string) => existingIds.has(id) || newIds.has(id)
  for (const s of batch.newSkills ?? []) {
    for (const [rel, targets] of Object.entries({ broader: s.broader, similar: s.similar, equivalent: s.equivalent })) {
      for (const t of targets ?? []) {
        if (t === s.id) fail(`newSkills (${s.id})`, `${rel} cannot point to itself`)
        else if (!known(t)) fail(`newSkills (${s.id})`, `${rel} target "${t}" does not exist`)
      }
    }
  }

  for (const [i, a] of (batch.newAliases ?? []).entries()) {
    const where = `newAliases[${i}] (${a?.skill ?? '?'})`
    const target = existing.find((s) => s.id === a?.skill)
    if (!target) { fail(where, 'skill does not exist'); continue }
    if (target.aliases.length + (a.aliases?.length ?? 0) > MAX_ALIASES) fail(where, `would exceed ${MAX_ALIASES} aliases`)
    for (const alias of a.aliases ?? []) checkAlias(where, alias, a.skill)
  }

  return issues
}

const { namedNode, literal, quad } = N3.DataFactory
const SM = PREFIXES.sm
const skillNode = (id: string) => namedNode(PREFIXES.skill + id)

/** RDF for a validated batch. Only `broaderSkill` is stated; `narrowerSkill` is its OWL inverse. */
export function batchToQuads(batch: ProposalBatch): N3.Quad[] {
  const quads: N3.Quad[] = []
  const add = (s: string, p: string, o: N3.Term) => quads.push(quad(skillNode(s), namedNode(p), o as N3.Quad_Object))
  const xsd = (v: string, t: string) => literal(v, namedNode(PREFIXES.xsd + t))

  for (const s of batch.newSkills) {
    add(s.id, PREFIXES.rdf + 'type', namedNode(SM + 'Skill'))
    add(s.id, SM + 'skillName', literal(s.name))
    for (const a of s.aliases ?? []) add(s.id, SM + 'skillAlias', literal(a))
    for (const b of s.broader) add(s.id, SM + 'broaderSkill', skillNode(b))
    for (const t of s.similar ?? []) add(s.id, SM + 'similarTo', skillNode(t))
    for (const t of s.equivalent ?? []) add(s.id, SM + 'equivalentSkill', skillNode(t))
    if (s.caseSensitive) add(s.id, SM + 'caseSensitive', xsd('true', 'boolean'))
    if (s.description) add(s.id, SM + 'skillDescription', literal(s.description))
    add(s.id, SM + 'addedBy', literal(batch.reviewer))
    add(s.id, SM + 'addedOn', xsd(batch.reviewedAt, 'date'))
    if (s.evidencePostings !== undefined) add(s.id, SM + 'evidencePostings', xsd(String(s.evidencePostings), 'integer'))
  }
  for (const a of batch.newAliases ?? []) {
    for (const alias of a.aliases) add(a.skill, SM + 'skillAlias', literal(alias))
  }
  return quads
}
