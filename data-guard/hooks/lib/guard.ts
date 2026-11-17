// The decision core: pure, so it can be unit-tested. Given the active profile,
// the effective protection level and a classified call, it returns a verdict.
// Side effects (asking the user, logging, calling connectors) stay in register.

import { isMemoryWrite, isInfraTool } from './classify'
import type { Call } from './classify'
import { globMatch, isAllowedDomain } from './profile'
import type { Profile, Level } from './profile'
import { detectPii } from './pii'
import type { PiiHit } from './pii'

export type Card = {
  title: string
  what: string // what the action is
  count: string // how many items
  where: string // where (path/folder)
  who: string // who has / would have access
  recovery: string // how to undo
  safer: string // a safer alternative
}

export type Verdict =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string; safer?: string }
  | { kind: 'confirm'; card: Card; event: 'confirmed-sensitive' | 'share' | 'admin-move'; action: string; pii?: PiiHit[] }

const rank: Record<Level, number> = { standard: 0, gdpr: 1, 'gdpr-strict': 2 }

/** Is this tool allowed by the client's whitelist? On gdpr levels an empty whitelist blocks everything but reads of the guard's own connectors. */
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

/** The deletion verdict shared by all levels: Claude never deletes. */
function deletionVerdict(call: Call): Verdict {
  if (call.family === 'bash') {
    return {
      kind: 'deny',
      reason: 'Mazání v terminálu je zakázané. Claude nikdy nic nemaže.',
      safer: 'Soubor nech být, nebo ho přesuň do složky to-delete daného klienta (smazání provedeš ty ručně).',
    }
  }
  if (call.family === 'file') {
    return {
      kind: 'deny',
      reason: 'Přepsání souboru prázdným obsahem je zakázané (je to skryté mazání).',
      safer: 'Zapiš nový obsah, nebo soubor přesuň do složky to-delete.',
    }
  }
  // connector trash/delete
  return {
    kind: 'deny',
    reason: 'Mazání přes konektor je zakázané. Claude nemaže ani do koše, ani natrvalo.',
    safer: 'Použij příkaz /dg-move-to-delete pro přesun do složky to-delete. Trvalé smazání děláš jen ty ručně.',
  }
}

export type DecideCtx = {
  profile: Profile
  level: Level // effective level (after any temporary lowering)
  piiText: string // all text inside the args, for PII scan
  sharingOutsideDomain: (emails: string[]) => string[] // returns the offending addresses
}

