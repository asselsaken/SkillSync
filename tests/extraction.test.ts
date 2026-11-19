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
