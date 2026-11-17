// A small YAML reader for data-guard client profiles.
// Supports: comments, `key: value`, nested maps by indentation,
// lists of scalars (`- x`), lists of maps (`- key: v` + continued keys),
// inline lists `[a, b]`, quoted strings, booleans, numbers, null.
// Anything else is a parse error: a profile that cannot be read
// never weakens protection (the caller falls back to gdpr-strict).

export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue }

type Line = { indent: number; text: string; no: number }

export class YamlError extends Error {}

function stripComment(raw: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]!))) {
      break
    }
    out += c
  }
  return out.replace(/\s+$/, '')
}

function scalar(s: string): YamlValue {
  const t = s.trim()
  if (t === '' || t === '~' || t === 'null') return null
  if (t === 'true') return true
  if (t === 'false') return false
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim()
    return inner === '' ? [] : inner.split(',').map(x => scalar(x))
  }
  if (/^-?\d+(\.\d+)?$/.test(t) && !/^0\d/.test(t)) return Number(t)
  return t
}

function splitKey(text: string, no: number): [string, string] {
  const m = /^("[^"]*"|'[^']*'|[^:]+?):(\s+(.*))?$/.exec(text)
  if (!m) throw new YamlError(`line ${no}: expected "key: value", got "${text}"`)
  let key = m[1]!.trim()
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1)
  return [key, m[3] ?? '']
}

export function parseYaml(src: string): YamlValue {
  const lines: Line[] = []
  src.split(/\r?\n/).forEach((raw, i) => {
    if (/\t/.test(raw.match(/^\s*/)?.[0] ?? '')) throw new YamlError(`line ${i + 1}: tabs are not allowed for indentation`)
    const text = stripComment(raw)
    if (text.trim() === '' || text.trim() === '---') return
    lines.push({ indent: text.length - text.trimStart().length, text: text.trim(), no: i + 1 })
  })
  let pos = 0

  const at = (i: number): Line | undefined => lines[i]
  const cur = (): Line => lines[pos]!

  function block(indent: number): YamlValue {
    if (pos >= lines.length) return null
    const t = cur().text
    return t.startsWith('- ') || t === '-' ? list(indent) : map(indent)
  }

  function map(indent: number): { [k: string]: YamlValue } {
    const out: { [k: string]: YamlValue } = {}
    while (pos < lines.length && cur().indent === indent && !cur().text.startsWith('- ')) {
      const { text, no } = cur()
      const [key, rest] = splitKey(text, no)
      pos++
      const nxt = at(pos)
      if (rest !== '') {
        out[key] = scalar(rest)
      } else if (nxt && nxt.indent > indent) {
        out[key] = block(nxt.indent)
      } else if (nxt && nxt.indent === indent && nxt.text.startsWith('- ')) {
        out[key] = list(indent)
      } else {
        out[key] = null
      }
    }
    const over = at(pos)
    if (over && over.indent > indent) throw new YamlError(`line ${over.no}: unexpected indentation`)
    return out
  }

  function list(indent: number): YamlValue[] {
    const out: YamlValue[] = []
    while (pos < lines.length && cur().indent === indent && (cur().text.startsWith('- ') || cur().text === '-')) {
      const { text, no } = cur()
      const item = text === '-' ? '' : text.slice(2).trim()
      if (item === '') {
        pos++
        const nxt = at(pos)
        out.push(nxt && nxt.indent > indent ? block(nxt.indent) : null)
      } else if (/^("[^"]*"|'[^']*'|[^:"'\[]+?):(\s|$)/.test(item)) {
        // A map inside the list: re-read this line as a key at the item's column.
        const col = indent + 2
        lines[pos] = { indent: col, text: item, no }
        out.push(map(col))
      } else {
        pos++
        out.push(scalar(item))
      }
    }
    return out
  }

  const first = at(0)
  const value = block(first ? first.indent : 0)
  const rem = at(pos)
  if (rem) throw new YamlError(`line ${rem.no}: could not parse "${rem.text}"`)
  return value
}
