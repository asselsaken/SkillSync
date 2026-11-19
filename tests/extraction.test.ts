import { describe, expect, it } from 'vitest'
import { containsWholeTerm, extractSkillIds } from '../lib/rdf/semantic-matcher'
import { RDFSkill } from '../lib/rdf/types'

const skill = (id: string, name: string, aliases: string[] = []): RDFSkill => ({
  id,
  uri: `http://skillmatch.org/skill#${id}`,
  name,
  aliases,
  broaderSkills: [],
  narrowerSkills: [],
  similarSkills: [],
  equivalentSkills: [],
})

describe('containsWholeTerm', () => {
  it('matches standalone terms case-insensitively', () => {
    expect(containsWholeTerm('Experienced in python and SQL', 'Python')).toBe(true)
  })

  it('does not match a short term inside a longer word', () => {
    expect(containsWholeTerm('Looking for a developer', 'R')).toBe(false)
    expect(containsWholeTerm('Strong JavaScript skills', 'Java')).toBe(false)
  })

  it('handles symbols inside a token', () => {
    expect(containsWholeTerm('C# developer', 'C#')).toBe(true)
    expect(containsWholeTerm('Modern C++ (17/20)', 'C++')).toBe(true)
    expect(containsWholeTerm('Wrote C++ code', 'C')).toBe(false)
    expect(containsWholeTerm('APIs in Node.js', 'Node.js')).toBe(true)
  })

  it('allows a trailing sentence period', () => {
    expect(containsWholeTerm('I mostly write Python.', 'Python')).toBe(true)
  })

  it('does not match an alias that is part of a dotted name', () => {
    expect(containsWholeTerm('Frontend in Vue.js', 'js')).toBe(false)
  })
})

describe('extractSkillIds', () => {
  const skills = [
    skill('python', 'Python', ['python3']),
    skill('r', 'R', ['r language']),
    skill('postgresql', 'PostgreSQL', ['postgres']),
  ]

  it('finds skills by name or alias, once each', () => {
    const ids = extractSkillIds('Python, python3 and Postgres for analytics', skills)
    expect(ids.sort()).toEqual(['postgresql', 'python'])
  })

  it('returns nothing for unrelated text', () => {
    expect(extractSkillIds('Great communicator and team player', skills)).toEqual([])
  })
})

describe('extractSkillIds overlap and equivalence', () => {
  const ab = { ...skill('a-b-testing', 'A/B Testing', ['ab testing']) }
  const testing = skill('testing', 'Testing', ['unit testing'])
  const llms = { ...skill('llms', 'LLMs', ['large language models']), equivalentSkills: ['large-language-models'] }
  const lllm = { ...skill('large-language-models', 'Large Language Models'), equivalentSkills: ['llms'] }

  it('prefers the longest overlapping match', () => {
    expect(extractSkillIds('Ran A/B testing at scale', [ab, testing])).toEqual(['a-b-testing'])
    expect(extractSkillIds('A/B testing and unit testing', [ab, testing]).sort()).toEqual(['a-b-testing', 'testing'])
  })

  it('keeps one skill per equivalence pair', () => {
    expect(extractSkillIds('LLMs, i.e. large language models', [llms, lllm])).toEqual(['llms'])
  })
})

describe('case-sensitive skills', () => {
  const go = { ...skill('go', 'Go', ['golang']), caseSensitive: true }

  it('matches the exact name and aliases', () => {
    expect(extractSkillIds('Backend services in Go and Python', [go])).toEqual(['go'])
    expect(extractSkillIds('Experience with golang', [go])).toEqual(['go'])
  })

  it('ignores the ordinary word and hyphenated phrases', () => {
    expect(extractSkillIds('ready to go, on the go', [go])).toEqual([])
    expect(extractSkillIds('Go-to-market strategy', [go])).toEqual([])
    expect(extractSkillIds('GO TEAM', [go])).toEqual([])
  })
})

describe('slash-separated skills', () => {
  const js = skill('javascript', 'JavaScript')
  const ts = skill('typescript', 'TypeScript')
  const cicd = skill('ci-cd', 'CI/CD')
  const ab = skill('a-b-testing', 'A/B Testing')
  const testing = skill('testing', 'Testing')

  it('splits "A/B" pairs of skills', () => {
    expect(extractSkillIds('Strong JavaScript/TypeScript skills', [js, ts]).sort()).toEqual(['javascript', 'typescript'])
  })

  it('keeps slash terms whole', () => {
    expect(extractSkillIds('CI/CD pipelines', [cicd])).toEqual(['ci-cd'])
    expect(extractSkillIds('ran A/B testing', [ab, testing])).toEqual(['a-b-testing'])
  })
})

describe('partially overlapping matches', () => {
  it('keeps both skills when matches share a word', () => {
    const stream = skill('stream-processing', 'Stream Processing', ['streaming data'])
    const pipes = skill('data-pipelines', 'Data Pipelines')
    expect(extractSkillIds('Built streaming data pipelines', [stream, pipes]).sort()).toEqual(['data-pipelines', 'stream-processing'])
  })
})

describe('generateSummary', () => {
  it('turns bullet lists into sentences', async () => {
    const { generateSummary } = await import('../lib/rdf/semantic-matcher')
    expect(generateSummary('• Build APIs\n• Own on-call rotations')).toBe('Build APIs. Own on-call rotations.')
  })
})

describe('non-English letters', () => {
  it('treats accented letters as part of a word', () => {
    expect(containsWholeTerm('Sample résumé', 'R')).toBe(false)
    expect(containsWholeTerm('Analyse in R und Python', 'R')).toBe(true)
    expect(extractSkillIds('Expérience: Python, SQL', [skill('python', 'Python'), skill('sql', 'SQL')]).sort()).toEqual(['python', 'sql'])
  })
})
