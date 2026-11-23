import { describe, expect, it } from 'vitest'
import { analyseLine, analyseRequirements } from '../lib/jobs/groups'
import { RDFSkill } from '../lib/rdf/types'

const skill = (id: string, name: string, aliases: string[] = []): RDFSkill => ({
  id, uri: `http://skillmatch.org/skill#${id}`, name, aliases,
  broaderSkills: [], narrowerSkills: [], similarSkills: [], equivalentSkills: [],
})
const skills = [
  skill('aws', 'AWS'), skill('gcp', 'GCP'), skill('azure', 'Azure'),
  skill('python', 'Python'), skill('sql', 'SQL'), skill('java', 'Java'), skill('go', 'Go'),
  skill('docker', 'Docker'), skill('kubernetes', 'Kubernetes'),
]

describe('analyseLine', () => {
  it('treats "A, B, or C" as alternatives', () => {
    expect(analyseLine('Experience with AWS, GCP, or Azure', skills)).toEqual({ singles: [], groups: [['aws', 'gcp', 'azure']] })
  })

  it('treats "A and B" as both required', () => {
    expect(analyseLine('Strong Python and SQL skills', skills)).toEqual({ singles: ['python', 'sql'], groups: [] })
  })

  it('treats slash pairs and example lists as alternatives', () => {
    expect(analyseLine('Java/Go experience', skills).groups).toEqual([['java', 'go']])
    expect(analyseLine('a backend language (e.g. Python, Java, Go)', skills).groups).toEqual([['python', 'java', 'go']])
  })

  it('keeps separate lists in one line apart', () => {
    const r = analyseLine('Python and SQL; deploy with Docker or Kubernetes on AWS', skills)
    expect(r.singles).toEqual(['python', 'sql', 'aws'])
    expect(r.groups).toEqual([['docker', 'kubernetes']])
  })
})

describe('analyseRequirements', () => {
  it('drops a group member that is also required on its own', () => {
    const r = analyseRequirements('Python or Java\nDeep Python expertise', skills)
    expect(r).toEqual({ singles: ['python', 'java'], groups: [] })
  })

  it('merges duplicate groups across lines', () => {
    const r = analyseRequirements('AWS or GCP\nGCP/AWS certification', skills)
    expect(r).toEqual({ singles: [], groups: [['aws', 'gcp']] })
  })
})

describe('example cues', () => {
  it('does not treat an "and" list after "like" as alternatives', () => {
    expect(analyseLine('distributed systems using technologies like AWS, Docker and Kubernetes', skills))
      .toEqual({ singles: ['aws', 'docker', 'kubernetes'], groups: [] })
  })
})
