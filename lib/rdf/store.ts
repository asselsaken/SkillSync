/**
 * In-memory RDF graph store (default backend).
 *
 * - N3.Store for fast triple lookups used by the matcher
 * - Oxigraph (WASM) for real SPARQL 1.1 queries
 * - SHACL validation of all data on load
 *
 * Needs no external services, so it runs anywhere (local, Vercel, CI).
 */

import * as N3 from 'n3'
import * as oxigraph from 'oxigraph'
import { GraphStore, SkillRelation, SparqlRow } from './graph-store'
import { dataFiles, ONTOLOGY_DIR, readTurtleFile, validateQuads } from './shacl'
import { MATCH_TYPE_WEIGHTS, PREFIXES, RDFJobPosting, RDFOrganization, RDFPerson, RDFSkill } from './types'

const { namedNode } = N3.DataFactory

const SM = PREFIXES.sm
const TRANSITIVE_NARROWER_WEIGHT = 0.7
const MAX_SPARQL_ROWS = 1000

const stripPrefix = (uri: string, prefix: string) => (uri.startsWith(prefix) ? uri.slice(prefix.length) : uri)

export class MemoryGraphStore implements GraphStore {
  readonly backend = 'memory' as const
  private store = new N3.Store()
  private sparqlStore: oxigraph.Store | null = null
  private initialized = false
  private skillsCache: RDFSkill[] | null = null
  private jobsCache: RDFJobPosting[] | null = null

  /**
   * @param validate Run SHACL on load. Defaults to on, except in production
   *   where `npm run validate` already checked the same files at build time
   *   (it takes several seconds of cold start). SKILLMATCH_VALIDATE_ON_LOAD=1 forces it.
   */
  constructor(
    private readonly dataDir: string = ONTOLOGY_DIR,
    private readonly files: string[] = dataFiles(dataDir),
    private readonly validate: boolean = process.env.NODE_ENV !== 'production' || process.env.SKILLMATCH_VALIDATE_ON_LOAD === '1',
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return

    const quads = this.files.flatMap((file) => readTurtleFile(file, this.dataDir))

    if (this.validate) {
      const report = await validateQuads(quads)
      if (!report.valid) {
        const summary = report.violations
          .slice(0, 5)
          .map((v) => `${v.focusNode} ${v.path}: ${v.message}`)
          .join('\n  ')
        throw new Error(`SHACL validation failed (${report.violations.length} violations):\n  ${summary}`)
      }
    }

    this.store = new N3.Store(quads)
    this.initialized = true
    console.log(`In-memory RDF store loaded ${this.store.size} triples${this.validate ? ' (SHACL valid)' : ' (validated at build time)'}`)
  }

  // ---------------------------------------------------------------- helpers

  private values(subject: string, predicate: string): string[] {
    return this.store.getObjects(namedNode(subject), namedNode(predicate), null).map((o) => o.value)
  }

  private value(subject: string, predicate: string): string | undefined {
    return this.values(subject, predicate)[0]
  }

  private subjectsOfType(type: string): string[] {
    return this.store.getSubjects(namedNode(PREFIXES.rdf + 'type'), namedNode(type), null).map((s) => s.value)
  }

  private skillIds(subject: string, predicate: string): string[] {
    return this.values(subject, predicate).map((u) => stripPrefix(u, PREFIXES.skill))
  }

  // ---------------------------------------------------------------- entities

  async getAllSkills(): Promise<RDFSkill[]> {
    if (!this.skillsCache) {
      this.skillsCache = this.subjectsOfType(SM + 'Skill').map((uri) => {
        const id = stripPrefix(uri, PREFIXES.skill)
        return {
          id,
          uri,
          name: this.value(uri, SM + 'skillName') ?? id,
          aliases: this.values(uri, SM + 'skillAlias'),
          broaderSkills: this.skillIds(uri, SM + 'broaderSkill'),
          narrowerSkills: this.skillIds(uri, SM + 'narrowerSkill'),
          similarSkills: this.skillIds(uri, SM + 'similarTo'),
          equivalentSkills: this.skillIds(uri, SM + 'equivalentSkill'),
          caseSensitive: this.value(uri, SM + 'caseSensitive') === 'true',
          isCategory: this.store.has(N3.DataFactory.quad(namedNode(uri), namedNode(PREFIXES.rdf + 'type'), namedNode(SM + 'SkillCategory'))),
        }
      })
    }
    return this.skillsCache
  }

  async getSkill(idOrName: string): Promise<RDFSkill | undefined> {
    const needle = idOrName.toLowerCase().trim()
    return (await this.getAllSkills()).find(
      (s) =>
        s.id.toLowerCase() === needle ||
        s.name.toLowerCase() === needle ||
        s.aliases.some((a) => a.toLowerCase() === needle),
    )
  }

