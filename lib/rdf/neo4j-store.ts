/**
 * Neo4j RDF Store
 * 
 * Provides RDF triple storage using Neo4j graph database with SPARQL support
 * Uses neosemantics (n10s) plugin for RDF/SPARQL capabilities
 * Falls back to Cypher queries if neosemantics is not available
 */

import neo4j, { Driver, Session } from 'neo4j-driver'
import * as fs from 'fs'
import * as path from 'path'
import * as N3 from 'n3'
import { PREFIXES, RDFSkill, RDFJobPosting, RDFPerson, RDFOrganization, ValidationResult } from './types'
import rdfValidate from 'rdf-validate-shacl'

const { DataFactory } = N3
const { namedNode, literal } = DataFactory

class Neo4jRDFStore {
  private driver: Driver | null = null
  private initialized: boolean = false
  private useNeoSemantics: boolean = false
  private shaclValidator: any | null = null

  constructor() {
    // Neo4j connection configuration from environment variables
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687'
    const user = process.env.NEO4J_USER || 'neo4j'
    const password = process.env.NEO4J_PASSWORD || 'password'

    try {
      this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password))
    } catch (error) {
      console.warn('Neo4j driver initialization failed:', error)
      console.warn('Falling back to in-memory N3 store')
    }
  }

  /**
   * Initialize the Neo4j store by loading RDF data and setting up neosemantics
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    if (!this.driver) {
      throw new Error('Neo4j driver not initialized. Please set NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD environment variables.')
    }

    const session = this.driver.session()

    try {
      // Check if neosemantics plugin is available
      const neoSemanticsCheck = await session.run(
        'SHOW PROCEDURES YIELD name WHERE name STARTS WITH "n10s" RETURN count(*) as count'
      )
      
      if (neoSemanticsCheck.records[0]?.get('count').toNumber() > 0) {
        this.useNeoSemantics = true
        await this.initializeNeoSemantics(session)
      } else {
        console.warn('neosemantics (n10s) plugin not found. Using Cypher-based RDF storage.')
        this.useNeoSemantics = false
        await this.initializeCypherRDF(session)
      }

      // Load SHACL shapes for validation
      await this.loadSHACLShapes()

      // Load RDF data files
      await this.loadRDFData(session)

      this.initialized = true
      console.log('Neo4j RDF Store initialized successfully')
    } catch (error) {
      console.error('Failed to initialize Neo4j store:', error)
      throw error
    } finally {
      await session.close()
    }
  }

  /**
   * Initialize neosemantics plugin
   */
  private async initializeNeoSemantics(session: Session): Promise<void> {
    // Create graph configuration
    await session.run(`
      CALL n10s.graphconfig.init({
        handleVocabUris: 'KEEP',
        handleRDFTypes: 'LABELS_AND_NODES',
        handleMultival: 'ARRAY'
      })
    `).catch(() => {
      // Graph might already be initialized
    })

    console.log('neosemantics plugin initialized')
  }

  /**
   * Initialize Cypher-based RDF storage (fallback)
   */
  private async initializeCypherRDF(session: Session): Promise<void> {
    // Create indexes for better performance
    await session.run(`
      CREATE INDEX IF NOT EXISTS FOR (n:Resource) ON (n.uri)
    `).catch(() => {})

    await session.run(`
      CREATE INDEX IF NOT EXISTS FOR ()-[r:TRIPLE]->() ON (r.predicate)
    `).catch(() => {})

    console.log('Cypher-based RDF storage initialized')
  }

  /**
   * Load SHACL shapes for validation
   */
  private async loadSHACLShapes(): Promise<void> {
    try {
      const shaclPath = path.join(process.cwd(), 'ontology', 'skillmatch.shacl.ttl')
      if (fs.existsSync(shaclPath)) {
        const shaclContent = fs.readFileSync(shaclPath, 'utf-8')
        const parser = new N3.Parser()
        const quads: N3.Quad[] = []
        
        return new Promise<void>((resolve, reject) => {
          parser.parse(shaclContent, (error, quad) => {
            if (error) {
              reject(error)
            } else if (quad) {
              quads.push(quad)
            } else {
              // End of parsing
              const store = new N3.Store(quads)
              const { Validator } = rdfValidate as unknown as { Validator: new (shapes: N3.Store) => any }
              this.shaclValidator = Validator ? new Validator(store) : null
              console.log('SHACL shapes loaded for validation')
              resolve()
            }
          })
        })
      }
    } catch (error) {
      console.warn('Failed to load SHACL shapes:', error)
    }
  }

  /**
   * Load RDF data files into Neo4j
   */
  private async loadRDFData(session: Session): Promise<void> {
    const ontologyDir = path.join(process.cwd(), 'ontology')
    const files = [
      'skillmatch.owl.ttl',
      'skills.rdf.ttl',
      'sample-data.rdf.ttl'
    ]

    for (const file of files) {
      const filePath = path.join(ontologyDir, file)
      if (fs.existsSync(filePath)) {
        await this.loadTurtleFile(session, filePath)
      }
    }
  }

  /**
   * Load a Turtle file into Neo4j
   */
  private async loadTurtleFile(session: Session, filePath: string): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf-8')

    if (this.useNeoSemantics) {
      // Use neosemantics to import RDF
      await session.run(`
        CALL n10s.rdf.import.fetch($url, "Turtle", {
          handleVocabUris: 'KEEP',
          handleRDFTypes: 'LABELS_AND_NODES'
        })
      `, { url: `file://${filePath}` }).catch(async () => {
        // If file:// doesn't work, try inline import
        await session.run(`
          CALL n10s.rdf.import.inline($content, "Turtle", {
            handleVocabUris: 'KEEP',
            handleRDFTypes: 'LABELS_AND_NODES'
          })
        `, { content })
      })
    } else {
      // Parse and load using Cypher
      await this.loadTriplesFromTurtle(session, content)
    }
  }

  /**
   * Load triples from Turtle content using Cypher (fallback)
   */
  private async loadTriplesFromTurtle(session: Session, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parser = new N3.Parser()
      const triples: Array<{ s: string; p: string; o: string; oType: 'uri' | 'literal' }> = []

      parser.parse(content, (error, quad) => {
        if (error) {
          reject(error)
        } else if (quad) {
          const objValue = quad.object.value
          const objType = quad.object.termType === 'Literal' ? 'literal' : 'uri'
          triples.push({
            s: quad.subject.value,
            p: quad.predicate.value,
            o: objValue,
            oType: objType
          })
        } else {
          // End of parsing - load into Neo4j
          this.insertTriplesCypher(session, triples).then(resolve).catch(reject)
        }
      })
    })
  }

  /**
   * Insert triples into Neo4j using Cypher
   */
  private async insertTriplesCypher(session: Session, triples: Array<{ s: string; p: string; o: string; oType: 'uri' | 'literal' }>): Promise<void> {
    // Batch insert for performance
    const batchSize = 1000
    for (let i = 0; i < triples.length; i += batchSize) {
      const batch = triples.slice(i, i + batchSize)
      
      await session.run(`
        UNWIND $triples AS triple
        MERGE (s:Resource {uri: triple.s})
        MERGE (o:Resource {uri: triple.o})
        CREATE (s)-[:TRIPLE {predicate: triple.p, objectType: triple.oType}]->(o)
      `, { triples: batch })
    }
  }

  /**
   * Execute a SPARQL query
   */
  async executeSPARQL(sparqlQuery: string): Promise<any[]> {
    if (!this.driver) throw new Error('Neo4j driver not initialized')
    const session = this.driver.session()
    try {
      if (this.useNeoSemantics) {
        const res = await session.run(
          'CALL n10s.rdf.sparql($query) YIELD result RETURN result',
          { query: sparqlQuery }
        )
        return res.records.map(r => r.get('result'))
      }

      console.warn('SPARQL endpoint not available; using limited Cypher fallback')
      return await this.executeSPARQLViaCypher(session, sparqlQuery)
    } finally {
      await session.close()
    }
  }

  /**
   * Execute SPARQL query via Cypher translation (simplified)
   */
  private async executeSPARQLViaCypher(session: Session, sparqlQuery: string): Promise<any[]> {
    // This is a simplified SPARQL to Cypher translator
    // For production, consider using a proper SPARQL parser
    
    // Extract SELECT variables and WHERE clause
    const selectMatch = sparqlQuery.match(/SELECT\s+(.+?)\s+WHERE/i)
    if (!selectMatch) {
      throw new Error('Invalid SPARQL query format')
    }

    const normalized = sparqlQuery.toLowerCase()

    // Fallback for skill hierarchy query
    if (normalized.includes('broaderskill') && normalized.includes('skillname')) {
      const skills = await this.getAllSkills()
      const skillMap = new Map(skills.map(s => [s.id, s.name]))

      const rows: any[] = []
      for (const skill of skills) {
        for (const broader of skill.broaderSkills) {
          rows.push({
            parent: `${PREFIXES.skill}${broader}`,
            child: `${PREFIXES.skill}${skill.id}`,
            parentName: skillMap.get(broader) || broader,
            childName: skill.name
          })
        }
      }
      return rows
    }

    // For now, return empty for unsupported patterns
    return []
  }

  /**
   * Validate RDF data against SHACL shapes
   */
  async validateData(dataQuads: N3.Quad[]): Promise<ValidationResult> {
    if (!this.shaclValidator) {
      return { valid: true, violations: [] }
    }

    const dataStore = new N3.Store(dataQuads)
    const report = this.shaclValidator.validate(dataStore)

    return {
      valid: report.conforms,
      violations: report.results.map((result: any) => ({
        focusNode: result.focusNode?.value || '',
        path: result.path?.value || '',
        message: result.message[0]?.value || 'Validation error',
        severity: (result.severity?.value || 'http://www.w3.org/ns/shacl#Violation').includes('Violation') 
          ? 'Violation' as const 
          : (result.severity?.value || '').includes('Warning') 
            ? 'Warning' as const 
            : 'Info' as const
      }))
    }
  }

  /**
   * Get all skills using SPARQL
   */
  async getAllSkills(): Promise<RDFSkill[]> {
    const SKILL_LABEL = `${PREFIXES.sm}Skill`
    const NAME_PROP = `${PREFIXES.sm}skillName`
    const ALIAS_PROP = `${PREFIXES.sm}skillAlias`
    const BROADER_REL = `${PREFIXES.sm}broaderSkill`
    const NARROWER_REL = `${PREFIXES.sm}narrowerSkill`
    const SIMILAR_REL = `${PREFIXES.sm}similarTo`
    const EQUIV_REL = `${PREFIXES.sm}equivalentSkill`

    if (!this.driver) throw new Error('Neo4j driver not initialized')
    const session = this.driver.session()
    try {
      const result = await session.run(
        `
        MATCH (s:\`${SKILL_LABEL}\`)
        OPTIONAL MATCH (s)-[:\`${BROADER_REL}\`]->(b)
        OPTIONAL MATCH (s)-[:\`${NARROWER_REL}\`]->(n)
        OPTIONAL MATCH (s)-[:\`${SIMILAR_REL}\`]->(sim)
        OPTIONAL MATCH (s)-[:\`${EQUIV_REL}\`]->(eq)
        RETURN s.uri AS uri,
               s.\`${NAME_PROP}\` AS name,
               s.\`${ALIAS_PROP}\` AS aliases,
               collect(DISTINCT b.uri) AS broaderUris,
               collect(DISTINCT n.uri) AS narrowerUris,
               collect(DISTINCT sim.uri) AS similarUris,
               collect(DISTINCT eq.uri) AS equivalentUris
        `
      )

      return result.records.map(rec => {
        const uri = rec.get('uri') as string
        return {
          id: uri.replace(PREFIXES.skill, ''),
          uri,
          name: (rec.get('name') as string[] | string)?.[0] || (rec.get('name') as string) || uri,
          aliases: ((rec.get('aliases') as string[] | null) || []) as string[],
          broaderSkills: (rec.get('broaderUris') as string[]).map(u => u?.replace(PREFIXES.skill, '')).filter(Boolean),
          narrowerSkills: (rec.get('narrowerUris') as string[]).map(u => u?.replace(PREFIXES.skill, '')).filter(Boolean),
          similarSkills: (rec.get('similarUris') as string[]).map(u => u?.replace(PREFIXES.skill, '')).filter(Boolean),
          equivalentSkills: (rec.get('equivalentUris') as string[]).map(u => u?.replace(PREFIXES.skill, '')).filter(Boolean),
        }
      })
    } finally {
      await session.close()
    }
  }

  /**
   * Get all job postings using SPARQL
   */
  async getAllJobPostings(): Promise<RDFJobPosting[]> {
    const JOB_LABEL = `${PREFIXES.sm}JobPosting`
    const ORG_LABEL = `${PREFIXES.sm}Organization`
    const TITLE_PROP = `${PREFIXES.sm}jobTitle`
    const DESC_PROP = `${PREFIXES.sm}jobDescription`
    const LOC_PROP = `${PREFIXES.sm}location`
    const URL_PROP = `${PREFIXES.sm}jobUrl`
    const DATE_PROP = `${PREFIXES.sm}datePosted`
    const ORG_NAME_PROP = `${PREFIXES.sm}organizationName`
    const POSTED_BY = `${PREFIXES.sm}postedBy`
    const REQUIRES = `${PREFIXES.sm}requiresSkill`
    const PREFERS = `${PREFIXES.sm}prefersSkill`

    if (!this.driver) throw new Error('Neo4j driver not initialized')
    const session = this.driver.session()
    try {
      const result = await session.run(
        `
        MATCH (j:\`${JOB_LABEL}\`)
        OPTIONAL MATCH (j)-[:\`${POSTED_BY}\`]->(org:\`${ORG_LABEL}\`)
        OPTIONAL MATCH (j)-[:\`${REQUIRES}\`]->(req)
        OPTIONAL MATCH (j)-[:\`${PREFERS}\`]->(pref)
        RETURN j.uri AS uri,
               j.\`${TITLE_PROP}\` AS title,
               j.\`${DESC_PROP}\` AS description,
               j.\`${LOC_PROP}\` AS location,
               j.\`${URL_PROP}\` AS url,
               j.\`${DATE_PROP}\` AS datePosted,
               org.\`${ORG_NAME_PROP}\` AS orgName,
               collect(DISTINCT req.uri) AS requiredUris,
               collect(DISTINCT pref.uri) AS preferredUris
        `
      )

      return result.records.map(rec => {
        const uri = rec.get('uri') as string
        return {
          id: uri.replace(PREFIXES.job, ''),
          uri,
          title: (rec.get('title') as string[] | string)?.[0] || (rec.get('title') as string) || uri,
          description: (rec.get('description') as string[] | string)?.[0] || (rec.get('description') as string) || '',
          location: (rec.get('location') as string[] | string)?.[0] || (rec.get('location') as string) || undefined,
          url: (rec.get('url') as string[] | string)?.[0] || (rec.get('url') as string) || undefined,
          datePosted: (rec.get('datePosted') as string[] | string)?.[0] || (rec.get('datePosted') as string) || undefined,
          organization: ((rec.get('orgName') as string[] | string)?.[0] || (rec.get('orgName') as string) || '').toString(),
          requiredSkills: (rec.get('requiredUris') as string[]).map(u => u?.replace(PREFIXES.skill, '')).filter(Boolean),
          preferredSkills: (rec.get('preferredUris') as string[]).map(u => u?.replace(PREFIXES.skill, '')).filter(Boolean),
        }
      })
    } finally {
      await session.close()
    }
  }

  /**
   * Match person skills to jobs using SPARQL
   */
  async matchPersonToJobs(personSkillIds: string[]): Promise<any[]> {
    const skills = await this.getAllSkills()
    const jobs = await this.getAllJobPostings()
    const skillMap = new Map(skills.map(s => [s.id, s]))

    const matches: {
      job: RDFJobPosting
      matchType: string
      personSkillId: string
      jobSkillId: string
      personSkillName: string
      jobSkillName: string
      weight: number
    }[] = []

    for (const job of jobs) {
      for (const personSkillId of personSkillIds) {
        for (const jobSkillId of job.requiredSkills) {
          const relation = await this.areSkillsRelated(personSkillId, jobSkillId)
          if (relation.related) {
            const personSkill = skillMap.get(personSkillId)
            const jobSkill = skillMap.get(jobSkillId)
            if (personSkill && jobSkill) {
              matches.push({
                job,
                matchType: relation.type,
                personSkillId,
                jobSkillId,
                personSkillName: personSkill.name,
                jobSkillName: jobSkill.name,
                weight: relation.weight,
              })
            }
          }
        }
      }
    }

    // Format similar to SPARQL results
    return matches.map(m => ({
      job: { value: PREFIXES.job + m.job.id },
      title: m.job.title,
      org: m.job.organization,
      matchType: m.matchType,
      personSkill: { value: PREFIXES.skill + m.personSkillId },
      jobSkill: { value: PREFIXES.skill + m.jobSkillId },
      personSkillName: m.personSkillName,
      jobSkillName: m.jobSkillName,
    }))
  }

  /**
   * Check if two skills are related using SPARQL
   */
  async areSkillsRelated(skill1Id: string, skill2Id: string): Promise<{ related: boolean; type: string; weight: number }> {
    const skill1Uri = `${PREFIXES.skill}${skill1Id}`
    const skill2Uri = `${PREFIXES.skill}${skill2Id}`

    if (skill1Id === skill2Id) {
      return { related: true, type: 'exact', weight: 1.0 }
    }

    if (!this.driver) throw new Error('Neo4j driver not initialized')
    const session = this.driver.session()
    try {
      const EQ = `${PREFIXES.sm}equivalentSkill`
      const BROADER = `${PREFIXES.sm}broaderSkill`
      const NARROWER = `${PREFIXES.sm}narrowerSkill`
      const SIMILAR = `${PREFIXES.sm}similarTo`

      const res = await session.run(
        `
        MATCH (s1 {uri: $skill1}) 
        OPTIONAL MATCH (s1)-[:\`${EQ}\`]->(s2eq {uri: $skill2})
        OPTIONAL MATCH (s1)-[:\`${BROADER}\`]->(s2br {uri: $skill2})
        OPTIONAL MATCH (s1)-[:\`${NARROWER}\`]->(s2nr {uri: $skill2})
        OPTIONAL MATCH (s1)-[:\`${SIMILAR}\`]->(s2sim {uri: $skill2})
        RETURN
          CASE 
            WHEN s2eq IS NOT NULL THEN 'equivalent'
            WHEN s2br IS NOT NULL THEN 'narrower'
            WHEN s2nr IS NOT NULL THEN 'broader'
            WHEN s2sim IS NOT NULL THEN 'similar'
            ELSE null
          END AS relType
        LIMIT 1
        `,
        { skill1: skill1Uri, skill2: skill2Uri }
      )

      const relType = res.records[0]?.get('relType') as string | null
      if (relType) {
        const weights: Record<string, number> = {
          exact: 1.0,
          equivalent: 1.0,
          narrower: 0.85,
          broader: 0.5,
          similar: 0.6
        }
        return { related: true, type: relType, weight: weights[relType] || 0 }
      }

      return { related: false, type: 'none', weight: 0 }
    } finally {
      await session.close()
    }
  }

  /**
   * Get SPARQL prefix declarations
   */
  private getSPARQLPrefixes(): string {
    return `
      PREFIX rdf: <${PREFIXES.rdf}>
      PREFIX rdfs: <${PREFIXES.rdfs}>
      PREFIX owl: <${PREFIXES.owl}>
      PREFIX xsd: <${PREFIXES.xsd}>
      PREFIX sm: <${PREFIXES.sm}>
      PREFIX skill: <${PREFIXES.skill}>
      PREFIX job: <${PREFIXES.job}>
      PREFIX person: <${PREFIXES.person}>
      PREFIX org: <${PREFIXES.org}>
    `
  }

  /**
   * Get a skill by ID or name
   */
  async getSkill(idOrName: string): Promise<RDFSkill | undefined> {
    const allSkills = await this.getAllSkills()
    const normalized = idOrName.toLowerCase().trim()
    
    return allSkills.find(skill => 
      skill.id.toLowerCase() === normalized ||
      skill.name.toLowerCase() === normalized ||
      skill.aliases.some(a => a.toLowerCase() === normalized)
    )
  }

  /**
   * Get all people
   */
  async getAllPeople(): Promise<RDFPerson[]> {
    const PERSON_LABEL = `${PREFIXES.sm}Person`
    const NAME_PROP = `${PREFIXES.sm}personName`
    const EMAIL_PROP = `${PREFIXES.sm}email`
    const RESUME_PROP = `${PREFIXES.sm}resumeText`
    const HAS_SKILL = `${PREFIXES.sm}hasSkill`

    if (!this.driver) throw new Error('Neo4j driver not initialized')
    const session = this.driver.session()
    try {
      const result = await session.run(
        `
        MATCH (p:\`${PERSON_LABEL}\`)
        OPTIONAL MATCH (p)-[:\`${HAS_SKILL}\`]->(s)
        RETURN p.uri AS uri,
               p.\`${NAME_PROP}\` AS name,
               p.\`${EMAIL_PROP}\` AS email,
               p.\`${RESUME_PROP}\` AS resumeText,
               collect(DISTINCT s.uri) AS skillUris
        `
      )

      return result.records.map(rec => {
        const uri = rec.get('uri') as string
        return {
          id: uri.replace(PREFIXES.person, ''),
          uri,
          name: (rec.get('name') as string[] | string)?.[0] || (rec.get('name') as string) || uri,
          email: (rec.get('email') as string[] | string)?.[0] || (rec.get('email') as string) || undefined,
          resumeText: (rec.get('resumeText') as string[] | string)?.[0] || (rec.get('resumeText') as string) || undefined,
          skills: (rec.get('skillUris') as string[]).map(u => u?.replace(PREFIXES.skill, '')).filter(Boolean),
        }
      })
    } finally {
      await session.close()
    }
  }

  /**
   * Get all organizations
   */
  async getAllOrganizations(): Promise<RDFOrganization[]> {
    const ORG_LABEL = `${PREFIXES.sm}Organization`
    const NAME_PROP = `${PREFIXES.sm}organizationName`

    if (!this.driver) throw new Error('Neo4j driver not initialized')
    const session = this.driver.session()
    try {
      const result = await session.run(
        `
        MATCH (o:\`${ORG_LABEL}\`)
        RETURN o.uri AS uri, o.\`${NAME_PROP}\` AS name
        `
      )

      return result.records.map(rec => {
        const uri = rec.get('uri') as string
        return {
          id: uri.replace(PREFIXES.org, ''),
          uri,
          name: (rec.get('name') as string[] | string)?.[0] || (rec.get('name') as string) || uri,
        }
      })
    } finally {
      await session.close()
    }
  }

  /**
   * Close the Neo4j driver connection
   */
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close()
      this.driver = null
      this.initialized = false
    }
  }

  /**
   * Get total number of triples (approximate)
   */
  get size(): number {
    // This would require a count query
    return 0
  }
}

// Export singleton instance
export const neo4jStore = new Neo4jRDFStore()
