// The audit log. Canonical store is a local append-only CSV per client, with a
// FIXED column order a separate watcher reads. (The Drive connector in this
// session cannot append a row to a Google Sheet; see README.) A command can
// upload a fresh snapshot of the CSV to the client's Drive log folder.

import type { Profile, Level } from './profile'

// The column contract. DO NOT REORDER — the external watcher depends on it.
export const LOG_COLUMNS = [
  'timestamp', // ISO 8601, with timezone
  'client', // client key
  'level', // protection level in force
  'event', // confirmed-sensitive | blocked-attempt | admin-move | access | share | temp-lower | restore
  'action', // the concrete action, e.g. delete, share, move, send, network, web, read
  'tool', // the tool name
  'file_id', // Drive file id or local path identifier
  'file_name', // EMPTY on gdpr / gdpr-strict (ID only); filled on standard
  'original_path', // where it came from (for restore)
  'target_folder', // where it went
  'reason', // the stated purpose / why
  'recovery', // how to undo (e.g. "restore <id>")
  'outcome', // allowed | blocked | pseudonymized
  'actor', // the operator email from the profile, or "claude"
] as const

export type LogEvent =
  | 'confirmed-sensitive'
  | 'blocked-attempt'
  | 'admin-move'
  | 'access'
  | 'share'
  | 'temp-lower'
  | 'restore'

export type LogRow = {
  timestamp: string
  client: string
  level: Level
  event: LogEvent
  action: string
  tool: string
  file_id: string
  file_name: string
  original_path: string
  target_folder: string
  reason: string
  recovery: string
  outcome: 'allowed' | 'blocked' | 'pseudonymized'
  actor: string
}

const q = (s: string): string => {
  const v = s ?? ''
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}

export const headerLine = (): string => LOG_COLUMNS.join(',')
export const toCsvLine = (row: LogRow): string => LOG_COLUMNS.map(c => q(String(row[c] ?? ''))).join(',')

/** On gdpr / gdpr-strict the file_name column stays empty: only the ID is logged. */
export function redactForLevel(row: LogRow, level: Level): LogRow {
  if (level === 'standard') return row
  return { ...row, file_name: '' }
}

export function logPath(p: Profile, home: string): string {
  const dir = p.log.local_dir || `${home}/.claude/data-guard/logs`
  return `${dir}/${p.client}_admin-log.csv`
}

/** Returns the new file body after appending one row. `current` is the existing
 *  file text, or null when the file does not exist yet (then the header is added). */
export function appendedBody(current: string | null, row: LogRow, level: Level): string {
  const line = toCsvLine(redactForLevel(row, level))
  if (current === null) return headerLine() + '\n' + line + '\n'
  return current.endsWith('\n') || current === '' ? current + line + '\n' : current + '\n' + line + '\n'
}

export type ParsedRow = Record<(typeof LOG_COLUMNS)[number], string>

export function parseCsv(text: string): ParsedRow[] {
  const rows: string[][] = []
  let field = ''
  let record: string[] = []
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQ = false
      else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { record.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      record.push(field); field = ''
      if (record.length > 1 || record[0] !== '') rows.push(record)
      record = []
    } else field += c
  }
  if (field !== '' || record.length) { record.push(field); rows.push(record) }
  if (rows.length === 0) return []
  const header = rows[0]!
  return rows.slice(1).map(r => {
    const o = {} as ParsedRow
    header.forEach((h, i) => { (o as Record<string, string>)[h] = r[i] ?? '' })
    return o
  })
}

export function nowIso(ms: number): string {
  // ISO 8601 with local offset so the watcher can order events across zones.
  const d = new Date(ms)
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  )
}
