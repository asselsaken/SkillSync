import { beforeAll, describe, expect, it } from 'vitest'
import { normalizeAshby, normalizeGreenhouse, normalizeLever } from '../lib/jobs/boards'
import { jobsToQuads, tagSkills } from '../lib/jobs/rdf'
import { htmlToText, isDegreeLine, isRelevantRole, roleExcerpt, splitSections, truncate } from '../lib/jobs/text'
import { Company } from '../lib/jobs/types'
import { MemoryGraphStore } from '../lib/rdf/store'
import { ONTOLOGY_DIR, ONTOLOGY_FILES, readTurtleFile, validateQuads } from '../lib/rdf/shacl'
import { RDFSkill } from '../lib/rdf/types'

const acme: Company = { name: 'Acme', board: 'greenhouse', slug: 'acme' }

const DESCRIPTION_HTML = `&lt;h2&gt;About Acme&lt;/h2&gt;&lt;p&gt;We are an AI company.&lt;/p&gt;
&lt;h3&gt;What you'll need&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;5+ years of Python and SQL&lt;/li&gt;&lt;li&gt;Experience with Spark&lt;/li&gt;&lt;/ul&gt;
&lt;h3&gt;Nice to have&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Kubernetes&lt;/li&gt;&lt;/ul&gt;
&lt;h3&gt;Benefits&lt;/h3&gt;&lt;p&gt;We use Tableau for our wellness dashboards.&lt;/p&gt;`

let skills: RDFSkill[]
beforeAll(async () => {
  const store = new MemoryGraphStore(ONTOLOGY_DIR, ONTOLOGY_FILES)
  await store.initialize()
  skills = await store.getAllSkills()
})

describe('text helpers', () => {
  it('converts escaped HTML to text with line breaks', () => {
    const text = htmlToText(DESCRIPTION_HTML)
    expect(text).toContain('About Acme')
    expect(text).toContain('• 5+ years of Python and SQL')
    expect(text).not.toMatch(/<|&lt;/)
  })

  it('keeps technical roles and drops non-technical ones', () => {
    expect(isRelevantRole('Senior Software Engineer, Payments')).toBe(true)
    expect(isRelevantRole('Data Scientist')).toBe(true)
    expect(isRelevantRole('Machine Learning Researcher')).toBe(true)
    expect(isRelevantRole('Account Executive, Enterprise')).toBe(false)
    expect(isRelevantRole('Technical Recruiter')).toBe(false)
    expect(isRelevantRole('Sales Engineer')).toBe(false)
    expect(isRelevantRole('Strategic Finance Analyst')).toBe(false)
    expect(isRelevantRole('Product Manager, Data Platform')).toBe(false)
  })

  it('splits requirements, nice-to-haves and boilerplate', () => {
    const { required, preferred } = splitSections(htmlToText(DESCRIPTION_HTML))
    expect(required).toContain('Python and SQL')
    expect(preferred).toContain('Kubernetes')
    expect(required + preferred).not.toContain('Tableau') // benefits section dropped
  })

  it('truncates on a word boundary', () => {
    expect(truncate('one two three four', 10)).toBe('one two…')
    expect(truncate('short', 10)).toBe('short')
  })
})

describe('board normalisers', () => {
  it('normalises Greenhouse', () => {
    const [job] = normalizeGreenhouse(acme, {
      jobs: [{
        id: 123, title: ' Data Engineer ', absolute_url: 'https://boards.greenhouse.io/acme/jobs/123',
        location: { name: 'Remote - US' }, first_published: '2026-11-01T10:00:00-04:00',
        departments: [{ name: 'Data' }], content: DESCRIPTION_HTML,
      }],
    })
    expect(job).toMatchObject({
      id: 'acme-123', source: 'greenhouse', title: 'Data Engineer', location: 'Remote - US',
      isRemote: true, department: 'Data', datePosted: '2026-11-01',
    })
    expect(job.description).toContain('Python and SQL')
  })

  it('normalises Lever, including list sections', () => {
    const [job] = normalizeLever({ ...acme, board: 'lever' }, [{
      id: 'abc-def', text: 'Backend Engineer', hostedUrl: 'https://jobs.lever.co/acme/abc-def',
      applyUrl: 'https://jobs.lever.co/acme/abc-def/apply', createdAt: 1793000000000,
      categories: { location: 'New York, NY', commitment: 'Full-time', team: 'Platform' }, workplaceType: 'hybrid',
      descriptionPlain: 'Build our API.', lists: [{ text: 'Requirements', content: '<li>Go and PostgreSQL</li>' }],
    }])
    expect(job).toMatchObject({ id: 'acme-abc-def', isRemote: false, employmentType: 'Full-time', department: 'Platform' })
    expect(job.description).toContain('Go and PostgreSQL')
    expect(job.applyUrl).toMatch(/\/apply$/)
  })

  it('normalises Ashby and skips unlisted postings', () => {
    const jobs = normalizeAshby({ ...acme, board: 'ashby' }, {
      jobs: [
        { id: 'u1', title: 'ML Engineer', jobUrl: 'https://jobs.ashbyhq.com/acme/u1', isRemote: true,
          employmentType: 'FullTime', publishedAt: '2026-10-01T00:00:00Z', descriptionPlain: 'PyTorch',
          compensation: { compensationTierSummary: '$150K – $200K' } },
        { id: 'u2', title: 'Hidden', jobUrl: 'https://jobs.ashbyhq.com/acme/u2', isListed: false },
      ],
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ isRemote: true, employmentType: 'Full-time', salary: '$150K – $200K' })
  })
})

