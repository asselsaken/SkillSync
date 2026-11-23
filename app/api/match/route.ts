import { NextRequest, NextResponse } from 'next/server'
import pdfParse from 'pdf-parse'
import { getGraphStore } from '../../../lib/rdf/graph-store'
import { collapseDuplicates, semanticMatcher } from '../../../lib/rdf/semantic-matcher'
import { MATCH_TYPE_WEIGHTS } from '../../../lib/rdf/types'

export const runtime = 'nodejs'
// Allow for a cold start (loading the graph) on serverless hosts
export const maxDuration = 30

const MIN_SCORE = 50
const MAX_RESULTS = 50
const MAX_GAPS = 6
const FIVE_MB = 5 * 1024 * 1024

const validateFile = (file: File | null): { error?: string } => {
  if (!file) return { error: 'No file provided' }
  if (file.type !== 'application/pdf') return { error: 'PDF only' }
  if (file.size > FIVE_MB) return { error: 'File too large (max 5MB)' }
  return {}
}

const parseResume = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const pdfData = await pdfParse(buffer)
  return pdfData.text
}

const resolveSkillNames = (allSkills: { id: string; name: string }[], skillIds: string[]) =>
  skillIds.map((id) => allSkills.find((s) => s.id === id)?.name || id)

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    const { error: fileError } = validateFile(file || null)
    if (fileError) return NextResponse.json({ error: fileError }, { status: 400 })

    // Loads the ontology (SHACL-validated) on first use: in-memory or Neo4j.
    const store = await getGraphStore()

    let resumeText: string
    try {
      resumeText = await parseResume(file)
    } catch {
      return NextResponse.json(
        { error: "Couldn't read this PDF. Please upload a text-based PDF (not a scanned image)." },
        { status: 400 }
      )
    }

    // Extract skills via ontology names/aliases with word-boundary matching.
    const extractedSkillIds = await semanticMatcher.extractSkillsFromText(resumeText)
    
    if (extractedSkillIds.length === 0) {
      return NextResponse.json(
        { error: 'No skills detected in resume. Please ensure your resume lists relevant technical skills.' },
        { status: 400 }
      )
    }
    
    const matchedJobs = await semanticMatcher.matchToAllJobs(extractedSkillIds)
    
    if (matchedJobs.length === 0) {
      return NextResponse.json({
        matches: [],
        extractedSkillCount: extractedSkillIds.length,
        extractedSkills: extractedSkillIds,
        message: 'No matching jobs found for your skills'
      })
    }
    
    const topMatches = collapseDuplicates(matchedJobs)
      .filter(match => match.matchScore >= MIN_SCORE)
      .slice(0, MAX_RESULTS)

    // Skills that are missing most often across the top matches: what to learn next.
    const gapCounts = new Map<string, number>()
    for (const m of topMatches) for (const gap of m.missingSkills) gapCounts.set(gap, (gapCounts.get(gap) ?? 0) + 1)
    const skillGaps = [...gapCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_GAPS)
      .map(([skill, jobs]) => ({ skill, jobs }))
    
    const skillNames = resolveSkillNames(await store.getAllSkills(), extractedSkillIds)
    
    return NextResponse.json({ 
      matches: topMatches,
      skillGaps,
      extractedSkillCount: extractedSkillIds.length,
      extractedSkills: skillNames,
      semanticMatching: {
        method: 'RDF/OWL skill graph',
        backend: store.backend,
        matchTypes: Object.keys(MATCH_TYPE_WEIGHTS),
        weights: MATCH_TYPE_WEIGHTS,
      }
    })
  } catch (error) {
    console.error('Match processing error:', error)
    return NextResponse.json(
      { error: 'Processing failed. Please try again.' },
      { status: 500 }
    )
  }
}
