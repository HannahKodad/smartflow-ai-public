import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { GuardStatus } from '../types'
import { classify } from './lib/classify'
import type { Call } from './lib/classify'
import { NO_CLIENT, parseProfile, CLIENT_NAME, isAllowedDomain } from './lib/profile'
import type { Profile, Level } from './lib/profile'
import { decide, isApproval, REFUSE_LABEL, APPROVE_MOVE_LABEL, APPROVE_SHARE_LABEL, APPROVE_SEND_LABEL, PSEUDONYMIZE_LABEL } from './lib/guard'
import type { Verdict, Card } from './lib/guard'
import { detectPii, PII_LABEL, mask, pseudonymizeArgs, textOf } from './lib/pii'
import { appendedBody, logPath, nowIso, parseCsv, LOG_COLUMNS } from './lib/log'
import type { LogRow, LogEvent } from './lib/log'

const statusAtom = atom({ plugin: 'data-guard', key: 'status' } as const, {
  client: '(none)',
  display: 'Žádný klient nezvolen',
  level: 'none',
  effectiveLevel: 'gdpr-strict',
  domains: [],
  tempUntil: null,
  tempReason: null,
  blocked: 0,
  confirmed: 0,
  loadError: null,
})

type TempLower = { floor: Level; until: number; reason: string }

// Module-scoped session state (reset each reload; persisted bits live in $.store).
const S = {
  home: '',
  clientsDir: '',
  refusedThisTurn: false,
  confirmsThisTurn: 0,
  profileCache: new Map<string, { mtime: number; profile: Profile | null; error: string | null }>(),
  pseudoMap: {} as Record<string, string>, // in memory only, never persisted
}

// ---- profile loading -------------------------------------------------------
async function readActiveClientKey($: any): Promise<string | null> {
  const v = await $.store.get('active-client')
  return typeof v === 'string' && v ? v : null
}

async function loadProfile($: any, client: string): Promise<{ profile: Profile | null; error: string | null }> {
  const path = `${S.clientsDir}/${client}.yaml`
  try {
    if (!(await $.fs.exists(path))) return { profile: null, error: `profil ${client}.yaml neexistuje` }
    const stat = await $.fs.stat(path).catch(() => ({ mtimeMs: 0 }))
    const cached = S.profileCache.get(client)
    if (cached && cached.mtime === stat.mtimeMs) return { profile: cached.profile, error: cached.error }
    const text = await $.fs.read(path)
    try {
      const profile = parseProfile(text, client)
      S.profileCache.set(client, { mtime: stat.mtimeMs, profile, error: null })
      return { profile, error: null }
    } catch (e: any) {
      const error = String(e?.message ?? e)
      S.profileCache.set(client, { mtime: stat.mtimeMs, profile: null, error })
      return { profile: null, error }
    }
  } catch (e: any) {
    return { profile: null, error: String(e?.message ?? e) }
  }
}

async function activeProfile($: any): Promise<{ profile: Profile; error: string | null; selected: boolean }> {
  const key = await readActiveClientKey($)
  if (!key) return { profile: NO_CLIENT, error: null, selected: false }
  const { profile, error } = await loadProfile($, key)
  return { profile: profile ?? { ...NO_CLIENT, client: key, display_name: key }, error, selected: true }
}

async function tempLower($: any): Promise<TempLower | null> {
  const v = (await $.store.get('temp-lower')) as TempLower | undefined
  if (!v || typeof v.until !== 'number') return null
  return v
}

async function effectiveLevel($: any, p: Profile): Promise<{ level: Level; temp: TempLower | null }> {
  const now = await $.clock.now()
  const t = await tempLower($)
  const active = t && t.until > now ? t : null
  if (!active || p.protection_level === 'gdpr-strict') return { level: p.protection_level, temp: active }
  return { level: active.floor, temp: active }
}

