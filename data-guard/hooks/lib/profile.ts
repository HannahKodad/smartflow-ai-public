import { parseYaml } from './yaml'
import type { YamlValue } from './yaml'

export type Level = 'standard' | 'gdpr' | 'gdpr-strict'
export const LEVELS: readonly Level[] = ['standard', 'gdpr', 'gdpr-strict']
export const levelRank = (l: Level) => LEVELS.indexOf(l)

export type ProtectedFolder = { name: string; drive_id?: string; path?: string }

export type Profile = {
  client: string
  display_name: string
  client_number: string
  protection_level: Level
  allowed_domains: string[]
  owners: string[]
  operator: string
  allowed_tools: string[]
  network_allowlist: string[]
  protected_folders: ProtectedFolder[]
  admin_folders: Record<string, string>
  local_root: string
  log: { sheet_name: string; drive_folder_id: string; inbox_folder_id: string; local_dir: string }
  batch_size: number
  sensitive_terms: string[]
  purposes: string[]
  connectors: Record<string, string>
}

/** The profile in force when no client is selected or a profile is unreadable: gdpr-strict, nothing whitelisted. */
export const NO_CLIENT: Profile = {
  client: '(none)',
  display_name: 'Žádný klient nezvolen',
  client_number: '000',
  protection_level: 'gdpr-strict',
  allowed_domains: [],
  owners: [],
  operator: '',
  allowed_tools: [],
  network_allowlist: [],
  protected_folders: [],
  admin_folders: {},
  local_root: '',
  log: { sheet_name: '', drive_folder_id: '', inbox_folder_id: '', local_dir: '' },
  batch_size: 1,
  sensitive_terms: [],
  purposes: [],
  connectors: {},
}

const str = (v: YamlValue | undefined, d = ''): string => (v === null || v === undefined ? d : String(v))
const strs = (v: YamlValue | undefined): string[] => (Array.isArray(v) ? v.filter(x => x !== null).map(x => String(x)) : [])
const obj = (v: YamlValue | undefined): Record<string, YamlValue> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, YamlValue>) : {}

export const CLIENT_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/

/** Parses and checks a profile. Throws with a Czech message on anything wrong. */
export function parseProfile(text: string, fileName: string): Profile {
  const raw = obj(parseYaml(text))
  const client = str(raw.client)
  if (!CLIENT_NAME.test(client)) throw new Error(`pole "client" musí být malými písmeny, číslice a pomlčky (${fileName})`)
  if (fileName && fileName !== client) throw new Error(`soubor ${fileName}.yaml má v poli "client" jiný název: ${client}`)
  const level = str(raw.protection_level) as Level
  if (!LEVELS.includes(level)) throw new Error(`protection_level musí být standard, gdpr nebo gdpr-strict (je "${level}")`)
  const number = str(raw.client_number)
  if (!/^\d{3}$/.test(number)) throw new Error(`client_number musí mít tři číslice, např. 003 (je "${number}")`)
  const domains = strs(raw.allowed_domains).map(d => d.toLowerCase().replace(/^@/, ''))
  if (domains.length === 0) throw new Error('allowed_domains nesmí být prázdné')
  const admin: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj(raw.admin_folders))) admin[k] = str(v)
  if (!admin['to-delete']) admin['to-delete'] = `${number}_to-delete`
  for (const [k, v] of Object.entries(admin)) {
    if (!v.startsWith(`${number}_`)) throw new Error(`administrativní složka ${k} musí začínat číslem klienta: ${number}_…`)
  }
  const log = obj(raw.log)
  const protectedFolders: ProtectedFolder[] = (Array.isArray(raw.protected_folders) ? raw.protected_folders : []).map(f => {
    const o = obj(f)
    return { name: str(o.name, str(o.drive_id, str(o.path))), drive_id: str(o.drive_id) || undefined, path: str(o.path) || undefined }
  })
  const connectors: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj(raw.connectors))) connectors[k] = str(v)
  const batch = Number(raw.batch_size ?? 5)
  return {
    client,
    display_name: str(raw.display_name, client),
    client_number: number,
    protection_level: level,
    allowed_domains: domains,
    owners: strs(raw.owners).map(s => s.toLowerCase()),
    operator: str(raw.operator),
    allowed_tools: strs(raw.allowed_tools),
    network_allowlist: strs(raw.network_allowlist).map(s => s.toLowerCase()),
    protected_folders: protectedFolders,
    admin_folders: admin,
    local_root: str(raw.local_root),
    log: {
      sheet_name: str(log.sheet_name, `${number}_admin-log`),
      drive_folder_id: str(log.drive_folder_id),
      inbox_folder_id: str(log.inbox_folder_id),
      local_dir: str(log.local_dir),
    },
    batch_size: Number.isFinite(batch) && batch >= 1 ? Math.min(Math.floor(batch), 25) : 5,
    sensitive_terms: strs(raw.sensitive_terms),
    purposes: strs(raw.purposes),
    connectors,
  }
}

/** Glob match where `*` is any run of characters. */
export function globMatch(pattern: string, s: string): boolean {
  const re = new RegExp('^' + pattern.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
  return re.test(s)
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@')
  return at < 0 ? '' : email.slice(at + 1).toLowerCase().trim()
}

export function isAllowedDomain(p: Profile, email: string): boolean {
  const d = domainOf(email)
  return d !== '' && p.allowed_domains.some(a => d === a || d.endsWith('.' + a))
}
