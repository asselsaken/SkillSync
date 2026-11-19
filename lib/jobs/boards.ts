/**
 * Adapters for public job-board APIs. Each board publishes a company's open
 * positions as JSON; no key or login is needed.
 *
 *   Greenhouse  https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 *   Lever       https://api.lever.co/v0/postings/{slug}?mode=json
 *   Ashby       https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true
 */

import { Board, Company, NormalizedJob } from './types'
import { htmlToText, slugify, toIsoDate } from './text'


const USER_AGENT = 'SkillMatch job fetcher'

export const BOARD_URLS: Record<Board, (slug: string) => string> = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s)}/jobs?content=true`,
  lever: (s) => `https://api.lever.co/v0/postings/${encodeURIComponent(s)}?mode=json`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(s)}?includeCompensation=true`,
}

const jobId = (company: Company, sourceId: string) => slugify(`${company.slug}-${sourceId}`)
const isRemoteText = (s?: string) => !!s && /\bremote\b/i.test(s)

// ------------------------------------------------------------------ normalisers

export function normalizeGreenhouse(company: Company, payload: any): NormalizedJob[] {
  return (payload?.jobs ?? []).map((j: any): NormalizedJob => {
    const location: string | undefined = j.location?.name || undefined
    return {
      id: jobId(company, String(j.id)),
      source: 'greenhouse',
      sourceId: String(j.id),
      company,
      title: String(j.title ?? '').trim(),
      department: j.departments?.[0]?.name || undefined,
      location,
      isRemote: isRemoteText(location),
      url: j.absolute_url,
      applyUrl: j.absolute_url,
      datePosted: toIsoDate(j.first_published ?? j.updated_at),
      description: htmlToText(j.content ?? ''),
    }
  })
}

export function normalizeLever(company: Company, payload: any): NormalizedJob[] {
  if (!Array.isArray(payload)) return []
  return payload.map((j: any): NormalizedJob => {
    const lists = (j.lists ?? [])
      .map((l: any) => `${l.text ?? ''}\n${htmlToText(l.content ?? '')}`)
      .join('\n\n')
    const description = [j.descriptionPlain, lists, j.additionalPlain].filter(Boolean).join('\n\n')
    const location: string | undefined = j.categories?.location || undefined
    return {
      id: jobId(company, String(j.id)),
      source: 'lever',
      sourceId: String(j.id),
      company,
      title: String(j.text ?? '').trim(),
      department: j.categories?.team || j.categories?.department || undefined,
      location,
      isRemote: j.workplaceType === 'remote' || isRemoteText(location),
      employmentType: j.categories?.commitment || undefined,
      url: j.hostedUrl,
      applyUrl: j.applyUrl || j.hostedUrl,
      datePosted: toIsoDate(j.createdAt),
      description: description.trim(),
    }
  })
}

const ASHBY_EMPLOYMENT: Record<string, string> = {
  FullTime: 'Full-time',
  PartTime: 'Part-time',
  Contract: 'Contract',
  Intern: 'Internship',
  Temporary: 'Temporary',
}

export function normalizeAshby(company: Company, payload: any): NormalizedJob[] {
  return (payload?.jobs ?? [])
    .filter((j: any) => j.isListed !== false)
    .map((j: any): NormalizedJob => ({
      id: jobId(company, String(j.id)),
      source: 'ashby',
      sourceId: String(j.id),
      company,
      title: String(j.title ?? '').trim(),
      department: j.department || j.team || undefined,
      location: j.location || undefined,
      isRemote: j.isRemote === true || j.workplaceType === 'Remote',
      employmentType: ASHBY_EMPLOYMENT[j.employmentType] ?? j.employmentType ?? undefined,
      url: j.jobUrl,
      applyUrl: j.applyUrl || j.jobUrl,
      datePosted: toIsoDate(j.publishedAt),
      salary: j.compensation?.compensationTierSummary || undefined,
      description: j.descriptionPlain ? String(j.descriptionPlain).trim() : htmlToText(j.descriptionHtml ?? ''),
    }))
}

const NORMALIZERS: Record<Board, (c: Company, p: any) => NormalizedJob[]> = {
  greenhouse: normalizeGreenhouse,
  lever: normalizeLever,
  ashby: normalizeAshby,
}

// ------------------------------------------------------------------ fetching

async function fetchJson(url: string, attempts = 3): Promise<any> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      })
      if (res.status === 404) throw new Error('board not found (404)')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (error) {
      lastError = error
      if (String(error).includes('404')) break
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i))
    }
  }
  throw lastError
}

/** Fetch and normalise all open postings for one company. */
export async function fetchCompanyJobs(company: Company): Promise<NormalizedJob[]> {
  const payload = await fetchJson(BOARD_URLS[company.board](company.slug))
  return NORMALIZERS[company.board](company, payload).filter((j) => j.title && j.url)
}
