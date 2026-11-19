/**
 * Skill tagging and RDF serialisation for fetched jobs.
 */

import * as N3 from 'n3'
import { extractSkillIds } from '../rdf/semantic-matcher'
import { PREFIXES, RDFSkill } from '../rdf/types'
import { EnrichedJob, NormalizedJob } from './types'
import { analyseRequirements } from './groups'
import { roleExcerpt, splitSections, truncate } from './text'

const { namedNode, literal, quad } = N3.DataFactory
const SM = PREFIXES.sm
const XSD = PREFIXES.xsd

/** Description length kept in the graph (the full text stays on the job board). */
export const STORED_DESCRIPTION_LENGTH = 800
const TITLE_MAX_LENGTH = 200
const LOCATION_MAX_LENGTH = 200

/**
 * Tag a job with ontology skills. Skills found in "nice to have" sections are
 * preferred; skills in the rest of the posting are required. Benefits and
 * company boilerplate are ignored, and so are broad skill categories and the
 * employer's own product name.
 */
export function tagSkills(job: NormalizedJob, allSkills: RDFSkill[]): EnrichedJob {
  // Categories ("Artificial Intelligence", "Databases") appear in almost every posting's
  // boilerplate. Concrete skills already reach their category through the graph.
  // A company's own product name in its own postings ("Datadog" at Datadog) is not a requirement.
  const company = job.company.name.toLowerCase()
  const skills = allSkills.filter((s) => !s.isCategory && !company.startsWith(s.name.toLowerCase()))
  const { required, preferred } = splitSections(job.description)
  const { singles, groups } = analyseRequirements(`${job.title}\n${required}`, skills)
  const requiredSet = new Set([...singles, ...groups.flat()])
  const preferredSkills = extractSkillIds(preferred, skills).filter((id) => !requiredSet.has(id))

  // A posting must require at least one skill; if everything was "nice to have", promote it.
  if (singles.length === 0 && groups.length === 0 && preferredSkills.length > 0) {
    return { ...job, requiredSkills: preferredSkills, requiredGroups: [], preferredSkills: [] }
  }
  return { ...job, requiredSkills: singles, requiredGroups: groups, preferredSkills }
}

const orgUri = (slug: string) => namedNode(PREFIXES.org + slug)
const jobUri = (id: string) => namedNode(PREFIXES.job + id)
const skillUri = (id: string) => namedNode(PREFIXES.skill + id)
const str = (s: string) => literal(s)
const typed = (s: string, type: string) => literal(s, namedNode(XSD + type))

/** Build RDF quads for a set of jobs and the organisations that posted them. */
export function jobsToQuads(jobs: EnrichedJob[]): N3.Quad[] {
  const quads: N3.Quad[] = []
  const add = (s: N3.NamedNode, p: string, o: N3.Term) => quads.push(quad(s, namedNode(p), o as N3.Quad_Object))
  const seenOrgs = new Set<string>()

  for (const job of jobs) {
    const org = orgUri(job.company.slug)
    if (!seenOrgs.has(job.company.slug)) {
      seenOrgs.add(job.company.slug)
      add(org, PREFIXES.rdf + 'type', namedNode(SM + 'Organization'))
      add(org, SM + 'organizationName', str(job.company.name))
    }

    const s = jobUri(job.id)
    add(s, PREFIXES.rdf + 'type', namedNode(SM + 'JobPosting'))
    add(s, SM + 'jobTitle', str(truncate(job.title, TITLE_MAX_LENGTH)))
    // Store the part about the role (not the company intro); the full text stays on the job board.
    add(s, SM + 'jobDescription', str(truncate(roleExcerpt(job.description), STORED_DESCRIPTION_LENGTH)))
    add(s, SM + 'postedBy', org)
    add(s, SM + 'jobSource', str(job.source))
    add(s, SM + 'jobUrl', typed(job.url, 'anyURI'))
    add(s, SM + 'isRemote', typed(String(job.isRemote), 'boolean'))
    if (job.applyUrl) add(s, SM + 'applyUrl', typed(job.applyUrl, 'anyURI'))
    if (job.location) add(s, SM + 'location', str(truncate(job.location, LOCATION_MAX_LENGTH)))
    if (job.department) add(s, SM + 'department', str(job.department))
    if (job.employmentType) add(s, SM + 'employmentType', str(job.employmentType))
    if (job.datePosted) add(s, SM + 'datePosted', typed(job.datePosted, 'date'))
    if (job.salary) add(s, SM + 'salary', str(job.salary))
    for (const id of job.requiredSkills) add(s, SM + 'requiresSkill', skillUri(id))
    job.requiredGroups.forEach((members, i) => {
      const group = jobUri(`${job.id}--any-${i + 1}`)
      add(s, SM + 'requiresOneOf', group)
      add(group, PREFIXES.rdf + 'type', namedNode(SM + 'SkillGroup'))
      for (const id of members) add(group, SM + 'groupMember', skillUri(id))
    })
    for (const id of job.preferredSkills) add(s, SM + 'prefersSkill', skillUri(id))
  }
  return quads
}

/** Serialise quads to Turtle with the SkillMatch prefixes and an optional header comment. */
export function quadsToTurtle(quads: N3.Quad[], header = ''): Promise<string> {
  const writer = new N3.Writer({
    prefixes: { sm: SM, skill: PREFIXES.skill, job: PREFIXES.job, org: PREFIXES.org, xsd: XSD },
  })
  writer.addQuads(quads)
  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(header + result))),
  )
}
