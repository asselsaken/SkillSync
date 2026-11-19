/**
 * SHACL validation shared by all graph stores.
 *
 * Core SHACL constraints are checked with rdf-validate-shacl. That library does
 * not implement SHACL-SPARQL (sh:sparql), so those constraints are executed here
 * with Oxigraph: for every focus node of the shape's target class, the
 * constraint's SELECT query is run and each result row is a violation.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as N3 from 'n3'
import * as oxigraph from 'oxigraph'
import SHACLValidator from 'rdf-validate-shacl'
import { SPARQL_PREFIXES, ValidationResult, ValidationViolation } from './types'

export const ONTOLOGY_DIR = path.join(process.cwd(), 'ontology')
export const SHAPES_FILE = 'skillmatch.shacl.ttl'
export const DATA_FILES = ['skillmatch.owl.ttl', 'skills.rdf.ttl', 'sample-data.rdf.ttl']

const SH = 'http://www.w3.org/ns/shacl#'
const { namedNode } = N3.DataFactory

export function parseTurtle(content: string): N3.Quad[] {
  return new N3.Parser().parse(content)
}

export function readTurtleFile(file: string, dir: string = ONTOLOGY_DIR): N3.Quad[] {
  return parseTurtle(fs.readFileSync(path.join(dir, file), 'utf-8'))
}

interface SparqlConstraint {
  targetClass: string
  select: string
  message: string
  severity: ValidationViolation['severity']
}

let coreValidator: SHACLValidator | null = null
let sparqlConstraints: SparqlConstraint[] = []

function severityOf(uri: string | undefined): ValidationViolation['severity'] {
  if (!uri || uri.endsWith('Violation')) return 'Violation'
  if (uri.endsWith('Warning')) return 'Warning'
  return 'Info'
}

/** Split the shapes graph into core shapes and SHACL-SPARQL constraints. */
function loadShapes(): SHACLValidator {
  if (coreValidator) return coreValidator

  const shapes = new N3.Store(readTurtleFile(SHAPES_FILE))
  const first = (s: N3.Term, p: string) => shapes.getObjects(s, namedNode(p), null)[0]

  sparqlConstraints = []
  for (const link of shapes.getQuads(null, namedNode(SH + 'sparql'), null, null)) {
    const shape = link.subject
    const constraint = link.object
    for (const targetClass of shapes.getObjects(shape, namedNode(SH + 'targetClass'), null)) {
      sparqlConstraints.push({
        targetClass: targetClass.value,
        select: first(constraint, SH + 'select')?.value ?? '',
        message: first(constraint, SH + 'message')?.value ?? 'SPARQL constraint violated',
        severity: severityOf(first(constraint, SH + 'severity')?.value),
      })
    }
    shapes.removeQuad(link)
  }

  coreValidator = new SHACLValidator(shapes)
  return coreValidator
}

/** Run one sh:sparql constraint: bind $this to each instance of the target class. */
function runSparqlConstraint(store: oxigraph.Store, c: SparqlConstraint): ValidationViolation[] {
  const body = c.select.replace(/\$this/g, '?this')
  const whereStart = body.search(/WHERE\s*\{/i)
  if (whereStart < 0) return []
  const braceIndex = body.indexOf('{', whereStart)
  const query =
    SPARQL_PREFIXES +
    body.slice(0, braceIndex + 1) +
    ` ?this a <${c.targetClass}> . ` +
    body.slice(braceIndex + 1)

  const rows = store.query(query) as Map<string, oxigraph.Term>[]
  return rows.map((row) => ({
    focusNode: row.get('this')?.value ?? '',
    path: '',
    message: c.message,
    severity: c.severity,
  }))
}

/** Validate a set of quads against the SkillMatch SHACL shapes. */
export async function validateQuads(quads: N3.Quad[]): Promise<ValidationResult> {
  const validator = loadShapes()
  const report = await validator.validate(new N3.Store(quads))

  const violations: ValidationViolation[] = report.results.map((r) => ({
    focusNode: r.focusNode?.value ?? '',
    path: r.path?.value ?? '',
    message: r.message[0]?.value ?? 'Validation error',
    severity: severityOf(r.severity?.value),
  }))

  if (sparqlConstraints.length > 0) {
    const store = new oxigraph.Store(quads as unknown as oxigraph.Quad[])
    for (const c of sparqlConstraints) violations.push(...runSparqlConstraint(store, c))
  }

  const blocking = violations.filter((v) => v.severity === 'Violation')
  return { valid: blocking.length === 0, violations }
}
