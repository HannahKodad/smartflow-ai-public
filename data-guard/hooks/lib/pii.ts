// Pattern-based detection of personal data. Heuristic by nature:
// identifiers with a checksum (CZ/SK birth number, Swedish personnummer,
// IBAN) are reliable; phones and especially addresses are best effort.

export type PiiKind = 'rodne-cislo' | 'personnummer' | 'samordningsnummer' | 'email' | 'telefon' | 'adresa' | 'iban'

export type PiiHit = { kind: PiiKind; value: string; index: number }

export const PII_LABEL: Record<PiiKind, string> = {
  'rodne-cislo': 'rodné číslo (CZ/SK)',
  personnummer: 'personnummer (SE)',
  samordningsnummer: 'samordningsnummer (SE)',
  email: 'e-mail',
  telefon: 'telefon',
  adresa: 'adresa',
  iban: 'IBAN',
}

const digits = (s: string) => s.replace(/\D/g, '')

/** Does the first six digits form a plausible RRMMDD date (CZ/SK month offsets)? */
function validRcDate(d: string): boolean {
  if (d.length < 6) return false
  let mm = Number(d.slice(2, 4))
  const dd = Number(d.slice(4, 6))
  if (mm > 70) mm -= 70
  else if (mm > 50) mm -= 50
  else if (mm > 20) mm -= 20
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31
}

/** FORMAT match for a CZ/SK rodné číslo (no checksum). Used for detection: a
 *  plausible number is flagged even if its check digit is wrong, so a mistyped
 *  real number never slips through. `isRodneCislo` adds the checksum test. */
export function looksLikeRodneCislo(raw: string): boolean {
  const hasSlash = raw.includes('/')
  const d = digits(raw)
  if (d.length !== 9 && d.length !== 10) return false
  if (d.length === 9 && !hasSlash) return false
  return validRcDate(d)
}

/** CZ/SK rodné číslo WITH checksum (strict): RRMMDD/XXXX, slash optional. */
export function isRodneCislo(raw: string): boolean {
  const hasSlash = raw.includes('/')
  const d = digits(raw)
  if (d.length !== 9 && d.length !== 10) return false
  if (d.length === 9 && !hasSlash) return false // too ambiguous without the slash
  const yy = Number(d.slice(0, 2))
  let mm = Number(d.slice(2, 4))
  const dd = Number(d.slice(4, 6))
  if (mm > 70) mm -= 70
  else if (mm > 50) mm -= 50
  else if (mm > 20) mm -= 20
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false
  if (d.length === 9) return yy < 54
  const n = BigInt(d)
  if (n % 11n === 0n) return true
  // Old rule: when the first nine digits mod 11 give 10, the check digit is 0.
  return BigInt(d.slice(0, 9)) % 11n === 10n && d[9] === '0'
}

function luhn(d: string): boolean {
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i])
    if (i % 2 === 1) {
      x *= 2
      if (x > 9) x -= 9
    }
    sum += x
  }
  return sum % 10 === 0
}

/** Swedish personnummer / samordningsnummer WITH Luhn (strict). */
export function swedishId(raw: string): 'personnummer' | 'samordningsnummer' | null {
  const kind = looksLikeSwedish(raw)
  if (!kind) return null
  let d = digits(raw)
  if (d.length === 12) d = d.slice(2)
  return luhn(d) ? kind : null
}

/** FORMAT match for a Swedish id (no Luhn): (YY)YYMMDD[-+]NNNN, day range decides kind. */
export function looksLikeSwedish(raw: string): 'personnummer' | 'samordningsnummer' | null {
  let d = digits(raw)
  if (d.length === 12) d = d.slice(2)
  if (d.length !== 10) return null
  const mm = Number(d.slice(2, 4))
  const dd = Number(d.slice(4, 6))
  if (mm < 1 || mm > 12) return null
  if (dd >= 1 && dd <= 31) return 'personnummer'
  if (dd >= 61 && dd <= 91) return 'samordningsnummer'
  return null
}

/** FORMAT match for an IBAN (no checksum). */
export function looksLikeIban(raw: string): boolean {
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(raw.replace(/\s/g, '').toUpperCase())
}

/** IBAN WITH mod-97 checksum (strict). */
export function isIban(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (!looksLikeIban(s)) return false
  const moved = s.slice(4) + s.slice(0, 4)
  let rem = 0
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch
    for (const c of v) rem = (rem * 10 + Number(c)) % 97
  }
  return rem === 1
}