describe('skill tagging and RDF output', () => {
  const job = () =>
    normalizeGreenhouse(acme, {
      jobs: [{ id: 1, title: 'Data Engineer', absolute_url: 'https://example.com/1', location: { name: 'NYC' },
        first_published: '2026-11-01', content: DESCRIPTION_HTML }],
    })[0]

  it('separates required from preferred skills and ignores categories and benefits', () => {
    const tagged = tagSkills(job(), skills)
    expect(tagged.requiredSkills).toEqual(expect.arrayContaining(['python', 'sql', 'spark']))
    expect(tagged.preferredSkills).toEqual(['kubernetes'])
    expect(tagged.requiredSkills).not.toContain('artificial-intelligence') // "AI company" boilerplate
    expect(tagged.requiredSkills).not.toContain('tableau') // benefits section
  })

  it('produces SHACL-valid RDF', async () => {
    const quads = jobsToQuads([tagSkills(job(), skills)])
    const report = await validateQuads([...ONTOLOGY_FILES.flatMap((f) => readTurtleFile(f)), ...quads])
    expect(report.violations).toEqual([])
  })
})

describe('employer self-mentions', () => {
  it("doesn't tag a company's own product as a requirement of its postings", () => {
    const databricks: Company = { name: 'Databricks', board: 'greenhouse', slug: 'databricks' }
    const [job] = normalizeGreenhouse(databricks, {
      jobs: [{ id: 9, title: 'Software Engineer', absolute_url: 'https://example.com/9',
        content: 'Requirements\n• Build Databricks features in Scala, Python and Spark for our customers' }],
    })
    const tagged = tagSkills(job, skills)
    expect(tagged.requiredSkills).not.toContain('databricks')
    expect(tagged.requiredSkills).toEqual(expect.arrayContaining(['python', 'spark']))
  })
})

describe('"any of" requirements in postings', () => {
  it('tags alternatives as a group and serialises valid RDF', async () => {
    const [job] = normalizeGreenhouse(acme, {
      jobs: [{ id: 7, title: 'Platform Engineer', absolute_url: 'https://example.com/7',
        content: 'Requirements\n• Python and Kubernetes\n• Experience with AWS, GCP, or Azure' }],
    })
    const tagged = tagSkills(job, skills)
    expect(tagged.requiredSkills).toEqual(expect.arrayContaining(['python', 'kubernetes']))
    expect(tagged.requiredGroups).toEqual([['aws', 'gcp', 'azure']])

    const quads = jobsToQuads([tagged])
    expect(quads.some((q) => q.predicate.value.endsWith('#requiresOneOf'))).toBe(true)
    const report = await validateQuads([...ONTOLOGY_FILES.flatMap((f) => readTurtleFile(f)), ...quads])
    expect(report.violations).toEqual([])
  })
})

describe('role excerpts', () => {
  it('starts at the role heading, skipping the company intro', () => {
    const text = 'About Acme\nAcme builds rockets for everyone.\nAbout the role\nYou will build our data platform and own its reliability.\nBenefits\nFree lunch.'
    expect(roleExcerpt(text)).toBe('You will build our data platform and own its reliability.')
  })

  it('falls back to the first sentence about the role', () => {
    const text = 'Acme is the leading rocket company. We are looking for a Data Engineer to build pipelines for launch telemetry.'
    expect(roleExcerpt(text)).toBe('We are looking for a Data Engineer to build pipelines for launch telemetry.')
  })

  it('never picks text from the benefits section', () => {
    const text = 'Acme builds rockets and launch systems for the world.\nBenefits\nIn this role you may be eligible for a bonus.'
    expect(roleExcerpt(text)).toBe('Acme builds rockets and launch systems for the world.')
  })
})

describe('degree lines', () => {
  it('does not read fields of study as skills', () => {
    expect(isDegreeLine('• MS or PhD in Computer Science, Statistics, Operations Research or a related field')).toBe(true)
    expect(isDegreeLine("Bachelor's degree in Mathematics")).toBe(true)
    expect(isDegreeLine('• 5+ years of Python and SQL')).toBe(false)
    expect(isDegreeLine('Experience with MS SQL Server')).toBe(false)
  })
})
