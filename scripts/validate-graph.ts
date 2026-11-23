/**
 * SHACL-validate everything the app will load. Runs before every build
 * (`prebuild`), so an invalid graph can never be deployed.
 *
 *   npm run validate
 */

import { dataFiles, readTurtleFile, validateQuads } from '../lib/rdf/shacl'

async function main() {
  const files = dataFiles()
  const started = Date.now()
  const quads = files.flatMap((f) => readTurtleFile(f))
  const report = await validateQuads(quads)
  const counts = { Violation: 0, Warning: 0, Info: 0 }
  for (const v of report.violations) counts[v.severity]++

  if (!report.valid) {
    console.error(`✗ SHACL: ${counts.Violation} violations in ${files.join(', ')}`)
    for (const v of report.violations.filter((v) => v.severity === 'Violation').slice(0, 20)) {
      console.error(`   ${v.focusNode} ${v.path}: ${v.message}`)
    }
    process.exit(1)
  }
  console.log(`✓ SHACL: ${quads.length} triples in ${files.length} files valid (${counts.Warning} warnings) in ${Date.now() - started} ms`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