const RE = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  iban: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g,
  // 6 digits, optional slash/dash/plus, 3-4 digits; or a 12-digit Swedish form
  idlike: /(?<![\d])(?:\d{2})?\d{6}[\/+-]?\d{3,4}(?![\d])/g,
  phoneIntl: /(?<![\w+])\+\d{1,3}(?:[\s-]?\d){7,12}(?![\d])/g,
  phoneCz: /(?<![\d])[67]\d{2}\s?\d{3}\s?\d{3}(?![\d])/g,
  phoneSe: /(?<![\d])07\d[-\s]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?![\d])/g,
  addrCz: /\b[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+(?:\s[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽa-záčďéěíňóřšťúůýž]+){0,3}\s\d{1,4}\/\d{1,4}[a-z]?\b/g,
  addrSe: /\b[A-ZÅÄÖ][a-zåäöé]+(?:gatan|vägen|gränd|torget|allén|stigen|backen|plan|leden|gatu)\s\d{1,4}\s?[A-Z]?\b/g,
  postCode: /(?<![\d])\d{3}\s\d{2}\s+[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽÅÄÖ][a-záčďéěíňóřšťúůýžåäö]+/g,
}

/** Finds personal data in text. Overlapping matches keep the first, most specific kind. */
export function detectPii(text: string): PiiHit[] {
  if (!text) return []
  const hits: PiiHit[] = []
  const taken: Array<[number, number]> = []
  const free = (i: number, len: number) => !taken.some(([a, b]) => i < b && i + len > a)
  const add = (kind: PiiKind, value: string, index: number) => {
    if (!free(index, value.length)) return
    taken.push([index, index + value.length])
    hits.push({ kind, value, index })
  }
  for (const m of text.matchAll(RE.email)) add('email', m[0], m.index!)
  // IBAN, birth numbers and personnummer are flagged by FORMAT, so a mistyped or
  // fictional-but-plausible number is still caught (safer for GDPR than requiring
  // a valid checksum, which would let a near-miss real number through).
  for (const m of text.matchAll(RE.iban)) if (looksLikeIban(m[0])) add('iban', m[0], m.index!)
  for (const m of text.matchAll(RE.idlike)) {
    const v = m[0]
    if (looksLikeRodneCislo(v)) add('rodne-cislo', v, m.index!)
    else {
      const se = looksLikeSwedish(v)
      if (se) add(se, v, m.index!)
    }
  }
  for (const re of [RE.phoneIntl, RE.phoneSe, RE.phoneCz]) for (const m of text.matchAll(re)) add('telefon', m[0], m.index!)
  for (const re of [RE.addrCz, RE.addrSe, RE.postCode]) for (const m of text.matchAll(re)) add('adresa', m[0], m.index!)
  return hits.sort((a, b) => a.index - b.index)
}

/** Replaces each hit with a stable placeholder like [RODNE-CISLO_1]; `map` keeps value→token for the session. */
export function pseudonymize(text: string, map: Record<string, string>): string {
  const hits = detectPii(text)
  let out = ''
  let at = 0
  const counters: Record<string, number> = {}
  for (const v of Object.values(map)) {
    const m = /^\[([A-Z-]+)_(\d+)\]$/.exec(v)
    if (m) counters[m[1]!] = Math.max(counters[m[1]!] ?? 0, Number(m[2]))
  }
  for (const h of hits) {
    const tag = h.kind.toUpperCase()
    if (!map[h.value]) {
      counters[tag] = (counters[tag] ?? 0) + 1
      map[h.value] = `[${tag}_${counters[tag]}]`
    }
    out += text.slice(at, h.index) + map[h.value]
    at = h.index + h.value.length
  }
  return out + text.slice(at)
}

/** Masks a value for display in a card: keeps the shape, hides most characters. */
export function mask(value: string): string {
  if (value.length <= 4) return '****'
  return value.slice(0, 2) + value.slice(2, -2).replace(/[A-Za-z0-9]/g, '•') + value.slice(-2)
}

/** Every string inside a tool's arguments, joined (for scanning). */
export function textOf(v: unknown, depth = 0): string {
  if (depth > 6 || v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(x => textOf(x, depth + 1)).join('\n')
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).map(x => textOf(x, depth + 1)).join('\n')
  return ''
}

/** Rewrites every string inside the arguments with pseudonyms. */
export function pseudonymizeArgs<T>(v: T, map: Record<string, string>, depth = 0): T {
  if (depth > 6) return v
  if (typeof v === 'string') return pseudonymize(v, map) as unknown as T
  if (Array.isArray(v)) return v.map(x => pseudonymizeArgs(x, map, depth + 1)) as unknown as T
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = pseudonymizeArgs(x, map, depth + 1)
    return out as T
  }
  return v
}
