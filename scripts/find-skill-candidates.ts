/**
 * Step 1 of growing the skill graph: list terms that job postings treat as
 * skills but the ontology doesn't know yet.
 *
 *   npm run graph:candidates
 *
 * Reads data/raw/jobs.json (written by `npm run fetch-jobs`) and writes
 * data/skill-candidates.json for review (see prompts/review-skill-candidates.md).
 */

import * as fs from 'fs'
import * as path from 'path'
import { findSkillCandidates } from '../lib/graph/candidates'
import { NormalizedJob } from '../lib/jobs/types'
import { MemoryGraphStore } from '../lib/rdf/store'
import { ONTOLOGY_DIR, ONTOLOGY_FILES } from '../lib/rdf/shacl'

const RAW_FILE = path.join(process.cwd(), 'data', 'raw', 'jobs.json')
const OUT_FILE = path.join(process.cwd(), 'data', 'skill-candidates.json')

async function main() {
  if (!fs.existsSync(RAW_FILE)) throw new Error('data/raw/jobs.json not found. Run `npm run fetch-jobs` first.')
  const jobs: NormalizedJob[] = JSON.parse(fs.readFileSync(RAW_FILE, 'utf-8'))

  const ontology = new MemoryGraphStore(ONTOLOGY_DIR, ONTOLOGY_FILES)
  await ontology.initialize()
  const skills = await ontology.getAllSkills()

  // Terms rejected in earlier reviews are not proposed again.
  const proposalsDir = path.join(process.cwd(), 'data', 'skill-proposals')
  const rejected = fs.existsSync(proposalsDir)
    ? fs.readdirSync(proposalsDir).filter((f) => f.endsWith('.json'))
        .flatMap((f) => JSON.parse(fs.readFileSync(path.join(proposalsDir, f), 'utf-8')).rejected ?? [])
        .map((r: { term: string }) => r.term)
    : []

  const candidates = findSkillCandidates(jobs, skills, { alreadyReviewed: rejected })
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), postingsScanned: jobs.length, knownSkills: skills.length, candidates }, null, 2) + '\n',
  )

  console.log(`Scanned ${jobs.length} postings against ${skills.length} known skills (${rejected.length} terms already rejected).`)
  console.log(`Wrote ${candidates.length} candidates to data/skill-candidates.json. Top 40:`)
  for (const c of candidates.slice(0, 40)) {
    console.log(`  ${String(c.postings).padStart(4)}  ${c.term.padEnd(24)} with ${c.coOccursWith.slice(0, 3).map((k) => k.skill).join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