// ---- status band -----------------------------------------------------------
async function refreshStatus($: any, extra?: Partial<GuardStatus>): Promise<GuardStatus> {
  const { profile, error, selected } = await activeProfile($)
  const { level, temp } = await effectiveLevel($, profile)
  const cur = await read($, statusAtom)
  const next: GuardStatus = {
    client: selected ? profile.client : '(none)',
    display: selected ? profile.display_name : 'Žádný klient nezvolen',
    level: selected ? profile.protection_level : 'none',
    effectiveLevel: selected ? level : 'gdpr-strict',
    domains: profile.allowed_domains,
    tempUntil: temp ? temp.until : null,
    tempReason: temp ? temp.reason : null,
    blocked: cur.blocked,
    confirmed: cur.confirmed,
    loadError: error,
    ...extra,
  }
  await update($, statusAtom, () => next)
  return next
}

async function bump($: any, field: 'blocked' | 'confirmed') {
  const cur = await read($, statusAtom)
  await update($, statusAtom, () => ({ ...cur, [field]: cur[field] + 1 }))
}

// ---- logging ---------------------------------------------------------------
async function writeLog(
  $: any,
  p: Profile,
  level: Level,
  row: Partial<LogRow> & { event: LogEvent; action: string; outcome: LogRow['outcome'] },
) {
  const full: LogRow = {
    timestamp: nowIso(await $.clock.now()),
    client: p.client,
    level,
    event: row.event,
    action: row.action,
    tool: row.tool ?? '',
    file_id: row.file_id ?? '',
    file_name: row.file_name ?? '',
    original_path: row.original_path ?? '',
    target_folder: row.target_folder ?? '',
    reason: row.reason ?? '',
    recovery: row.recovery ?? '',
    outcome: row.outcome,
    actor: p.operator || 'claude',
  }
  try {
    const path = logPath(p, S.home)
    const exists = await $.fs.exists(path)
    const current = exists ? await $.fs.read(path) : null
    await $.fs.write(path, appendedBody(current, full, level))
  } catch (e: any) {
    $.ui.log(`data-guard: zápis do logu selhal: ${String(e?.message ?? e)}`, { to: 'debug' })
  }
}

// ---- the impact card -------------------------------------------------------
function cardText(c: Card, level: Level, piiNote?: string): string {
  const lines = [
    `⚠️  ${c.title}  (úroveň ${level})`,
    ``,
    `Co:         ${c.what}`,
    `Kolik:      ${c.count}`,
    `Kde:        ${c.where}`,
    `Přístup:    ${c.who}`,
    `Vrácení:    ${c.recovery}`,
    `Bezpečněji: ${c.safer}`,
  ]
  if (piiNote) lines.push(``, `Osobní údaje: ${piiNote}`)
  lines.push(``, `Potvrzuješ?`)
  return lines.join('\n')
}

