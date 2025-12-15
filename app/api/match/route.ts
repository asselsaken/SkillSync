import { NextRequest, NextResponse } from 'next/server'
import pdfParse from 'pdf-parse'
import { neo4jStore } from '../../../lib/rdf/neo4j-store'
import { semanticMatcher } from '../../../lib/rdf/semantic-matcher'
import { SkillMatchDetail } from '../../../lib/rdf/types'

interface MatchedJob {
  id: string
  title: string
  company: string
  location: string
  skills: string[]
  description: string
  url?: string
  matchScore: number
  summary: string
  reasons: string[]
  matchedSkills: SkillMatchDetail[]
}

const MIN_SCORE = 50
const MAX_RESULTS = 10
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

    // Neo4j is required; initialization ensures ontology and SHACL are loaded.
    await neo4jStore.initialize()
    
    const resumeText = await parseResume(file)

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
    
    const topMatches = matchedJobs
      .filter(match => match.matchScore >= MIN_SCORE)
      .slice(0, MAX_RESULTS)
    
    const skillNames = resolveSkillNames(await neo4jStore.getAllSkills(), extractedSkillIds)
    
    return NextResponse.json({ 
      matches: topMatches,
      extractedSkillCount: extractedSkillIds.length,
      extractedSkills: skillNames,
      semanticMatching: {
        method: 'RDF/OWL Ontology with SPARQL',
        matchTypes: ['exact', 'equivalent', 'narrower', 'similar', 'broader'],
        weights: {
          exact: 1.0,
          equivalent: 1.0,
          narrower: 0.85,
          similar: 0.6,
          broader: 0.5
        }
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
