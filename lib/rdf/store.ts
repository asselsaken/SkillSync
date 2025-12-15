/**
 * RDF Store - Triple Store using N3.js
 * 
 * Provides in-memory RDF storage with SPARQL-like querying capabilities
 */

import * as N3 from 'n3'
import * as fs from 'fs'
import * as path from 'path'
import { PREFIXES, RDFSkill, RDFJobPosting, RDFPerson, RDFOrganization } from './types'

const { DataFactory } = N3
const { namedNode, literal } = DataFactory

class RDFStore {
  private store: N3.Store
  private initialized: boolean = false

  constructor() {
    this.store = new N3.Store()
  }

  /**
   * Initialize the store by loading all ontology and data files
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    const ontologyDir = path.join(process.cwd(), 'ontology')
    
    // Load all Turtle files
    const files = [
      'skillmatch.owl.ttl',
      'skills.rdf.ttl',
      'sample-data.rdf.ttl'
    ]

    for (const file of files) {
      const filePath = path.join(ontologyDir, file)
      if (fs.existsSync(filePath)) {
        await this.loadTurtleFile(filePath)
      }
    }

    this.initialized = true
    console.log(`RDF Store initialized with ${this.store.size} triples`)
  }

  /**
   * Load a Turtle file into the store
   */
  private async loadTurtleFile(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const content = fs.readFileSync(filePath, 'utf-8')
      const parser = new N3.Parser()
      
      parser.parse(content, (error, quad, prefixes) => {
        if (error) {
          reject(error)
        } else if (quad) {
          this.store.addQuad(quad)
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * Add a triple to the store
   */
  addTriple(subject: string, predicate: string, object: string | N3.Literal): void {
    const obj = typeof object === 'string' ? namedNode(object) : object
    this.store.addQuad(namedNode(subject), namedNode(predicate), obj)
  }

  /**
   * Add a literal triple
   */
  addLiteralTriple(subject: string, predicate: string, value: string, datatype?: string): void {
    const lit = datatype 
      ? literal(value, namedNode(datatype))
      : literal(value)
    this.store.addQuad(namedNode(subject), namedNode(predicate), lit)
  }

  /**
   * Query triples matching a pattern
   */
  getTriples(subject?: string, predicate?: string, object?: string): N3.Quad[] {
    return this.store.getQuads(
      subject ? namedNode(subject) : null,
      predicate ? namedNode(predicate) : null,
      object ? namedNode(object) : null,
      null
    )
  }

  /**
   * Get all values for a subject-predicate pair
   */
  getValues(subject: string, predicate: string): string[] {
    const quads = this.store.getQuads(namedNode(subject), namedNode(predicate), null, null)
    return quads.map(q => q.object.value)
  }

  /**
   * Get a single value for a subject-predicate pair
   */
  getValue(subject: string, predicate: string): string | undefined {
    const values = this.getValues(subject, predicate)
    return values[0]
  }

  /**
   * Get all subjects of a given type
   */
  getSubjectsOfType(type: string): string[] {
    const quads = this.store.getQuads(null, namedNode(PREFIXES.rdf + 'type'), namedNode(type), null)
    return quads.map(q => q.subject.value)
  }

  /**
   * Get all skills from the store
   */
  getAllSkills(): RDFSkill[] {
    const skillUris = this.getSubjectsOfType(PREFIXES.sm + 'Skill')
    
    return skillUris.map(uri => {
      const id = uri.replace(PREFIXES.skill, '')
      return {
        id,
        uri,
        name: this.getValue(uri, PREFIXES.sm + 'skillName') || id,
        aliases: this.getValues(uri, PREFIXES.sm + 'skillAlias'),
        broaderSkills: this.getValues(uri, PREFIXES.sm + 'broaderSkill').map(u => u.replace(PREFIXES.skill, '')),
        narrowerSkills: this.getValues(uri, PREFIXES.sm + 'narrowerSkill').map(u => u.replace(PREFIXES.skill, '')),
        similarSkills: this.getValues(uri, PREFIXES.sm + 'similarTo').map(u => u.replace(PREFIXES.skill, '')),
        equivalentSkills: this.getValues(uri, PREFIXES.sm + 'equivalentSkill').map(u => u.replace(PREFIXES.skill, '')),
      }
    })
  }

  /**
   * Get a skill by ID or name
   */
  getSkill(idOrName: string): RDFSkill | undefined {
    const allSkills = this.getAllSkills()
    const normalized = idOrName.toLowerCase().trim()
    
    return allSkills.find(skill => 
      skill.id.toLowerCase() === normalized ||
      skill.name.toLowerCase() === normalized ||
      skill.aliases.some(a => a.toLowerCase() === normalized)
    )
  }

  /**
   * Get all job postings from the store
   */
  getAllJobPostings(): RDFJobPosting[] {
    const jobUris = this.getSubjectsOfType(PREFIXES.sm + 'JobPosting')
    
    return jobUris.map(uri => {
      const id = uri.replace(PREFIXES.job, '')
      const orgUri = this.getValue(uri, PREFIXES.sm + 'postedBy') || ''
      
      return {
        id,
        uri,
        title: this.getValue(uri, PREFIXES.sm + 'jobTitle') || id,
        description: this.getValue(uri, PREFIXES.sm + 'jobDescription') || '',
        location: this.getValue(uri, PREFIXES.sm + 'location'),
        url: this.getValue(uri, PREFIXES.sm + 'jobUrl'),
        organization: this.getValue(orgUri, PREFIXES.sm + 'organizationName') || orgUri.replace(PREFIXES.org, ''),
        requiredSkills: this.getValues(uri, PREFIXES.sm + 'requiresSkill').map(u => u.replace(PREFIXES.skill, '')),
        preferredSkills: this.getValues(uri, PREFIXES.sm + 'prefersSkill').map(u => u.replace(PREFIXES.skill, '')),
        datePosted: this.getValue(uri, PREFIXES.sm + 'datePosted'),
      }
    })
  }

  /**
   * Get all people from the store
   */
  getAllPeople(): RDFPerson[] {
    const personUris = this.getSubjectsOfType(PREFIXES.sm + 'Person')
    
    return personUris.map(uri => {
      const id = uri.replace(PREFIXES.person, '')
      return {
        id,
        uri,
        name: this.getValue(uri, PREFIXES.sm + 'personName') || id,
        email: this.getValue(uri, PREFIXES.sm + 'email'),
        skills: this.getValues(uri, PREFIXES.sm + 'hasSkill').map(u => u.replace(PREFIXES.skill, '')),
        resumeText: this.getValue(uri, PREFIXES.sm + 'resumeText'),
      }
    })
  }

  /**
   * Get all organizations from the store
   */
  getAllOrganizations(): RDFOrganization[] {
    const orgUris = this.getSubjectsOfType(PREFIXES.sm + 'Organization')
    
    return orgUris.map(uri => {
      const id = uri.replace(PREFIXES.org, '')
      return {
        id,
        uri,
        name: this.getValue(uri, PREFIXES.sm + 'organizationName') || id,
      }
    })
  }

  /**
   * Check if two skills are related
   */
  areSkillsRelated(skill1Id: string, skill2Id: string): { related: boolean; type: string; weight: number } {
    const skill1Uri = PREFIXES.skill + skill1Id
    const skill2Uri = PREFIXES.skill + skill2Id

    // Check exact match (same skill)
    if (skill1Id === skill2Id) {
      return { related: true, type: 'exact', weight: 1.0 }
    }

    // Check equivalent skills
    const equivalents = this.getValues(skill1Uri, PREFIXES.sm + 'equivalentSkill')
    if (equivalents.includes(skill2Uri)) {
      return { related: true, type: 'equivalent', weight: 1.0 }
    }

    // Check if skill1 is narrower than skill2 (more specific)
    const broader = this.getValues(skill1Uri, PREFIXES.sm + 'broaderSkill')
    if (broader.includes(skill2Uri)) {
      return { related: true, type: 'narrower', weight: 0.85 }
    }

    // Check if skill1 is broader than skill2 (more general)
    const narrower = this.getValues(skill1Uri, PREFIXES.sm + 'narrowerSkill')
    if (narrower.includes(skill2Uri)) {
      return { related: true, type: 'broader', weight: 0.5 }
    }

    // Check similar skills
    const similar = this.getValues(skill1Uri, PREFIXES.sm + 'similarTo')
    if (similar.includes(skill2Uri)) {
      return { related: true, type: 'similar', weight: 0.6 }
    }

    // Check transitive broader (2 levels)
    for (const broaderUri of broader) {
      const grandBroader = this.getValues(broaderUri, PREFIXES.sm + 'broaderSkill')
      if (grandBroader.includes(skill2Uri)) {
        return { related: true, type: 'narrower', weight: 0.7 }
      }
    }

    return { related: false, type: 'none', weight: 0 }
  }

  /**
   * Get the total number of triples in the store
   */
  get size(): number {
    return this.store.size
  }

  /**
   * Clear the store
   */
  clear(): void {
    this.store = new N3.Store()
    this.initialized = false
  }
}

// Export singleton instance
export const rdfStore = new RDFStore()

