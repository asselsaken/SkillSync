export type Board = 'greenhouse' | 'lever' | 'ashby'

export interface Company {
  name: string
  board: Board
  slug: string
}

/** A job posting normalised from any job board. */
export interface NormalizedJob {
  id: string // stable, URI-safe: <slug>-<board job id>
  source: Board
  sourceId: string
  company: Company
  title: string
  department?: string
  location?: string
  isRemote: boolean
  employmentType?: string
  url: string
  applyUrl?: string
  datePosted?: string // YYYY-MM-DD
  salary?: string
  description: string // full plain text
}

/** A job with skills resolved against the ontology. */
export interface EnrichedJob extends NormalizedJob {
  requiredSkills: string[]
  requiredGroups: string[][] // "any of" requirements
  preferredSkills: string[]
}
