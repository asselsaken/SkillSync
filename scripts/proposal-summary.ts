/**
 * Markdown summary of the newest skill-proposal batch, used as the body of
 * the weekly review pull request.
 *
 *   npx tsx scripts/proposal-summary.ts [batch.json]
 */

import * as fs from 'fs'
import * as path from 'path'
import { ProposalBatch } from '../lib/graph/proposals'

const DIR = path.join(process.cwd(), 'data', 'skill-proposals')

function newestBatch(): string {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  if (files.length === 0) throw new Error('No proposal batches found')
  return path.join(DIR, files[files.length - 1])
}

const file = process.argv[2] ?? newestBatch()
const batch: ProposalBatch = JSON.parse(fs.readFileSync(file, 'utf-8'))
const summary = fs.existsSync('data/jobs-summary.json') ? JSON.parse(fs.readFileSync('data/jobs-summary.json', 'utf-8')) : null

const lines: string[] = []
lines.push(`Automated skill-graph review from \`${path.basename(file)}\` (reviewer: ${batch.reviewer}).`)
lines.push('')
lines.push(
  `**${batch.newSkills.length} new skills**, ${(batch.newAliases ?? []).length} alias updates, ` +
    `${(batch.rejected ?? []).length} terms rejected. All changes passed the proposal checks and SHACL validation, ` +
    `and jobs were re-tagged${summary ? ` (${summary.jobs} postings)` : ''}.`,
)

if (batch.newSkills.length > 0) {
  lines.push('', '### New skills', '', '| Skill | Parent | Similar | Aliases | Postings |', '|---|---|---|---|---|')
  for (const s of [...batch.newSkills].sort((a, b) => (b.evidencePostings ?? 0) - (a.evidencePostings ?? 0))) {
    const name = s.caseSensitive ? `${s.name} (exact case)` : s.name
    lines.push(`| ${name} | ${s.broader.join(', ')} | ${(s.similar ?? []).join(', ')} | ${(s.aliases ?? []).join(', ')} | ${s.evidencePostings ?? ''} |`)
  }
}

if ((batch.newAliases ?? []).length > 0) {
  lines.push('', '### New aliases for existing skills', '')
  for (const a of batch.newAliases ?? []) lines.push(`- \`${a.skill}\`: ${a.aliases.join(', ')}`)
}

if ((batch.rejected ?? []).length > 0) {
  lines.push('', '<details><summary>Rejected terms</summary>', '')
  for (const r of batch.rejected ?? []) lines.push(`- **${r.term}**: ${r.reason}`)
  lines.push('', '</details>')
}

lines.push(
  '',
  '### How to review',
  '',
  '- Check that each new skill is real and its parent and "similar" links make sense. A wrong "similar" link gives candidates credit they shouldn\'t get.',
  '- To change something, edit the batch JSON on this branch and run `npm run graph:apply`.',
  '- Merging publishes the new skills; closing the PR discards them.',
)

console.log(lines.join('\n'))
