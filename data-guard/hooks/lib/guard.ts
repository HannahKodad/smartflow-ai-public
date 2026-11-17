// The decision core: pure, so it can be unit-tested. Given the active profile,
// the effective protection level and a classified call, it returns a verdict.
// Side effects (asking the user, logging, calling connectors) stay in register.
//
// PRIMARY GOAL: client data must never leave to the web/internet. Every exit
// path (web, terminal network, publishing, out-of-domain share/email, non-
// whitelisted connectors, memory) is a HARD block on gdpr / gdpr-strict —
// a confirmation card can NOT unlock it; only a change to the client profile can.

import { isMemoryWrite, isInfraTool } from './classify'
import type { Call } from './classify'
import { globMatch, isAllowedDomain } from './profile'
import type { Profile, Level } from './profile'
import { detectPii } from './pii'
import type { PiiHit } from './pii'

export type Card = {
  title: string
  what: string
  count: string
  where: string
  who: string
  recovery: string
  safer: string
}

export type Verdict =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string; safer?: string }
  | { kind: 'confirm'; card: Card; event: 'confirmed-sensitive' | 'share' | 'admin-move'; action: string; pii?: PiiHit[] }

const rank: Record<Level, number> = { standard: 0, gdpr: 1, 'gdpr-strict': 2 }

// ---- confirmation labels (used by register's card) -------------------------
// "Ne" is the FIRST / primary option so an accidental Enter or stray click
// refuses rather than approves.
export const REFUSE_LABEL = 'Ne, zrušit'
export const APPROVE_MOVE_LABEL = 'Ano, potvrdit přesun'
export const APPROVE_SHARE_LABEL = 'Ano, sdílet v doméně'
export const APPROVE_SEND_LABEL = 'Ano, odeslat'
export const PSEUDONYMIZE_LABEL = 'Pseudonymizovat a odeslat'

/**
 * Default-deny: a sensitive action is approved ONLY when the answer exactly
 * matches one of the explicitly offered approval labels (trimmed). An empty
 * answer, a dismissal, the refuse label, or any default/fallback all deny — so
 * an accidental Enter or stray click can never approve a move, share or send.
 */
export function isApproval(answer: string | undefined | null, approvals: readonly string[]): boolean {
  if (answer == null) return false
  const a = answer.trim()
  return a.length > 0 && approvals.includes(a)
}

/** Is this tool allowed by the client's whitelist? */
export function whitelisted(p: Profile, call: Call): boolean {
  if (p.allowed_tools.length === 0) return false
  return p.allowed_tools.some(pat => globMatch(pat, call.tool) || globMatch(pat, call.suffix) || pat === call.family)
}

function recipientsOf(args: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const key of ['to', 'cc', 'bcc', 'emailAddress', 'toRecipients', 'ccRecipients', 'bccRecipients', 'recipients']) {
    const v = args[key]
    if (typeof v === 'string') out.push(...v.split(/[,;\s]+/).filter(Boolean))
    else if (Array.isArray(v)) out.push(...v.map(String))
  }
  return out
}

/** A share that exposes the file beyond named people in the client's domain. */
export function isPublicShare(args: Record<string, unknown>): boolean {
  const pid = String(args.permissionId ?? '').toLowerCase()
  if (pid === 'anyonewithlink' || pid === 'anyone') return true
  const vis = String(args.visibility ?? '').toLowerCase()
  if (vis.startsWith('anyone') || vis.startsWith('domain') || vis === 'external') return true
  // a permissionId that is not an email target, with no recipient, is an audience/link grant
  if ('permissionId' in args && !('emailAddress' in args) && !('chatSpaceId' in args)) return true
  return false
}

const deny = (reason: string, safer?: string): Verdict => ({ kind: 'deny', reason, safer })

