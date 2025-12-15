'use client'

import { useState } from 'react'

interface SkillMatchDetail {
  personSkillUri: string
  personSkillName: string
  jobSkillUri: string
  jobSkillName: string
  matchType: 'exact' | 'equivalent' | 'narrower' | 'broader' | 'similar'
  weight: number
}

interface Job {
  id: string
  title: string
  company: string
  location: string
  skills: string[]
  description: string
  matchScore?: number
  summary?: string
  url?: string
  reasons?: string[]
  matchedSkills?: SkillMatchDetail[]
}

interface MatchResponse {
  matches: Job[]
  extractedSkillCount: number
  extractedSkills: string[]
  semanticMatching?: {
    method: string
    matchTypes: string[]
    weights: Record<string, number>
  }
}

const matchTypeLabels: Record<string, { label: string; color: string; icon: string }> = {
  exact: { label: 'Exact', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: '=' },
  equivalent: { label: 'Equivalent', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: '≡' },
  narrower: { label: 'Your skill is more specific', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400', icon: '↓' },
  broader: { label: 'Your skill is more general', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', icon: '↑' },
  similar: { label: 'Related skill', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: '≈' }
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Job[]>([])
  const [error, setError] = useState<string>('')
  const [extractedSkills, setExtractedSkills] = useState<string[]>([])
  const [semanticInfo, setSemanticInfo] = useState<MatchResponse['semanticMatching'] | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0]
      if (selectedFile.type !== 'application/pdf') {
        setError('PDF only')
        setFile(null)
        return
      }
      if (selectedFile.size > 5 * 1024 * 1024) {
        setError('File too large')
        setFile(null)
        return
      }
      setError('')
      setFile(selectedFile)
      setResults([])
      setExtractedSkills([])
      setSemanticInfo(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) {
      setError('Select a PDF file')
      return
    }

    setLoading(true)
    setError('')
    setResults([])
    setExtractedSkills([])

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/match', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Processing failed')
      }

      const data: MatchResponse = await response.json()
      setResults(data.matches || [])
      setExtractedSkills(data.extractedSkills || [])
      setSemanticInfo(data.semanticMatching || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed')
    } finally {
      setLoading(false)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'bg-emerald-500'
    if (score >= 50) return 'bg-blue-500'
    if (score >= 30) return 'bg-amber-500'
    return 'bg-zinc-400'
  }

  const getScoreLabel = (score: number) => {
    if (score >= 70) return 'Excellent Match'
    if (score >= 50) return 'Good Match'
    if (score >= 30) return 'Partial Match'
    return 'Low Match'
  }

  return (
    <main className="min-h-screen p-8 md:p-12 max-w-6xl mx-auto">
      {/* Header */}
      <header className="mb-16 md:hidden flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-zinc-900 dark:bg-white rounded-lg flex items-center justify-center">
            <span className="text-white dark:text-zinc-950 font-bold text-lg">S</span>
          </div>
          <span className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">SkillMatch</span>
        </div>
      </header>

      <div className="max-w-3xl">
        <h1 className="text-5xl md:text-6xl font-bold tracking-tighter mb-6 text-zinc-900 dark:text-white">
          Semantic Job<br/>Matching
        </h1>
        <p className="text-xl text-zinc-500 dark:text-zinc-400 mb-4 leading-relaxed max-w-2xl">
          Upload your resume and our <span className="text-zinc-900 dark:text-white font-medium">RDF/OWL ontology</span> system 
          will find jobs using <span className="text-zinc-900 dark:text-white font-medium">SPARQL-based semantic matching</span>.
        </p>
        <div className="flex flex-wrap gap-2 mb-12">
          <span className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full text-sm font-medium text-zinc-600 dark:text-zinc-400">RDF Triples</span>
          <span className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full text-sm font-medium text-zinc-600 dark:text-zinc-400">OWL Ontology</span>
          <span className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full text-sm font-medium text-zinc-600 dark:text-zinc-400">SPARQL Queries</span>
          <span className="px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full text-sm font-medium text-zinc-600 dark:text-zinc-400">SHACL Validation</span>
        </div>

        <form onSubmit={handleSubmit} className="mb-20">
          <div className="mb-6">
            <label
              htmlFor="file-upload"
              className={`group relative block w-full py-16 px-8 border-2 border-dashed rounded-2xl text-center cursor-pointer transition-all duration-300 ${
                file
                  ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900'
                  : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-900'
              } ${loading ? 'opacity-50 cursor-wait' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                if (!loading) {
                  e.currentTarget.classList.add('scale-[1.01]')
                }
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('scale-[1.01]')
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('scale-[1.01]')
                if (loading) return
                
                const droppedFile = e.dataTransfer.files[0]
                if (droppedFile && droppedFile.type === 'application/pdf') {
                  if (droppedFile.size <= 5 * 1024 * 1024) {
                    setFile(droppedFile)
                    setError('')
                    setResults([])
                    setExtractedSkills([])
                  } else {
                    setError('File too large')
                  }
                } else {
                  setError('PDF only')
                }
              }}
            >
              <input
                id="file-upload"
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                disabled={loading}
                className="hidden"
              />
              <div className="space-y-4">
                <div className="w-16 h-16 mx-auto bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                  <svg className="w-8 h-8 text-zinc-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                {file ? (
                  <div>
                    <div className="text-lg font-semibold text-zinc-900 dark:text-white">
                      {file.name}
                    </div>
                    <div className="text-sm text-zinc-500">
                      {(file.size / 1024).toFixed(0)} KB • Click to replace
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="text-lg font-semibold text-zinc-900 dark:text-white">
                      Click to upload or drag PDF
                    </div>
                    <div className="text-sm text-zinc-500">
                      Max file size 5MB
                    </div>
                  </div>
                )}
              </div>
            </label>
          </div>

          {error && (
            <div className="p-4 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-xl mb-6 text-sm font-medium flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !file}
            className={`w-full py-4 px-6 rounded-xl text-lg font-semibold transition-all duration-300 ${
              loading || !file
                ? 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600 cursor-not-allowed'
                : 'bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100 shadow-lg hover:shadow-xl hover:-translate-y-0.5'
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Running SPARQL matching...
              </span>
            ) : 'Find Semantic Matches'}
          </button>
        </form>

        {/* Extracted Skills */}
        {extractedSkills.length > 0 && (
          <div className="mb-8 p-6 bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-3">
              📋 Skills Extracted from Resume ({extractedSkills.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {extractedSkills.map((skill, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-300"
                >
                  {skill}
                </span>
              ))}
            </div>
            {semanticInfo && (
              <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <p className="text-xs text-zinc-500">
                  <span className="font-medium">Method:</span> {semanticInfo.method}
                </p>
              </div>
            )}
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-10 duration-700">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-4 gap-2">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
                🎯 Job Matches
              </h2>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                Found {results.length} matching positions
              </span>
            </div>
            
            <div className="grid gap-6">
              {results.map((job, index) => (
                <div
                  key={job.id}
                  className="group p-6 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl hover:border-zinc-400 dark:hover:border-zinc-600 transition-all duration-300"
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-4">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500">
                          #{index + 1}
                        </span>
                        <h3 className="text-xl font-bold text-zinc-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {job.title}
                        </h3>
                      </div>
                      <p className="text-zinc-500 font-medium">
                        {job.company} • {job.location}
                      </p>
                    </div>
                    {job.matchScore !== undefined && (
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                            <div 
                              className={`h-full ${getScoreColor(job.matchScore)} transition-all duration-500`}
                              style={{ width: `${job.matchScore}%` }}
                            />
                          </div>
                          <span className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-full text-sm font-bold border border-zinc-200 dark:border-zinc-700 min-w-[70px] text-center">
                            {Math.round(job.matchScore)}%
                          </span>
                        </div>
                        <span className="text-xs text-zinc-500">{getScoreLabel(job.matchScore)}</span>
                      </div>
                    )}
                  </div>

                  {/* Skill Match Details */}
                  {job.matchedSkills && job.matchedSkills.length > 0 && (
                    <div className="mb-4 p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                          Skill Matches ({job.matchedSkills.length}/{job.skills.length} required)
                        </h4>
                      </div>
                      <div className="space-y-2">
                        {job.matchedSkills.slice(0, 6).map((match, idx) => {
                          const typeInfo = matchTypeLabels[match.matchType] || matchTypeLabels.exact
                          return (
                            <div
                              key={idx}
                              className="flex items-center gap-2 text-sm"
                            >
                              <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${typeInfo.color}`}>
                                {typeInfo.icon}
                              </span>
                              <span className="text-zinc-700 dark:text-zinc-300">
                                <span className="font-medium">{match.personSkillName}</span>
                                {match.matchType !== 'exact' && (
                                  <span className="text-zinc-500"> → {match.jobSkillName}</span>
                                )}
                              </span>
                              <span className={`ml-auto px-2 py-0.5 rounded text-xs ${typeInfo.color}`}>
                                {match.matchType === 'exact' ? 'Exact' : typeInfo.label}
                              </span>
                            </div>
                          )
                        })}
                        {job.matchedSkills.length > 6 && (
                          <p className="text-xs text-zinc-400 pt-1">
                            +{job.matchedSkills.length - 6} more matches
                          </p>
                        )}
                      </div>
                      
                      {/* Missing Skills */}
                      {job.skills.length > job.matchedSkills.length && (
                        <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
                          <p className="text-xs text-zinc-500 mb-2">Missing skills:</p>
                          <div className="flex flex-wrap gap-1">
                            {job.skills
                              .filter(skill => !job.matchedSkills?.some(m => 
                                m.jobSkillName.toLowerCase() === skill.toLowerCase() ||
                                m.jobSkillUri.includes(skill.toLowerCase().replace(/\s+/g, '-'))
                              ))
                              .slice(0, 5)
                              .map((skill, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-0.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded text-xs"
                                >
                                  {skill}
                                </span>
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  
                  <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6 line-clamp-2 text-sm">
                    {job.summary || job.description}
                  </p>
                  
                  <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800/50">
                    <div className="flex flex-wrap gap-2 flex-1">
                      {job.skills.slice(0, 4).map((skill, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 bg-zinc-50 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-lg text-xs font-medium"
                        >
                          {skill}
                        </span>
                      ))}
                      {job.skills.length > 4 && (
                        <span className="px-3 py-1 text-xs text-zinc-400">
                          +{job.skills.length - 4} more
                        </span>
                      )}
                    </div>
                    
                    {job.url && (
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        Apply Now
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state when no results after search */}
        {!loading && results.length === 0 && file && !error && extractedSkills.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <p className="text-zinc-500 dark:text-zinc-400">
              Click &quot;Find Semantic Matches&quot; to analyze your resume
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
