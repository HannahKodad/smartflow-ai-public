// State contract for the data-guard mod. Only UI-facing display state lives
// here; the active client, temporary-lowering and pseudonym map are kept in
// $.store / memory and never exposed as personal data.

export type GuardStatus = {
  client: string // active client key, or "(none)"
  display: string // human label
  level: 'standard' | 'gdpr' | 'gdpr-strict' | 'none'
  effectiveLevel: 'standard' | 'gdpr' | 'gdpr-strict'
  domains: string[] // allowed sharing domains
  tempUntil: number | null // epoch ms a temporary lowering ends, or null
  tempReason: string | null
  blocked: number // blocked attempts this session
  confirmed: number // confirmed sensitive actions this session
  loadError: string | null // profile parse error, if any
}

declare module 'claude-code' {
  interface PluginState {
    'data-guard': {
      status: GuardStatus
    }
  }
}
