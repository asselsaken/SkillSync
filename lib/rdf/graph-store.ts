/**
 * Graph store abstraction.
 *
 * SkillMatch runs on an in-memory RDF store by default (no external services),
 * and switches to Neo4j + neosemantics when NEO4J_URI is set.
 */

import { RDFJobPosting, RDFOrganization, RDFPerson, RDFSkill, SkillMatchDetail } from './types'

export interface SkillRelation {
  related: boolean
  type: SkillMatchDetail['matchType'] | 'none'
  weight: number
}

export type SparqlRow = Record<string, string>

export interface GraphStore {
  readonly backend: 'memory' | 'neo4j'
  initialize(): Promise<void>
  getAllSkills(): Promise<RDFSkill[]>
  getSkill(idOrName: string): Promise<RDFSkill | undefined>
  getAllJobPostings(): Promise<RDFJobPosting[]>
  getAllPeople(): Promise<RDFPerson[]>
  getAllOrganizations(): Promise<RDFOrganization[]>
  areSkillsRelated(personSkillId: string, jobSkillId: string): Promise<SkillRelation>
  executeSPARQL(query: string): Promise<SparqlRow[]>
  tripleCount(): Promise<number>
}

let pending: Promise<GraphStore> | null = null

async function createStore(): Promise<GraphStore> {
  let store: GraphStore
  if (process.env.NEO4J_URI) {
    const { neo4jStore } = await import('./neo4j-store')
    store = neo4jStore
  } else {
    const { memoryStore } = await import('./store')
    store = memoryStore
  }
  await store.initialize()
  return store
}

/** Returns the active graph store: Neo4j if NEO4J_URI is set, otherwise in-memory. */
export function getGraphStore(): Promise<GraphStore> {
  if (!pending) {
    pending = createStore().catch((error) => {
      pending = null // allow a retry on the next request
      throw error
    })
  }
  return pending
}