  async getAllJobPostings(): Promise<RDFJobPosting[]> {
    if (this.jobsCache) return this.jobsCache
    const orgNames = new Map<string, string>()
    this.jobsCache = this.subjectsOfType(SM + 'JobPosting').map((uri) => {
      const orgUri = this.value(uri, SM + 'postedBy') ?? ''
      if (!orgNames.has(orgUri)) {
        orgNames.set(orgUri, this.value(orgUri, SM + 'organizationName') ?? stripPrefix(orgUri, PREFIXES.org))
      }
      const remote = this.value(uri, SM + 'isRemote')
      return {
        id: stripPrefix(uri, PREFIXES.job),
        uri,
        title: this.value(uri, SM + 'jobTitle') ?? uri,
        description: this.value(uri, SM + 'jobDescription') ?? '',
        location: this.value(uri, SM + 'location'),
        url: this.value(uri, SM + 'jobUrl'),
        organization: orgNames.get(orgUri) ?? '',
        requiredSkills: this.skillIds(uri, SM + 'requiresSkill'),
        requiredGroups: this.values(uri, SM + 'requiresOneOf').map((g) => this.skillIds(g, SM + 'groupMember')),
        preferredSkills: this.skillIds(uri, SM + 'prefersSkill'),
        datePosted: this.value(uri, SM + 'datePosted'),
        applyUrl: this.value(uri, SM + 'applyUrl'),
        isRemote: remote === undefined ? undefined : remote === 'true',
        department: this.value(uri, SM + 'department'),
        employmentType: this.value(uri, SM + 'employmentType'),
        salary: this.value(uri, SM + 'salary'),
        source: this.value(uri, SM + 'jobSource'),
      }
    })
    return this.jobsCache
  }

  async getAllPeople(): Promise<RDFPerson[]> {
    return this.subjectsOfType(SM + 'Person').map((uri) => ({
      id: stripPrefix(uri, PREFIXES.person),
      uri,
      name: this.value(uri, SM + 'personName') ?? uri,
      email: this.value(uri, SM + 'email'),
      skills: this.skillIds(uri, SM + 'hasSkill'),
      resumeText: this.value(uri, SM + 'resumeText'),
    }))
  }

  async getAllOrganizations(): Promise<RDFOrganization[]> {
    return this.subjectsOfType(SM + 'Organization').map((uri) => ({
      id: stripPrefix(uri, PREFIXES.org),
      uri,
      name: this.value(uri, SM + 'organizationName') ?? uri,
    }))
  }

  // ---------------------------------------------------------------- reasoning

  /**
   * How does a candidate's skill relate to a job's required skill?
   * Relations are read in both directions so symmetric/inverse properties
   * work even when the data only states one side.
   */
  async areSkillsRelated(personSkillId: string, jobSkillId: string): Promise<SkillRelation> {
    if (personSkillId === jobSkillId) return { related: true, type: 'exact', weight: MATCH_TYPE_WEIGHTS.exact }

    const p = PREFIXES.skill + personSkillId
    const j = PREFIXES.skill + jobSkillId
    const has = (s: string, pred: string, o: string) => this.store.has(N3.DataFactory.quad(namedNode(s), namedNode(SM + pred), namedNode(o)))

    if (has(p, 'equivalentSkill', j) || has(j, 'equivalentSkill', p)) {
      return { related: true, type: 'equivalent', weight: MATCH_TYPE_WEIGHTS.equivalent }
    }
    // Candidate's skill is a specialisation of the requirement (e.g. PostgreSQL -> SQL)
    if (has(p, 'broaderSkill', j) || has(j, 'narrowerSkill', p)) {
      return { related: true, type: 'narrower', weight: MATCH_TYPE_WEIGHTS.narrower }
    }
    if (has(p, 'similarTo', j) || has(j, 'similarTo', p)) {
      return { related: true, type: 'similar', weight: MATCH_TYPE_WEIGHTS.similar }
    }
    // Candidate's skill is more general than the requirement
    if (has(p, 'narrowerSkill', j) || has(j, 'broaderSkill', p)) {
      return { related: true, type: 'broader', weight: MATCH_TYPE_WEIGHTS.broader }
    }
    // Two-level specialisation (e.g. Django -> Python -> Programming)
    for (const parent of this.values(p, SM + 'broaderSkill')) {
      if (has(parent, 'broaderSkill', j)) {
        return { related: true, type: 'narrower', weight: TRANSITIVE_NARROWER_WEIGHT }
      }
    }
    return { related: false, type: 'none', weight: 0 }
  }

  // ---------------------------------------------------------------- SPARQL

  async executeSPARQL(query: string): Promise<SparqlRow[]> {
    if (!this.initialized) throw new Error('Store not initialized')
    // Built on first use: résumé matching never needs the SPARQL engine.
    if (!this.sparqlStore) this.sparqlStore = new oxigraph.Store(this.store.getQuads(null, null, null, null) as unknown as oxigraph.Quad[])
    const result = this.sparqlStore.query(query)

    if (typeof result === 'boolean') return [{ result: String(result) }]
    if (typeof result === 'string') return [{ result }]

    const rows: SparqlRow[] = []
    for (const item of result as Iterable<Map<string, oxigraph.Term> | oxigraph.Quad>) {
      if (rows.length >= MAX_SPARQL_ROWS) break
      if (item instanceof Map) {
        const row: SparqlRow = {}
        item.forEach((term, name) => (row[name] = term.value))
        rows.push(row)
      } else {
        rows.push({ subject: item.subject.value, predicate: item.predicate.value, object: item.object.value })
      }
    }
    return rows
  }

  async tripleCount(): Promise<number> {
    return this.store.size
  }
}

export const memoryStore = new MemoryGraphStore()
