import { beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { MemoryGraphStore } from '../lib/rdf/store'
import { ONTOLOGY_DIR, parseTurtle, readTurtleFile, SAMPLE_FILES, validateQuads } from '../lib/rdf/shacl'
import { SPARQL_QUERIES } from '../lib/rdf/sparql'
import { extractSkillIds, scoreJob } from '../lib/rdf/semantic-matcher'

const store = new MemoryGraphStore(ONTOLOGY_DIR, SAMPLE_FILES)
beforeAll(() => store.initialize())

const PREFIXES = `
@prefix sm: <http://skillmatch.org/ontology#> .
@prefix skill: <http://skillmatch.org/skill#> .
@prefix job: <http://skillmatch.org/job#> .
@prefix org: <http://skillmatch.org/org#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`

describe('SHACL validation', () => {
  it('accepts the bundled ontology and data', async () => {
    const report = await validateQuads(SAMPLE_FILES.flatMap((f) => readTurtleFile(f)))
    expect(report.violations).toEqual([])
    expect(report.valid).toBe(true)
  })

  it('rejects a job posting without a title or required skills', async () => {
    const report = await validateQuads(
      parseTurtle(`${PREFIXES}
        org:acme a sm:Organization ; sm:organizationName "Acme" .
        job:bad a sm:JobPosting ; sm:postedBy org:acme .`),
    )
    expect(report.valid).toBe(false)
    const paths = report.violations.map((v) => v.path)
    expect(paths).toContain('http://skillmatch.org/ontology#jobTitle')
    expect(report.violations.some((v) => /at least one skill or skill group/.test(v.message))).toBe(true)
  })

  it('accepts a job that only has an "any of" group, and rejects a one-member group', async () => {
    const job = (members: string) => parseTurtle(`${PREFIXES}
      org:acme a sm:Organization ; sm:organizationName "Acme" .
      job:g a sm:JobPosting ; sm:jobTitle "Cloud Engineer" ; sm:postedBy org:acme ;
        sm:jobDescription "Run our infrastructure on any major cloud provider, at scale." ;
        sm:requiresOneOf job:g-any-1 .
      job:g-any-1 a sm:SkillGroup ; sm:groupMember ${members} .`)
    const base = SAMPLE_FILES.slice(0, 2).flatMap((f) => readTurtleFile(f))
    expect((await validateQuads([...base, ...job('skill:aws, skill:gcp')])).valid).toBe(true)
    expect((await validateQuads([...base, ...job('skill:aws')])).valid).toBe(false)
  })

  it('rejects a skill that is similar to itself (SHACL-SPARQL constraint)', async () => {
    const report = await validateQuads(
      parseTurtle(`${PREFIXES}
        skill:loop a sm:Skill ; sm:skillName "Loop" ; sm:similarTo skill:loop .`),
    )
    expect(report.valid).toBe(false)
    expect(report.violations.some((v) => v.focusNode.endsWith('#loop') && /similar to itself/.test(v.message))).toBe(true)
  })

  it('refuses to load an invalid graph', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmatch-'))
    fs.copyFileSync(path.join(ONTOLOGY_DIR, 'skillmatch.owl.ttl'), path.join(dir, 'skillmatch.owl.ttl'))
    fs.writeFileSync(path.join(dir, 'bad.ttl'), `${PREFIXES} skill:nameless a sm:Skill .`)
    await expect(new MemoryGraphStore(dir, ['skillmatch.owl.ttl', 'bad.ttl']).initialize()).rejects.toThrow(/SHACL/)
  })
})