/** The deletion verdict shared by all levels: Claude never deletes. */
function deletionVerdict(call: Call): Verdict {
  if (call.family === 'bash') return deny('Mazání v terminálu je zakázané. Claude nikdy nic nemaže.', 'Soubor nech být, nebo ho přesuň do složky to-delete (smazání provedeš ty ručně).')
  if (call.family === 'file') return deny('Přepsání souboru prázdným obsahem je zakázané (skryté mazání).', 'Zapiš nový obsah, nebo soubor přesuň do to-delete.')
  return deny('Mazání přes konektor je zakázané. Claude nemaže ani do koše, ani natrvalo.', 'Použij /dg-move-to-delete pro přesun do to-delete. Trvalé smazání děláš jen ty ručně.')
}

export type DecideCtx = {
  profile: Profile
  level: Level // effective level (after any temporary lowering)
  piiText: string // all text inside the args, for PII scan
  sharingOutsideDomain: (emails: string[]) => string[] // offending addresses
  hasClientData: (text: string) => boolean // PII, client name, sensitive terms, domain, file names
}

export function decide(call: Call, ctx: DecideCtx): Verdict {
  const { profile: p, level } = ctx
  const isGdpr = rank[level] >= 1
  const isStrict = rank[level] >= 2
  const wl = whitelisted(p, call)
  const hasData = ctx.hasClientData(ctx.piiText)
  const domains = p.allowed_domains.join(', ') || '(doména neurčena)'

  // App/harness tools (session UI, terminal panel, charts…) never carry client
  // data outward: not gated, except the always-on deletion rule.
  if (isInfraTool(call.tool)) return call.actions.includes('delete') ? deletionVerdict(call) : { kind: 'allow' }

  // (0) Deletion — hard block, every level, every route.
  if (call.actions.includes('delete')) return deletionVerdict(call)

  // ========================================================================
  // HARD EXFILTRATION BLOCKS — client data must not leave. gdpr / gdpr-strict.
  // Not unlockable by a card or a client number; only a profile change unlocks.
  // ========================================================================

  // (1) Web tools (WebSearch, WebFetch, browser): no client data to the internet.
  if (call.actions.includes('web')) {
    if (isStrict && !wl) return deny(`gdpr-strict: žádný web, prohlížeč ani síť mimo whitelist klienta ${p.client}. (${call.tool})`, 'Pracuj jen s lokálními daty a schválenými konektory.')
    if (isGdpr && hasData) return deny('Web by odeslal data klienta (obsah, jméno, číslo nebo název souboru). Zakázáno.', 'Hledej obecné informace bez dat klienta, nebo je nejdřív pseudonymizuj.')
    if (isGdpr && call.family === 'browser' && !wl) return deny('Prohlížeč není ve whitelistu klienta — možný únik dat. Zakázáno.', 'Použij jen schválené nástroje z profilu.')
    // standard, or gdpr clean search without client data → allowed
  }

  // (2) Network from the terminal (curl/wget/ssh/scp/rsync/ftp/gh, python/node senders).
  if (call.actions.includes('network')) {
    if (isGdpr) return deny('Síťový příkaz z terminálu — data klienta nesmí odejít ven. Zakázáno (odemkne jen změna profilu).', 'Spusť příkaz bez sítě, nebo to udělej ty mimo Claude.')
    // standard → allowed
  }

  // (3)/(4) Publishing: artifacts, public pages, shared links, git push / gh.
  if (call.actions.includes('publish')) {
    if (isGdpr) return deny('Zveřejnění (stránka, artefakt, veřejný odkaz, push do repozitáře) je u dat klienta zakázané.', 'Sdílej jen interně v doméně klienta, nic s veřejnou adresou.')
    // standard → allowed
  }

  // (5) Drive sharing — public-link and out-of-domain are HARD at EVERY level.
  if (call.actions.includes('share')) {
    const emails = recipientsOf(call.args)
    const outside = ctx.sharingOutsideDomain(emails)
    if (isPublicShare(call.args)) return deny('Sdílení „kdokoli s odkazem" je zakázané — žádné potvrzení to neodemkne.', `Sdílej jen s konkrétními lidmi v doméně ${domains}.`)
    if (outside.length > 0) return deny(`Sdílení mimo doménu klienta (${outside.join(', ')}) je zakázané.`, `Sdílej jen v doméně ${domains}.`)
    if (isGdpr && !wl) return deny(`Nástroj ${call.suffix || call.tool} (sdílení) není ve whitelistu klienta ${p.client}.`, 'Přidej ho do allowed_tools, pokud tam patří.')
    // within-domain share with named people → internal, confirm with a card
    return {
      kind: 'confirm',
      event: 'share',
      action: 'share',
      card: {
        title: 'Sdílení v doméně klienta',
        what: `${call.suffix}${emails.length ? ' → ' + emails.join(', ') : ''}`,
        count: '1 soubor',
        where: String(call.args.fileId ?? call.args.file_path ?? ''),
        who: emails.join(', ') || '(beze změny příjemců)',
        recovery: 'Sdílení lze odebrat zpět v Drive.',
        safer: `Ověř, že všichni příjemci jsou v doméně ${domains} a že nejde o chráněnou složku.`,
      },
    }
  }

  // (6) E-mail — out-of-domain or client-data send is HARD blocked; only a draft is allowed.
  if (call.actions.includes('send')) {
    const recipients = recipientsOf(call.args)
    const outside = ctx.sharingOutsideDomain(recipients)
    if (outside.length > 0) return deny(`E-mail mimo doménu klienta (${outside.join(', ')}) je zakázaný. Smíš jen připravit koncept (draft).`, `Posílej jen na adresy v doméně ${domains}, nebo nech koncept pro uživatelku.`)
    if (isGdpr && hasData) return deny('Odeslání dat klienta e-mailem je zakázané. Připrav koncept (draft) a odešli ho sama.', 'Vytvoř draft (create_draft) místo odeslání.')
    if (isGdpr && !wl) return deny(`Nástroj ${call.suffix || call.tool} (odeslání) není ve whitelistu klienta ${p.client}.`, 'Přidej ho do allowed_tools, nebo připrav jen koncept.')
    // within-domain, no client data → confirm
    return {
      kind: 'confirm',
      event: 'confirmed-sensitive',
      action: 'send',
      card: {
        title: 'Odeslání zprávy v doméně',
        what: `${call.suffix} přes ${call.family}`,
        count: `${recipients.length || '?'} příjemců`,
        where: recipients.join(', ') || '(neznámí příjemci)',
        who: recipients.join(', ') || '(neznámí příjemci)',
        recovery: 'Odeslanou zprávu nelze vzít zpět.',
        safer: 'Zkontroluj příjemce; při pochybnostech nech jen koncept.',
      },
    }
  }

  // (7) Other connectors / tools (Slack, uploads, anything): whitelist only on gdpr/strict.
  if (isGdpr && !wl && ['drive', 'gmail', 'calendar', 'docs', 'other', 'browser'].includes(call.family)) {
    return deny(`Nástroj ${call.suffix || call.tool} není ve whitelistu klienta ${p.client}. Na úrovni ${level} smí jen schválené nástroje.`, 'Přidej ho do allowed_tools v profilu, pokud tam patří.')
  }

  // (8) Memory / notes — never store client data outside the client's Drive.
  if (isMemoryWrite(call) && hasData) {
    return deny('Data klienta se neukládají do paměti ani poznámek mimo Drive klienta.', 'Ulož jen neosobní popis bez konkrétních údajů.')
  }

  // ========================================================================
  // INTERNAL sensitive action (stays inside the client's space): confirm.
  // The card is default-deny (see register): only an explicit "Ano" proceeds.
  // ========================================================================
  if (call.actions.includes('move')) {
    return {
      kind: 'confirm',
      event: 'confirmed-sensitive',
      action: 'move',
      card: {
        title: 'Přesun / přepsání',
        what: `${call.tool} ${call.suffix}`,
        count: '1 položka',
        where: String(call.args.parentId ?? call.args.file_path ?? call.args.destination ?? ''),
        who: 'stejná oprávnění jako zdroj',
        recovery: 'Přesun zapíšu do logu s původní cestou (lze vrátit přes /dg-restore).',
        safer: 'Ověř cílovou složku; chráněné složky nech být.',
      },
    }
  }

  return { kind: 'allow' }
}
