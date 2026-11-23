import { beforeAll, describe, expect, it } from 'vitest'
import { batchToQuads, ProposalBatch, validateBatch } from '../lib/graph/proposals'
import { findSkillCandidates, listItems } from '../lib/graph/candidates'
import { MemoryGraphStore } from '../lib/rdf/store'
import { BASE_ONTOLOGY_FILES, ONTOLOGY_DIR, readTurtleFile, validateQuads } from '../lib/rdf/shacl'
import { RDFSkill } from '../lib/rdf/types'
import { NormalizedJob } from '../lib/jobs/types'

let skills: RDFSkill[]
beforeAll(async () => {
  const store = new MemoryGraphStore(ONTOLOGY_DIR, BASE_ONTOLOGY_FILES)
  await store.initialize()
  skills = await store.getAllSkills()
})

const batch = (over: Partial<ProposalBatch> = {}): ProposalBatch => ({
  reviewedAt: '2026-11-19',
  reviewer: 'test',
  newSkills: [
    { id: 'terraform-test', name: 'Terraform Test', aliases: ['tf test'], broader: ['devops'], evidencePostings: 12 },
  ],
  ...over,
})

const messages = (b: ProposalBatch) => validateBatch(b, skills).map((i) => i.message).join('\n')

describe('validateBatch', () => {
  it('accepts a well-formed batch', () => {
    expect(validateBatch(batch(), skills)).toEqual([])
  })

  it('rejects ids and names that already exist', () => {
    expect(messages(batch({ newSkills: [{ id: 'python', name: 'Py2', broader: ['programming-languages'] }] }))).toMatch(/id already exists/)
    expect(messages(batch({ newSkills: [{ id: 'py-new', name: 'Python', broader: ['programming-languages'] }] }))).toMatch(/already used by skill "python"/)
  })

  it('rejects aliases that collide with another skill', () => {
    const b = batch({ newSkills: [{ id: 'x-lang', name: 'X Lang', aliases: ['postgres'], broader: ['programming-languages'] }] })
    expect(messages(b)).toMatch(/"postgres" is already used by skill "postgresql"/)
  })

  it('requires ordinary words to be case-sensitive names', () => {
    const plain = batch({ newSkills: [{ id: 'go', name: 'Go', broader: ['programming-languages'] }] })
    expect(messages(plain)).toMatch(/ordinary word/)
    const cs = batch({ newSkills: [{ id: 'go', name: 'Go', caseSensitive: true, aliases: ['golang'], broader: ['programming-languages'] }] })
    expect(validateBatch(cs, skills)).toEqual([])
  })

  it('requires a broader skill and existing relation targets', () => {
    expect(messages(batch({ newSkills: [{ id: 'lonely', name: 'Lonely Skill', broader: [] }] }))).toMatch(/at least one broader/)
    expect(messages(batch({ newSkills: [{ id: 'orphan', name: 'Orphan Skill', broader: ['nope'] }] }))).toMatch(/"nope" does not exist/)
  })

  it('allows relations to skills added in the same batch', () => {
    const b = batch({
      newSkills: [
        { id: 'stream-x', name: 'Stream X', broader: ['data-engineering'] },
        { id: 'stream-y', name: 'Stream Y', broader: ['stream-x'], similar: ['stream-x'] },
      ],
    })
    expect(validateBatch(b, skills)).toEqual([])
  })

  it('checks alias additions to existing skills', () => {
    expect(validateBatch(batch({ newAliases: [{ skill: 'rag', aliases: ['retrieval augmented generation'] }] }), skills)).toEqual([])
    expect(messages(batch({ newAliases: [{ skill: 'missing', aliases: ['x y'] }] }))).toMatch(/skill does not exist/)
  })

  it('produces SHACL-valid RDF with provenance', async () => {
    const quads = batchToQuads(batch())
    expect(quads.some((q) => q.predicate.value.endsWith('#addedBy'))).toBe(true)
    const report = await validateQuads([...BASE_ONTOLOGY_FILES.flatMap((f) => readTurtleFile(f)), ...quads])
    expect(report.violations).toEqual([])
  })
})

describe('candidate finder', () => {
  it('splits requirement lists into items', () => {
    expect(listItems('• Experience with Python, Airflow, or dbt (preferred)')).toEqual(['Python', 'Airflow', 'dbt'])
  })

  it('finds unknown items listed next to known skills across companies', () => {
    const job = (id: string, company: string, line: string): NormalizedJob => ({
      id, source: 'greenhouse', sourceId: id, company: { name: company, board: 'greenhouse', slug: company },
      title: 'Data Engineer', isRemote: false, url: 'https://example.com', description: `Requirements\n• ${line}`,
    })
    const jobs = [
      job('1', 'a', 'Python, SQL and Airflow'),
      job('2', 'b', 'Spark or Airflow'),
      job('3', 'a', 'Airflow, Kafka, Python'),
      job('4', 'c', 'Great Communication, Teamwork'), // no known skill in the list
    ]
    const found = findSkillCandidates(jobs, skills, { minPostings: 2 })
    expect(found.map((c) => c.term)).toEqual(['Airflow'])
    expect(found[0]).toMatchObject({ postings: 3, companies: 2 })
  })
})

describe('candidate finder memory', () => {
  it('skips terms rejected in earlier reviews', () => {
    const job = (id: string, company: string): NormalizedJob => ({
      id, source: 'greenhouse', sourceId: id, company: { name: company, board: 'greenhouse', slug: company },
      title: 'Engineer', isRemote: false, url: 'https://example.com', description: 'Requirements\n• Python, SQL, YouTube',
    })
    const jobs = [job('1', 'a'), job('2', 'b')]
    expect(findSkillCandidates(jobs, skills, { minPostings: 2 }).map((c) => c.term)).toEqual(['YouTube'])
    expect(findSkillCandidates(jobs, skills, { minPostings: 2, alreadyReviewed: ['youtube'] })).toEqual([])
  })
})
