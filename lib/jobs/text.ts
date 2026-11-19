/**
 * Text helpers for job descriptions: HTML → plain text, role filtering,
 * and splitting a description into required / preferred / ignored parts.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m
  })
}

/** Convert HTML (possibly entity-escaped, as Greenhouse returns it) to plain text with line breaks. */
export function htmlToText(html: string): string {
  let s = html
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s) // Greenhouse double-escapes its HTML
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(s)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ------------------------------------------------------------------ roles

const ROLE_INCLUDE =
  /\b(engineer(ing)?|developer|programmer|scientist|machine learning|ml|data|analytics|sre|devops|architect|research(er)?|quant(itative)?|infrastructure|software|backend|back-end|frontend|front-end|full[- ]?stack|mobile|ios|android)\b/i

const ROLE_EXCLUDE =
  /\b(sales|account (executive|manager|director)|recruit(er|ing|ment)?|talent|sourcer|marketing|counsel|legal|attorney|paralegal|accountant|accounting|payroll|tax|customer success|customer support|support specialist|executive assistant|office manager|facilities|people partner|hrbp|business development|partnerships?|communications|brand|events?|government affairs|public policy|go[- ]to[- ]market|gtm|finance|financial|strategist|(product|program|project) manager|designer|solutions consultant|deployment)\b/i

/** Keep technical roles (engineering, data, ML, research), drop sales, legal, recruiting and similar. */
export function isRelevantRole(title: string): boolean {
  return ROLE_INCLUDE.test(title) && !ROLE_EXCLUDE.test(title)
}

// ------------------------------------------------------------------ sections

const HEADING_MAX_LENGTH = 80

const PREFERRED_HEADING =
  /\b(nice[- ]to[- ]haves?|preferred( qualifications| skills| experience)?|bonus( points)?|pluses|a plus|extra credit|would be great|stand out|even better|ideal(ly)?)\b/i

const IGNORED_HEADING =
  /\b(benefits|perks|compensation|salary|pay (range|transparency)|what we offer|equal (employment|opportunity)|eeo|accommodations?|privacy|about (us|the company)|who we are|our (mission|values)|life at|why join)\b/i

const REQUIRED_HEADING =
  /\b(requirements|qualifications|what you('| wi)ll (need|bring)|what we('re| are) looking for|you (have|bring|might be)|who you are|about you|responsibilities|what you('| wi)ll do|the role|minimum|basic)\b/i

const isHeading = (line: string) => line.length > 0 && line.length <= HEADING_MAX_LENGTH && !/[.;]$/.test(line)

/**
 * Split a description into text describing required skills and text describing
 * preferred ("nice to have") skills. Benefits, EEO and company boilerplate are dropped.
 */
export function splitSections(description: string): { required: string; preferred: string } {
  const required: string[] = []
  const preferred: string[] = []
  let mode: 'required' | 'preferred' | 'ignored' = 'required'

  for (const raw of description.split('\n')) {
    const line = raw.replace(/^[•\-*\s]+/, '').trim()
    if (isHeading(line)) {
      if (PREFERRED_HEADING.test(line)) mode = 'preferred'
      else if (IGNORED_HEADING.test(line)) mode = 'ignored'
      else if (REQUIRED_HEADING.test(line)) mode = 'required'
    }
    if (mode === 'required') required.push(raw)
    else if (mode === 'preferred') preferred.push(raw)
  }

  return { required: required.join('\n'), preferred: preferred.join('\n') }
}

/** Shorten text to at most `max` characters, ending on a word boundary. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > 0 ? cut.slice(0, space) : cut).trimEnd() + '…'
}

export function toIsoDate(value: string | number | undefined | null): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10)
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// ------------------------------------------------------------------ summaries

const ROLE_HEADING =
  /\b(about the (role|job|position|team|opportunity)|the role|role (overview|summary|description)|the opportunity|position (overview|summary)|job (summary|description|overview)|what you['’]ll (do|work on)|what you will (do|work on)|your (role|impact|responsibilities|mission)|responsibilities|in this role)\b/i

const ROLE_PHRASE =
  /\b(you['’]ll|you will|we['’]re looking for|we are looking for|we['’]re hiring|we are hiring|we['’]re seeking|we are seeking|in this role|this role|the role|your role|join (our|the) [a-z]+ team)\b/i
/** "As a Senior Engineer, …" (capitalised title, so "as a result" doesn't count) */
const AS_A_TITLE = /\b[Aa]s an? [A-Z]/

const firstRoleSentence = (text: string) => {
  const hits = [text.search(ROLE_PHRASE), text.search(AS_A_TITLE)].filter((i) => i >= 0)
  return hits.length ? Math.min(...hits) : -1
}

/**
 * The part of a description that is about the role rather than the company:
 * text after a role heading ("About the role", "What you'll do"…), else from the
 * first sentence that speaks about the role, else the whole description.
 */
export function roleExcerpt(description: string): string {
  // Benefits, EEO and "About us" sections are dropped first.
  const body = splitSections(description).required.trim() || description
  const lines = body.split('\n')

  const heading = lines.findIndex((l) => {
    const line = l.replace(/^[•\-*\s]+/, '').trim()
    return isHeading(line) && ROLE_HEADING.test(line) && !/company/i.test(line)
  })
  if (heading >= 0) {
    const rest = lines.slice(heading + 1).join('\n').trim()
    if (rest.length >= 50) return rest
  }

  const sentence = firstRoleSentence(body)
  if (sentence >= 0) {
    // Back up to the start of that sentence (or line)
    const before = body.slice(0, sentence)
    const starts = [before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? ')].map((i) => (i < 0 ? 0 : i + 2))
    const start = Math.max(...starts, before.lastIndexOf('\n') + 1)
    const rest = body.slice(start).trim()
    if (rest.length >= 50) return rest
  }
  return body
}