// ---- self-protection -------------------------------------------------------
const SELF_BLOCK_TOOLS = /(set_session_permission_mode|set_session_connector_enabled|reconnect_session_connector)/
function touchesProtectedConfig(call: Call, pluginRoot: string): boolean {
  // Write/Edit tools: block by target path.
  const path = String(call.args.file_path ?? '')
  if (path) {
    if (path.startsWith(pluginRoot)) return true
    if (/\.claude\/settings(\.local)?\.json$/.test(path)) return true
    if (/\/data-guard\/(clients|logs)\//.test(path) && (call.tool === 'Write' || call.tool === 'Edit')) return true
  }
  // Bash: block commands that would EDIT the guard's files in place, MOVE/RENAME the
  // plugin (disabling it), or REDIRECT output into its folder. Reads (cat/ls/grep) and
  // backups that only READ from it (cp/tar/zip/rsync out to elsewhere) are allowed —
  // so a legitimate backup works, but tampering with the running guard does not.
  // Note: `2>/dev/null` and other redirects NOT targeting the guard are not mutations.
  if (call.family === 'bash') {
    const cmd = String(call.args.command ?? '')
    const touchesGuard = cmd.includes(pluginRoot) || /\.claude\/data-guard\b|\/dev-mods\/[^\s]*\/data-guard\b/.test(cmd)
    const editsInPlace = /\b(mv|rename|sed\s+-i|perl\s+-i(?!\w)|tee|truncate|chmod|chown)\b/.test(cmd)
    const redirectsIntoGuard = />\s*[^\s|&;]*(\/data-guard\b|\.claude\/dev-mods\/)/.test(cmd)
    if (touchesGuard && editsInPlace) return true
    if (redirectsIntoGuard) return true
  }
  return false
}

function templateYaml(client: string): string {
  const n = '000'
  return [
    '# data-guard client profile',
    `client: ${client}`,
    `display_name: "${client}"`,
    `client_number: "${n}"            # three digits; prefixes admin folders`,
    'protection_level: gdpr-strict   # standard | gdpr | gdpr-strict',
    'allowed_domains:',
    '  - example.com',
    'owners:',
    '  - owner@example.com',
    'operator: you@example.com',
    'allowed_tools:',
    '  - search_files',
    '  - read_file_content',
    '  - create_file',
    'protected_folders:',
    `  - name: "${n}_main"`,
    '    drive_id: ""',
    'admin_folders:',
    `  to-delete: ${n}_to-delete`,
    `  to-processing: ${n}_to-processing`,
    `  to-check: ${n}_to-check`,
    'log:',
    `  sheet_name: ${n}_admin-log`,
    '  drive_folder_id: ""',
    '  local_dir: ""',
    'batch_size: 5',
    'sensitive_terms: []',
    'purposes:',
    '  - "data migration"',
    '',
  ].join('\n')
}

// "Client data" = anything that must not leak: detected PII, or any of the
// client's own identifying strings (name, slug, domain, custom sensitive terms).
// Deliberately broad — over-blocking a web/send is safer than leaking.
function hasClientData(p: Profile, text: string): boolean {
  if (!text) return false
  if (detectPii(text).length > 0) return true
  const hay = text.toLowerCase()
  const needles = [p.display_name, p.client, ...p.sensitive_terms, ...p.allowed_domains]
    .map(s => (s ?? '').toLowerCase().trim())
    .filter(s => s.length >= 4)
  return needles.some(n => hay.includes(n))
}

function recipientsOf(args: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of ['to', 'cc', 'bcc', 'emailAddress']) {
    const v = args[key]
    if (typeof v === 'string') out.push(...v.split(/[,;\s]+/).filter(Boolean))
    else if (Array.isArray(v)) out.push(...v.map(String))
  }
  return out
}