describe('skill reasoning', () => {
  it('scores exact, specialised and unrelated skills', async () => {
    expect((await store.areSkillsRelated('python', 'python')).type).toBe('exact')
    // PostgreSQL is a kind of SQL, so it satisfies a SQL requirement
    expect(await store.areSkillsRelated('postgresql', 'sql')).toMatchObject({ related: true, type: 'narrower' })
    // Knowing SQL in general only partly covers a PostgreSQL requirement
    expect(await store.areSkillsRelated('sql', 'postgresql')).toMatchObject({ related: true, type: 'broader' })
    expect((await store.areSkillsRelated('python', 'tableau')).related).toBe(false)
  })

  it('every skill referenced by a relation or job exists', async () => {
    const ids = new Set((await store.getAllSkills()).map((s) => s.id))
    for (const s of await store.getAllSkills()) {
      for (const ref of [...s.broaderSkills, ...s.narrowerSkills, ...s.similarSkills, ...s.equivalentSkills]) {
        expect(ids, `${s.id} -> ${ref}`).toContain(ref)
      }
    }
    for (const job of await store.getAllJobPostings()) {
      for (const ref of [...job.requiredSkills, ...(job.requiredGroups ?? []).flat()]) expect(ids, `${job.id} -> ${ref}`).toContain(ref)
    }
  })
})

describe('job scoring', () => {
  const job = {
    id: 'j',
    uri: 'job:j',
    title: 'Data Engineer',
    description: '',
    organization: 'Acme',
    requiredSkills: ['python', 'sql', 'spark', 'kubernetes'],
    preferredSkills: [],
  }

  it('takes the best match per requirement and normalises by requirement count', async () => {
    const names = new Map((await store.getAllSkills()).map((s) => [s.id, s.name]))
    const relate = (p: string, j: string) => store.areSkillsRelated(p, j)

    const { score, matchedSkills, missingSkills } = await scoreJob(job, ['python', 'postgresql', 'spark'], names, relate)

    // python 1.0 + sql via postgresql 0.85 + spark 1.0, kubernetes missing -> 2.85 / 4
    expect(score).toBe(71)
    expect(matchedSkills.map((m) => m.matchType).sort()).toEqual(['exact', 'exact', 'narrower'])
    expect(missingSkills).toEqual(['Kubernetes'])
  })

  it('counts an "any of" group as one requirement met by any member', async () => {
    const names = new Map((await store.getAllSkills()).map((s) => [s.id, s.name]))
    const relate = (p: string, j: string) => store.areSkillsRelated(p, j)
    const cloudJob = { ...job, requiredSkills: ['python'], requiredGroups: [['aws', 'gcp', 'azure']] }

    const gcpOnly = await scoreJob(cloudJob, ['python', 'gcp'], names, relate)
    expect(gcpOnly.score).toBe(100)
    expect(gcpOnly.matchedSkills.map((m) => m.jobSkillName)).toContain('AWS / GCP / Azure')

    const noCloud = await scoreJob(cloudJob, ['python'], names, relate)
    expect(noCloud.score).toBe(50)
    expect(noCloud.missingSkills).toEqual(['AWS / GCP / Azure'])
  })

  it('does not let one candidate skill inflate the score', async () => {
    const names = new Map<string, string>()
    const relate = (p: string, j: string) => store.areSkillsRelated(p, j)
    const once = await scoreJob(job, ['python'], names, relate)
    const repeated = await scoreJob(job, ['python', 'python', 'python'], names, relate)
    expect(repeated.score).toBe(once.score)
  })
})

describe('end-to-end on bundled data', () => {
  it('extracts skills from résumé-like text and ranks jobs', async () => {
    const skills = await store.getAllSkills()
    const ids = extractSkillIds('Jane Doe. Python, SQL, PostgreSQL, Pandas, Spark, AWS, Docker.', skills)
    expect(ids).toEqual(expect.arrayContaining(['python', 'sql', 'postgresql', 'pandas', 'spark', 'aws', 'docker']))
    // "Doe" must not be read as a skill
    expect(ids).not.toContain('experimental-design')
  })
})

describe('named SPARQL queries', () => {
  for (const [name, query] of Object.entries(SPARQL_QUERIES)) {
    it(`${name} runs on the in-memory store`, async () => {
      await expect(store.executeSPARQL(query)).resolves.toBeInstanceOf(Array)
    })
  }

  it('ALL_SKILLS returns rows', async () => {
    expect((await store.executeSPARQL(SPARQL_QUERIES.ALL_SKILLS)).length).toBeGreaterThan(50)
  })
})