export function decide(call: Call, ctx: DecideCtx): Verdict {
  const { profile: p, level } = ctx
  const isGdpr = rank[level] >= 1
  const isStrict = rank[level] >= 2

  // App/harness tools are not client data: never gate them (only the always-on
  // deletion rule still applies, in case one could remove a file).
  if (isInfraTool(call.tool)) {
    return call.actions.includes('delete') ? deletionVerdict(call) : { kind: 'allow' }
  }

  // 1. Deletion — blocked at every level, by every route. Never overridable.
  if (call.actions.includes('delete')) return deletionVerdict(call)

  // 2. Whitelist (gdpr / gdpr-strict): anything off the client whitelist is blocked.
  //    Reads of the client's own connectors are allowed so the guard can work.
  if (isGdpr && !whitelisted(p, call) && call.family !== 'file') {
    // Web/network handled below with clearer messages; here catch connectors & others.
    if (call.family === 'drive' || call.family === 'gmail' || call.family === 'calendar' || call.family === 'docs' || call.family === 'other') {
      return {
        kind: 'deny',
        reason: `Nástroj ${call.suffix} není ve whitelistu klienta ${p.client}. Na úrovni ${level} smí jen schválené konektory.`,
        safer: `Přidej nástroj do allowed_tools v profilu klienta, pokud tam patří.`,
      }
    }
  }

  // 3. Web & network.
  if (call.actions.includes('web') || call.actions.includes('network')) {
    if (isStrict && !whitelisted(p, call)) {
      return {
        kind: 'deny',
        reason: `Na úrovni gdpr-strict není přístup k webu ani síti, kromě nástrojů ve whitelistu. (${call.tool})`,
        safer: 'Pracuj jen s lokálními daty a schválenými konektory.',
      }
    }
    if (isGdpr) {
      const pii = detectPii(ctx.piiText)
      if (pii.length > 0) {
        return {
          kind: 'deny',
          reason: `Dotaz na web/síť obsahuje osobní údaje (${pii.map(h => h.kind).join(', ')}). Na úrovni ${level} nesmí data klienta odejít na internet.`,
          safer: 'Vyhledávej jen obecné informace bez údajů klienta, nebo je nejdřív pseudonymizuj.',
        }
      }
      if (call.actions.includes('network')) {
        // A network/exfil-capable shell command on a GDPR level: confirm.
        return {
          kind: 'confirm',
          event: 'confirmed-sensitive',
          action: 'network',
          card: {
            title: 'Síťový příkaz na úrovni ' + level,
            what: 'Příkaz v terminálu, který může odeslat data: ' + String(call.args.command ?? '').slice(0, 120),
            count: '1 příkaz',
            where: 'terminál',
            who: 'cílový server příkazu',
            recovery: 'Nic se neposílá, dokud nepotvrdíš.',
            safer: 'Pokud nepotřebuješ síť, spusť příkaz bez ní.',
          },
        }
      }
    }
    // standard level: web allowed.
  }

  // 4. Sending / forwarding messages with PII.
  if (call.actions.includes('send')) {
    const recipients = recipientsOf(call.args)
    const outside = ctx.sharingOutsideDomain(recipients)
    if (outside.length > 0 && isGdpr) {
      return {
        kind: 'deny',
        reason: `Příjemci mimo povolenou doménu: ${outside.join(', ')}. Sdílení osobních údajů mimo doménu je zakázané.`,
        safer: `Posílej jen na adresy v doméně: ${p.allowed_domains.join(', ')}.`,
      }
    }
    const pii = detectPii(ctx.piiText)
    return {
      kind: 'confirm',
      event: 'confirmed-sensitive',
      action: 'send',
      pii: pii.length ? pii : undefined,
      card: {
        title: 'Odeslání zprávy',
        what: `${call.suffix} přes ${call.family}`,
        count: `${recipients.length || '?'} příjemců`,
        where: recipients.join(', ') || '(neznámí příjemci)',
        who: recipients.join(', ') || '(neznámí příjemci)',
        recovery: 'Odeslanou zprávu nelze vzít zpět.',
        safer: pii.length ? 'Před odesláním pseudonymizuj osobní údaje (nabídnu to).' : 'Zkontroluj příjemce a obsah.',
      },
    }
  }

  // 5. Sharing / permission changes.
  if (call.actions.includes('share')) {
    const emails = recipientsOf(call.args)
    const outside = ctx.sharingOutsideDomain(emails)
    const publicShare = String(call.args.permissionId ?? '') === 'anyoneWithLink' || 'permissionId' in call.args
    if (outside.length > 0 || (publicShare && emails.length === 0 && !('role' in call.args && false))) {
      if (outside.length > 0) {
        return {
          kind: 'deny',
          reason: `Sdílení mimo povolenou doménu: ${outside.join(', ')}. To je zakázané.`,
          safer: `Sdílej jen v doméně ${p.allowed_domains.join(', ')}.`,
        }
      }
    }
    return {
      kind: 'confirm',
      event: 'share',
      action: 'share',
      card: {
        title: 'Změna sdílení / oprávnění',
        what: `${call.suffix}${emails.length ? ' → ' + emails.join(', ') : ''}`,
        count: '1 soubor',
        where: String(call.args.fileId ?? call.args.file_path ?? ''),
        who: emails.join(', ') || (publicShare ? 'kdokoli s odkazem' : '(beze změny příjemců)'),
        recovery: 'Sdílení lze odebrat zpět v Drive.',
        safer: `Ověř, že jde o doménu ${p.allowed_domains.join(', ')} a že to není chráněná složka.`,
      },
    }
  }

  // 6. Move between folders / overwrite existing file.
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
        recovery: 'Přesun zapíšu do logu s původní cestou (lze vrátit).',
        safer: 'Ověř cílovou složku; chráněné složky nech být.',
      },
    }
  }

  // 7. Memory writes with PII (data minimization).
  if (isMemoryWrite(call) && detectPii(ctx.piiText).length > 0) {
    return {
      kind: 'deny',
      reason: 'Zápis osobních údajů do paměti / poznámek je zakázaný (minimalizace dat).',
      safer: 'Ulož jen neosobní popis, bez konkrétních údajů.',
    }
  }

  // 8. gdpr-strict: reading/copying from protected folders is logged by register;
  //    copying OUT of protected folders needs a purpose — handled in register.

  return { kind: 'allow' }
}