export const register: Register = on => {
  // ---- the main gate -------------------------------------------------------
  on('tool.call', async ($, e, next) => {
    const call = classify(e as Record<string, unknown>)
    const { profile } = await activeProfile($)
    const { level } = await effectiveLevel($, profile)

    if (SELF_BLOCK_TOOLS.test(call.tool)) {
      await bump($, 'blocked')
      await writeLog($, profile, level, { event: 'blocked-attempt', action: 'self-config', tool: call.tool, outcome: 'blocked', reason: 'přepínání režimu/konektorů' })
      return { deny: 'data-guard: přepínání režimu oprávnění nebo konektorů smíš udělat jen ty ručně, Claude ne.' }
    }
    if (touchesProtectedConfig(call, $.plugin.root)) {
      await bump($, 'blocked')
      return { deny: 'data-guard: úpravy pluginu, nastavení, profilů klientů a logů dělá jen uživatelka ručně.' }
    }

    const piiText = textOf(call.args)
    const ctx = {
      profile,
      level,
      piiText,
      sharingOutsideDomain: (emails: string[]) => emails.filter(em => em.includes('@') && !isAllowedDomain(profile, em)),
      hasClientData: (text: string) => hasClientData(profile, text),
    }

    if (level === 'gdpr-strict' && call.actions.includes('read') && (call.family === 'drive' || call.family === 'gmail')) {
      await writeLog($, profile, level, {
        event: 'access',
        action: 'read',
        tool: call.tool,
        file_id: String(call.args.fileId ?? call.args.messageId ?? ''),
        reason: 'otevření souboru z chráněné oblasti',
        outcome: 'allowed',
      })
    }

    const verdict: Verdict = decide(call, ctx)

    if (verdict.kind === 'allow') return next(e)

    if (verdict.kind === 'deny') {
      await bump($, 'blocked')
      await writeLog($, profile, level, {
        event: 'blocked-attempt',
        action: call.actions.join('+'),
        tool: call.tool,
        file_id: String(call.args.fileId ?? call.args.file_path ?? ''),
        reason: verdict.reason,
        recovery: verdict.safer ?? '',
        outcome: 'blocked',
      })
      return { deny: `data-guard: ${verdict.reason}${verdict.safer ? ' — ' + verdict.safer : ''}` }
    }

    // confirm
    if (S.refusedThisTurn) {
      await bump($, 'blocked')
      return { deny: 'data-guard: hromadná akce zastavena po prvním odmítnutí. Zadej ji znovu po menších dávkách.' }
    }
    if (profile.batch_size > 0 && S.confirmsThisTurn >= profile.batch_size) {
      await bump($, 'blocked')
      return { deny: `data-guard: dávka ${profile.batch_size} citlivých akcí vyčerpána. Rozděl zbytek na menší dávky a potvrď znovu.` }
    }

    const pii = verdict.pii ?? detectPii(piiText)
    const piiNote = pii.length ? pii.map(h => `${PII_LABEL[h.kind]}: ${mask(h.value)}`).join('; ') : undefined
    // "Ne" is FIRST (primary/default) so an accidental Enter or stray click refuses.
    const approveLabel = verdict.action === 'send' ? APPROVE_SEND_LABEL : verdict.action === 'share' ? APPROVE_SHARE_LABEL : APPROVE_MOVE_LABEL
    const withPseudo = pii.length > 0 && verdict.action === 'send'

    // Anti-accidental MOVE: a move/overwrite can NOT be approved by any button or
    // by Enter — only by TYPING the destination exactly into the dialog's "Other"
    // field. Both visible buttons refuse, so a click or Enter always cancels.
    const isMove = verdict.action === 'move'
    const moveToken = (String(call.args.parentId ?? call.args.destination ?? call.args.file_path ?? '').trim() || 'POTVRZUJI PŘESUN')

    const approvals = isMove ? [moveToken] : withPseudo ? [PSEUDONYMIZE_LABEL, approveLabel] : [approveLabel]
    const options = isMove
      ? [REFUSE_LABEL, 'Ne, nechat být']
      : withPseudo
        ? [REFUSE_LABEL, PSEUDONYMIZE_LABEL, approveLabel]
        : [REFUSE_LABEL, approveLabel]
    const question = isMove
      ? cardText(verdict.card, level, piiNote) + `\n\n⚠ Přesun nelze potvrdit tlačítkem. Pro potvrzení NAPIŠ do pole „Jiné" přesně:\n${moveToken}\n(Kliknutí, Enter ani zavření dialogu přesun nepovolí.)`
      : cardText(verdict.card, level, piiNote)

    let answer: string
    try {
      answer = await $.ui.ask(question, { options, header: 'data-guard' })
    } catch {
      // Dialog dismissed / no answer → default-deny.
      S.refusedThisTurn = true
      await bump($, 'blocked')
      await writeLog($, profile, level, { event: 'blocked-attempt', action: verdict.action, tool: call.tool, reason: 'nepotvrzeno (dialog zavřen) — default-deny', outcome: 'blocked' })
      return { deny: 'data-guard: akce nepotvrzena (dialog zavřen), proto zablokována.' }
    }

    // DEFAULT-DENY: proceed ONLY on an exact explicit approval label. Anything
    // else — the refuse label, an empty answer, Enter on the primary (= Ne), a
    // stray click, any default — blocks. An accident can never approve.
    if (!isApproval(answer, approvals)) {
      S.refusedThisTurn = true
      await bump($, 'blocked')
      await writeLog($, profile, level, { event: 'blocked-attempt', action: verdict.action, tool: call.tool, reason: answer === REFUSE_LABEL ? 'odmítnuto uživatelkou' : 'nepotvrzeno (default-deny)', outcome: 'blocked' })
      return { deny: 'data-guard: akce nepotvrzena, proto zablokována (povolí jen výslovné „Ano").' }
    }

    S.confirmsThisTurn++
    await bump($, 'confirmed')
    let eventInput = e
    let outcome: LogRow['outcome'] = 'allowed'
    if (answer.trim() === PSEUDONYMIZE_LABEL) {
      const rewritten = pseudonymizeArgs(call.args, S.pseudoMap)
      eventInput = { ...e, ...rewritten } as typeof e
      outcome = 'pseudonymized'
    }

    await writeLog($, profile, level, {
      event: verdict.event,
      action: verdict.action,
      tool: call.tool,
      file_id: String(call.args.fileId ?? call.args.file_path ?? ''),
      target_folder: String(call.args.parentId ?? ''),
      file_name: String(call.args.title ?? call.args.name ?? ''),
      reason: 'potvrzeno uživatelkou',
      recovery: verdict.card.recovery,
      outcome,
    })

    return next(eventInput)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'data-guard: kontrola selhala, akce pro jistotu zablokována.' }))

  on('prompt.submit', ($, e, next) => {
    S.refusedThisTurn = false
    S.confirmsThisTurn = 0
    return next(e)
  })

  // ---- status band ---------------------------------------------------------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, statusAtom)
    const { Box, Text } = $.ui.resolve(e)
    const levelColor = s.effectiveLevel === 'gdpr-strict' ? 'red' : s.effectiveLevel === 'gdpr' ? 'yellow' : 'green'
    return (
      <Box>
        <Text dimColor>data-guard </Text>
        <Text bold>{s.client === '(none)' ? 'BEZ KLIENTA' : s.display}</Text>
        <Text dimColor> · </Text>
        <Text color={levelColor}>{s.effectiveLevel}</Text>
        <Text dimColor>
          {s.tempUntil ? ' · dočasně sníženo' : ''}
          {s.blocked ? ` · blok ${s.blocked}` : ''}
          {s.loadError ? ` · ⚠ profil: ${s.loadError}` : ''}
        </Text>
      </Box>
    )
  })

  // ---- commands ------------------------------------------------------------
  on('session.start', async ($, e, next) => {
    S.home = (await $.env.get('HOME')) ?? ''
    S.clientsDir = `${S.home}/.claude/data-guard/clients`
    for (const [name, description, argumentHint] of [
      ['dg-client', 'Přepnout aktivního klienta (bez argumentu vypíše seznam).', '<client>'],
      ['dg-status', 'Zobrazit stav ochrany aktivního klienta.', ''],
      ['dg-admin', 'Přehled všech administrativních složek klienta.', ''],
      ['dg-restore', 'Vrátit soubor ze složky to-delete (podle logu).', '<file_id>'],
      ['dg-log', 'Shrnout logovací tabulku jako doklad.', ''],
      ['dg-lower', 'Dočasně snížit ochranu (gdpr-strict nelze).', '<level> <minutes>'],
      ['dg-new-client', 'Založit nový profil klienta (průvodce).', '<client>'],
      ['dg-move-to-delete', 'Jak bezpečně přesunout soubor do to-delete.', '<file_id>'],
    ] as const) {
      await $.command.register({ name, description, argumentHint })
    }
    await refreshStatus($)
    return next(e)
  })

  on('command.run', async ($, e, next) => {
    const name = e.command
    if (!name.startsWith('dg-')) return next(e)
    const arg = e.args.trim()
    const { profile, error, selected } = await activeProfile($)
    const { level, temp } = await effectiveLevel($, profile)
    const text = (t: string) => ({ text: t })

    if (name === 'dg-status') {
      const s = await refreshStatus($)
      const lines = [
        `Aktivní klient: ${selected ? `${profile.display_name} (${profile.client})` : 'ŽÁDNÝ — platí nejpřísnější úroveň'}`,
        `Úroveň ochrany: ${selected ? profile.protection_level : 'gdpr-strict (výchozí)'}${level !== profile.protection_level ? ` → aktuálně ${level}` : ''}`,
        temp ? `Dočasné snížení do: ${nowIso(temp.until)} (důvod: ${temp.reason})` : 'Dočasné snížení: ne',
        `Povolené domény: ${profile.allowed_domains.join(', ') || '—'}`,
        `Whitelist nástrojů: ${profile.allowed_tools.length ? profile.allowed_tools.join(', ') : '—'}`,
        `Administrativní složky: ${Object.entries(profile.admin_folders).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}`,
        `Log: ${profile.log.sheet_name} (lokálně: ${logPath(profile, S.home)})`,
        `Blokováno v této relaci: ${s.blocked} · potvrzeno: ${s.confirmed}`,
        error ? `⚠ Chyba profilu: ${error}` : '',
        'Zákaz mazání je vždy aktivní a nelze vypnout.',
      ]
      return text(lines.filter(Boolean).join('\n'))
    }

    if (name === 'dg-client') {
      if (!arg) {
        let list: string[] = []
        try {
          if (await $.fs.exists(S.clientsDir)) {
            list = (await $.fs.list(S.clientsDir)).filter(f => f.name.endsWith('.yaml') && !f.name.startsWith('_')).map(f => f.name.replace(/\.yaml$/, ''))
          }
        } catch {}
        return text(`Klienti: ${list.join(', ') || '(žádní — /dg-new-client)'}\nAktivní: ${selected ? profile.client : '(žádný)'}\nPřepni: /dg-client <client>`)
      }
      if (!CLIENT_NAME.test(arg)) return text('Neplatný název klienta (malá písmena, číslice, pomlčky).')
      const loaded = await loadProfile($, arg)
      if (!loaded.profile) return text(`Profil ${arg} nelze načíst: ${loaded.error}`)
      await $.store.set('active-client', arg)
      await $.store.delete('temp-lower')
      await refreshStatus($)
      return text(`Aktivní klient: ${loaded.profile.display_name} (${arg}), úroveň ${loaded.profile.protection_level}.`)
    }

    if (name === 'dg-admin') {
      if (!selected) return text('Nejdřív zvol klienta: /dg-client <client>')
      const rows = Object.entries(profile.admin_folders).map(([k, v]) => `  ${k}: ${v}`)
      return text(`Administrativní složky klienta ${profile.client}:\n${rows.join('\n')}\n(Lhůty a týdenní e-maily řeší samostatný hlídač, který čte z logu.)`)
    }

    if (name === 'dg-lower') {
      if (!selected) return text('Nejdřív zvol klienta.')
      if (profile.protection_level === 'gdpr-strict') return text('Úroveň gdpr-strict nelze snížit.')
      const m = /^(standard|gdpr)\s+(\d+)$/.exec(arg)
      if (!m) return text('Použití: /dg-lower <standard|gdpr> <minuty>. Zákaz mazání zůstává vždy.')
      const floor = m[1] as Level
      const minutes = Math.min(Number(m[2]), 240)
      const ok = await $.ui
        .ask(`Dočasně snížit ochranu klienta ${profile.client} z ${profile.protection_level} na ${floor} na ${minutes} minut?\nZákaz mazání zůstává aktivní. Potvrzuješ?`, { options: ['Ano', 'Ne'], header: 'data-guard' })
        .catch(() => 'Ne')
      if (ok !== 'Ano') return text('Zrušeno.')
      const until = (await $.clock.now()) + minutes * 60000
      await $.store.set('temp-lower', { floor, until, reason: `ruční snížení na ${minutes} min` } satisfies TempLower)
      await writeLog($, profile, profile.protection_level, { event: 'temp-lower', action: 'lower', reason: `na ${floor} do ${nowIso(until)}`, outcome: 'allowed' })
      await refreshStatus($)
      return text(`Ochrana dočasně na ${floor} do ${nowIso(until)}. Zapsáno do logu.`)
    }

    if (name === 'dg-log') {
      if (!selected) return text('Nejdřív zvol klienta.')
      const path = logPath(profile, S.home)
      if (!(await $.fs.exists(path))) return text('Log je zatím prázdný.')
      const rows = parseCsv(await $.fs.read(path))
      const byEvent: Record<string, number> = {}
      const byAction: Record<string, number> = {}
      for (const r of rows) {
        byEvent[r.event] = (byEvent[r.event] ?? 0) + 1
        byAction[r.action] = (byAction[r.action] ?? 0) + 1
      }
      const last = rows.slice(-5).map(r => `  ${r.timestamp} ${r.event}/${r.action} ${r.outcome} ${r.file_id}`)
      return text(
        `Log klienta ${profile.client} — ${rows.length} záznamů.\n` +
          `Podle události: ${Object.entries(byEvent).map(([k, v]) => `${k}=${v}`).join(', ')}\n` +
          `Podle akce: ${Object.entries(byAction).map(([k, v]) => `${k}=${v}`).join(', ')}\n` +
          `Posledních 5:\n${last.join('\n')}\n` +
          `(Sloupce: ${LOG_COLUMNS.join(', ')} — formát neměň, čte z něj hlídač.)`,
      )
    }

    if (name === 'dg-restore') {
      if (!selected) return text('Nejdřív zvol klienta.')
      if (!arg) return text('Použití: /dg-restore <file_id>')
      const path = logPath(profile, S.home)
      if (!(await $.fs.exists(path))) return text('Log je prázdný, nelze dohledat původní cestu.')
      const rows = parseCsv(await $.fs.read(path))
      const match = [...rows].reverse().find(r => r.file_id === arg && (r.event === 'admin-move' || r.target_folder.includes('to-delete')))
      if (!match) return text(`V logu není přesun souboru ${arg} do to-delete. Nic nevracím.`)
      return text(
        `Soubor ${arg}:\n  původní cesta: ${match.original_path || '(nezaznamenána)'}\n  přesunuto: ${match.timestamp}\n` +
          'Vrácení udělej přesunem zpět do původní složky. Claude přesun navrhne a zapíše do logu; smazání z to-delete děláš jen ty ručně.',
      )
    }

    if (name === 'dg-move-to-delete') {
      if (!selected) return text('Nejdřív zvol klienta.')
      return text(
        `Přesun do to-delete (${profile.admin_folders['to-delete']}) je citlivá akce: proveď ji nástrojem přesunu (update_file s parentId). ` +
          'data-guard ukáže kartu s dopadem, vyžádá potvrzení a zapíše původní cestu do logu, aby šel soubor vrátit (/dg-restore). ' +
          'Pokud složka to-delete ještě neexistuje, nejdřív ji založ se stejně přísnými oprávněními jako zdroj a bez sdílení.',
      )
    }

    if (name === 'dg-new-client') {
      const client = arg || 'novy-klient'
      if (!CLIENT_NAME.test(client)) return text('Neplatný název (malá písmena, číslice, pomlčky).')
      const path = `${S.clientsDir}/${client}.yaml`
      if (await $.fs.exists(path)) return text(`Profil ${client} už existuje: ${path}`)
      await $.fs.write(path, templateYaml(client))
      return text(`Založen profil: ${path}\nVyplň pole a přepni: /dg-client ${client}`)
    }

    return text(`Neznámý příkaz ${name}.`)
  }).catch(($, e, next) => (next.called ? next(e) : { text: 'data-guard: příkaz selhal.' }))
}
