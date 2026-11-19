/**
 * Fetch real job postings from company job boards into the knowledge graph.
 *
 *   npm run fetch-jobs                 # all companies in data/companies.json
 *   npm run fetch-jobs -- stripe figma # only these company slugs (others are kept as-is)
 *
 * Steps: fetch each board → keep technical roles → tag ontology skills
 * (required vs nice-to-have) → SHACL-validate → write ontology/jobs.rdf.ttl.
 *
 * Postings that are no longer on a board disappear from the graph. If a board
 * can't be reached, that company's previous postings are kept unchanged.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as N3 from 'n3'
import { fetchCompanyJobs } from '../lib/jobs/boards'
import { jobsToQuads, quadsToTurtle, tagSkills } from '../lib/jobs/rdf'
import { isRelevantRole } from '../lib/jobs/text'
import { Company, EnrichedJob, NormalizedJob } from '../lib/jobs/types'
import { MemoryGraphStore } from '../lib/rdf/store'
import { JOBS_FILE, ONTOLOGY_DIR, ONTOLOGY_FILES, readTurtleFile, validateQuads } from '../lib/rdf/shacl'
import { PREFIXES } from '../lib/rdf/types'

const ROOT = process.cwd()
const COMPANIES_FILE = path.join(ROOT, 'data', 'companies.json')
const SUMMARY_FILE = path.join(ROOT, 'data', 'jobs-summary.json')
const RAW_FILE = path.join(ROOT, 'data', 'raw', 'jobs.json')
const JOBS_PATH = path.join(ONTOLOGY_DIR, JOBS_FILE)

const CONCURRENCY = 6
const MIN_DESCRIPTION_LENGTH = 50
const MAX_FAILURE_RATIO = 0.25

interface CompanyResult {
  company: Company
  ok: boolean
  error?: string
  fetched: number
  relevant: number
  kept: number
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i])
      }
    }),
  )
  return results
}

/** Quads of the previous run for the given companies (used when a board fails). */
function previousQuadsFor(slugs: Set<string>): N3.Quad[] {
  if (slugs.size === 0 || !fs.existsSync(JOBS_PATH)) return []
  const store = new N3.Store(readTurtleFile(JOBS_FILE))
  const kept: N3.Quad[] = []
  for (const slug of slugs) {
    const org = N3.DataFactory.namedNode(PREFIXES.org + slug)
    kept.push(...store.getQuads(org, null, null, null))
    for (const job of store.getSubjects(N3.DataFactory.namedNode(PREFIXES.sm + 'postedBy'), org, null)) {
      kept.push(...store.getQuads(job, null, null, null))
    }
  }
  return kept
}

async function main() {
  const only = new Set(process.argv.slice(2).map((s) => s.toLowerCase()))
  const all: Company[] = JSON.parse(fs.readFileSync(COMPANIES_FILE, 'utf-8')).companies
  const selected = only.size ? all.filter((c) => only.has(c.slug)) : all
  if (selected.length === 0) throw new Error(`No companies match: ${[...only].join(', ')}`)

  // Skills come from the ontology only (not from previously fetched jobs).
  const ontology = new MemoryGraphStore(ONTOLOGY_DIR, ONTOLOGY_FILES)
  await ontology.initialize()
  const skills = await ontology.getAllSkills()
  console.log(`Ontology: ${skills.length} skills. Fetching ${selected.length} companies…`)

  const rawJobs: NormalizedJob[] = []
  const jobs: EnrichedJob[] = []
  const results = await mapLimit(selected, CONCURRENCY, async (company): Promise<CompanyResult> => {
    try {
      const fetched = await fetchCompanyJobs(company)
      const relevant = fetched.filter((j) => isRelevantRole(j.title) && j.description.length >= MIN_DESCRIPTION_LENGTH)
      const tagged = relevant.map((j) => tagSkills(j, skills)).filter((j) => j.requiredSkills.length > 0)
      rawJobs.push(...relevant)
      jobs.push(...tagged)
      console.log(`  ✓ ${company.name.padEnd(14)} ${String(fetched.length).padStart(4)} open, ${String(relevant.length).padStart(4)} technical, ${String(tagged.length).padStart(4)} with known skills`)
      return { company, ok: true, fetched: fetched.length, relevant: relevant.length, kept: tagged.length }
    } catch (error) {
      console.warn(`  ✗ ${company.name}: ${(error as Error).message}`)
      return { company, ok: false, error: (error as Error).message, fetched: 0, relevant: 0, kept: 0 }
    }
  })

  const failed = results.filter((r) => !r.ok)
  if (failed.length / results.length > MAX_FAILURE_RATIO) {
    throw new Error(`${failed.length}/${results.length} boards failed; not updating the graph`)
  }

  // Keep previous postings for failed boards and for companies not selected this run.
  const untouched = new Set([
    ...failed.map((r) => r.company.slug),
    ...all.filter((c) => !selected.includes(c)).map((c) => c.slug),
  ])
  const carriedOver = previousQuadsFor(untouched)

  // De-duplicate (a board can list the same posting twice) and validate.
  const unique = [...new Map(jobs.map((j) => [j.id, j])).values()].sort((a, b) => a.id.localeCompare(b.id))
  let jobQuads = [...jobsToQuads(unique), ...carriedOver]
  const ontologyQuads = ONTOLOGY_FILES.flatMap((f) => readTurtleFile(f))

  let report = await validateQuads([...ontologyQuads, ...jobQuads])
  const badJobs = new Set(
    report.violations.filter((v) => v.severity === 'Violation' && v.focusNode.startsWith(PREFIXES.job)).map((v) => v.focusNode),
  )
  if (badJobs.size > 0) {
    console.warn(`Dropping ${badJobs.size} postings that failed SHACL validation:`)
    for (const v of report.violations.filter((v) => badJobs.has(v.focusNode)).slice(0, 10)) {
      console.warn(`  ${v.focusNode}: ${v.message}`)
    }
    jobQuads = jobQuads.filter((q) => !badJobs.has(q.subject.value))
    report = await validateQuads([...ontologyQuads, ...jobQuads])
  }
  if (!report.valid) {
    throw new Error(`Graph still invalid after dropping bad postings: ${report.violations[0]?.message}`)
  }

  const jobCount = new Set(
    jobQuads.filter((q) => q.predicate.value === PREFIXES.rdf + 'type' && q.object.value === PREFIXES.sm + 'JobPosting').map((q) => q.subject.value),
  ).size

  const fetchedAt = new Date().toISOString()
  const header =
    `# Generated by scripts/fetch-jobs.ts on ${fetchedAt}. Do not edit by hand.\n` +
    `# ${jobCount} job postings from ${all.length - failed.length} company job boards.\n\n`
  fs.writeFileSync(JOBS_PATH, await quadsToTurtle(jobQuads, header))

  fs.mkdirSync(path.dirname(RAW_FILE), { recursive: true })
  fs.writeFileSync(RAW_FILE, JSON.stringify(rawJobs, null, 1))

  const summary = {
    fetchedAt,
    jobs: jobCount,
    companies: results
      .map(({ company, ok, error, fetched, relevant, kept }) => ({ slug: company.slug, board: company.board, ok, error, fetched, relevant, kept }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  }
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2) + '\n')

  console.log(`\nWrote ${jobCount} postings to ontology/${JOBS_FILE} (SHACL valid).`)
  if (failed.length) console.log(`Kept previous postings for ${failed.length} unreachable boards: ${failed.map((r) => r.company.slug).join(', ')}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
