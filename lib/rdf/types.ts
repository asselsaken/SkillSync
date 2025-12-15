/**
 * RDF/SPARQL Types for SkillMatch
 */

// Namespace prefixes
export const PREFIXES = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  sm: 'http://skillmatch.org/ontology#',
  skill: 'http://skillmatch.org/skill#',
  job: 'http://skillmatch.org/job#',
  person: 'http://skillmatch.org/person#',
  org: 'http://skillmatch.org/org#',
} as const

// SPARQL prefix declarations
export const SPARQL_PREFIXES = `
PREFIX rdf: <${PREFIXES.rdf}>
PREFIX rdfs: <${PREFIXES.rdfs}>
PREFIX owl: <${PREFIXES.owl}>
PREFIX xsd: <${PREFIXES.xsd}>
PREFIX skos: <${PREFIXES.skos}>
PREFIX sm: <${PREFIXES.sm}>
PREFIX skill: <${PREFIXES.skill}>
PREFIX job: <${PREFIXES.job}>
PREFIX person: <${PREFIXES.person}>
PREFIX org: <${PREFIXES.org}>
`

// Skill entity from RDF
export interface RDFSkill {
  id: string
  uri: string
  name: string
  aliases: string[]
  broaderSkills: string[]
  narrowerSkills: string[]
  similarSkills: string[]
  equivalentSkills: string[]
}

// Person entity from RDF
export interface RDFPerson {
  id: string
  uri: string
  name: string
  email?: string
  skills: string[]
  resumeText?: string
}

// JobPosting entity from RDF
export interface RDFJobPosting {
  id: string
  uri: string
  title: string
  description: string
  location?: string
  url?: string
  organization: string
  requiredSkills: string[]
  preferredSkills: string[]
  datePosted?: string
}

// Organization entity from RDF
export interface RDFOrganization {
  id: string
  uri: string
  name: string
}

// Match result with semantic details
export interface SemanticMatch {
  personUri: string
  jobUri: string
  score: number
  matchedSkills: SkillMatchDetail[]
  totalRequiredSkills: number
  totalMatchedSkills: number
}

// Detailed skill match information
export interface SkillMatchDetail {
  personSkillUri: string
  personSkillName: string
  jobSkillUri: string
  jobSkillName: string
  matchType: 'exact' | 'equivalent' | 'broader' | 'narrower' | 'similar'
  weight: number
}

// Match type weights for scoring
export const MATCH_TYPE_WEIGHTS: Record<SkillMatchDetail['matchType'], number> = {
  exact: 1.0,
  equivalent: 1.0,
  narrower: 0.85,  // Person has more specific skill
  broader: 0.5,    // Person has more general skill
  similar: 0.6,
}

// SHACL validation result
export interface ValidationResult {
  valid: boolean
  violations: ValidationViolation[]
}

export interface ValidationViolation {
  focusNode: string
  path: string
  message: string
  severity: 'Violation' | 'Warning' | 'Info'
}

