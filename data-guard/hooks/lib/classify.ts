// Classifies a tool call without hard-coding connector ids. MCP servers carry
// a random id per account, so a call is recognised by the SUFFIX after the
// last "__" (the tool name on its server) and by broad server-family guesses.

export type Action =
  | 'delete' // moving/removing data: trash, delete, rm, overwrite-with-empty
  | 'share' // changing sharing or permissions
  | 'move' // moving between folders, or overwriting an existing file
  | 'send' // sending/forwarding a message outward
  | 'network' // a shell command that talks to the network
  | 'web' // web search / fetch / browser navigation
  | 'create' // creating/uploading/writing a new file
  | 'read' // reading a file or listing
  | 'memory' // writing to Claude's memory/notes
  | 'publish' // exposing to a public address: artifact, page, shared link, push
  | 'other'

export type Family = 'drive' | 'gmail' | 'calendar' | 'docs' | 'web' | 'browser' | 'bash' | 'file' | 'agent' | 'memory' | 'other'

export type Call = {
  tool: string
  suffix: string // the part after the last "__", or the whole name
  server: string // the part before the last "__" (mcp__<server>__), or ''
  family: Family
  actions: Action[]
  args: Record<string, unknown>
}

const suffixOf = (tool: string): string => {
  const i = tool.lastIndexOf('__')
  return i < 0 ? tool : tool.slice(i + 2)
}
const serverOf = (tool: string): string => {
  if (!tool.startsWith('mcp__')) return ''
  const i = tool.lastIndexOf('__')
  return i < 0 ? '' : tool.slice(5, i)
}

// Tool-name suffixes grouped by the connector family they belong to. These are
// the Google Workspace + Docs connector verbs; matched on suffix, id-agnostic.
const DRIVE_SUFFIXES = new Set([
  'search_files', 'list_recent_files', 'read_file_content', 'download_file_content', 'get_file_metadata',
  'get_file_permissions', 'get_shared_drive_metadata', 'list_shared_drives', 'list_file_revisions',
  'create_file', 'copy_file', 'update_file', 'share_file', 'trash_file',
])
const GMAIL_SUFFIXES = new Set([
  'send_message', 'forward', 'reply', 'create_draft', 'update_draft', 'delete_draft', 'get_draft', 'list_drafts',
  'trash_message', 'trash_thread', 'untrash_message', 'untrash_thread', 'delete_label', 'create_label', 'update_label',
  'label_message', 'label_thread', 'unlabel_message', 'unlabel_thread', 'update_message_labels',
  'get_message', 'get_thread', 'search_threads', 'download_gmail_attachment',
  'mark_message_spam', 'mark_thread_spam', 'unmark_message_spam', 'unmark_thread_spam',
  'apply_sensitive_message_label', 'apply_sensitive_thread_label',
])
const CAL_SUFFIXES = new Set([
  'create_event', 'update_event', 'delete_event', 'get_event', 'list_events', 'list_calendars',
  'respond_to_event', 'search_events', 'suggest_time',
])

const DELETE_VERBS = /^(trash|delete)/
// A permission-CHANGING verb — not a read like get_file_permissions or
// list_shared_drives (those merely contain "permission"/"shared").
const SHARE_VERBS = /^(share|unshare)|^(add|set|create|update|remove|delete)_permission|writers_can_share/i
const SEND_VERBS = /^(send|forward|reply)/

export function familyOf(tool: string, suffix: string): Family {
  if (tool === 'Bash') return 'bash'
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit' || tool === 'Read') return 'file'
  if (tool === 'WebSearch' || tool === 'WebFetch') return 'web'
  if (tool === 'Agent' || tool === 'Task') return 'agent'
  if (tool.startsWith('mcp__Claude_Browser__') || tool.startsWith('mcp__claude-in-chrome__')) return 'browser'
  if (DRIVE_SUFFIXES.has(suffix) || suffix.endsWith('_file') || suffix.endsWith('_files')) return 'drive'
  if (GMAIL_SUFFIXES.has(suffix) || suffix.endsWith('_message') || suffix.endsWith('_thread') || suffix.endsWith('_draft')) return 'gmail'
  if (CAL_SUFFIXES.has(suffix) || suffix.endsWith('_event')) return 'calendar'
  // Claude Docs connector (create/read/update/delete/query/export)
  if (tool.startsWith('mcp__') && ['delete', 'update', 'create', 'export', 'query', 'read'].includes(suffix)) return 'docs'
  return 'other'
}

const NETWORK_CMD = /\b(curl|wget|nc|ncat|netcat|ssh|scp|sftp|rsync|ftp|telnet|http|https|npm|pnpm|yarn|pip|pip3|brew|gh|aws|gcloud|az|kubectl|git\s+(push|clone|fetch|pull|remote))\b/
// Publishing from a shell: pushing to a remote repo, creating a public repo/PR/gist/release.
const PUBLISH_CMD = /\bgit\s+push\b|\bgh\s+(repo|pr|release|gist)\s+\w*(create|edit|publish)?\b/
// Tools that expose content at a public address (artifacts / hosted pages).
const PUBLISH_TOOL = /^(Artifact|mcp__claude-artifacts)/
// Deletion in a shell command. Note: redirects like `2>/dev/null` or `>/dev/null`
// are NOT deletion — only real remove/truncate verbs are. `find … -delete` is caught
// in context; a bare `-delete` flag (e.g. rsync/git branch --delete) via `--delete`.
const DELETE_CMD = /(^|[|;&]|\s)(rm|rmdir|unlink|shred|srm|trash)\b|\bfind\b[^|;&]*-delete\b|--delete\b|\bgit\s+clean\b|\bgit\s+rm\b|\btruncate\b/
const EVASION_CMD = /\b(python3?|node|deno|ruby|perl|osascript|bash\s+-c|sh\s+-c|zsh\s+-c|eval|base64|xxd)\b/

export function classify(input: Record<string, unknown>): Call {
  const tool = String(input.tool ?? '')
  const suffix = suffixOf(tool)
  const server = serverOf(tool)
  const family = familyOf(tool, suffix)
  const { tool: _t, tool_use_id: _u, agentId: _a, ...args } = input
  const actions = new Set<Action>()

  if (PUBLISH_TOOL.test(tool)) actions.add('publish')

  if (family === 'bash') {
    const cmd = String(args.command ?? '')
    if (DELETE_CMD.test(cmd)) actions.add('delete')
    if (NETWORK_CMD.test(cmd)) actions.add('network')
    if (EVASION_CMD.test(cmd)) actions.add('network') // treated as possible exfil on GDPR levels
    if (PUBLISH_CMD.test(cmd)) actions.add('publish')
  } else if (family === 'file') {
    if (tool === 'Read') actions.add('read')
    else if (tool === 'Write') {
      const content = String(args.content ?? '')
      actions.add(content.trim() === '' ? 'delete' : 'move') // empty overwrite = deletion attempt; otherwise may overwrite
      actions.add('create')
    } else actions.add('move')
  } else if (family === 'web') {
    actions.add('web')
  } else if (family === 'browser') {
    actions.add('web')
  } else if (family === 'agent') {
    actions.add('other')
  } else {
    // MCP connector verbs
    if (DELETE_VERBS.test(suffix)) actions.add('delete')
    if (SEND_VERBS.test(suffix)) actions.add('send')
    if (SHARE_VERBS.test(suffix)) actions.add('share')
    if (suffix === 'update_file') {
      // a move is a parentId change; a share is writersCanShare/inherited; otherwise metadata
      if ('parentId' in args) actions.add('move')
      if ('writersCanShare' in args || 'inheritedPermissionsDisabled' in args) actions.add('share')
    }
    if (suffix === 'create_file' || suffix === 'copy_file') actions.add('create')
    if (suffix === 'download_file_content' || suffix === 'download_gmail_attachment') actions.add('read')
    if (/^(search|list|get|read|query|export)/.test(suffix)) actions.add('read')
  }
  if (actions.size === 0) actions.add('other')
  return { tool, suffix, server, family, actions: [...actions], args }
}

// App / harness tooling (session UI, terminal panel, charts, plugin authoring,
// connector registry, scheduled tasks) and local reasoning tools. These never
// handle client data, so the whitelist and web/network gates must not apply to
// them — otherwise the strictest level would block the session's own controls.
export const INFRA_TOOL = /^mcp__(ccd_|terminal|visualize|easel|plugin-authoring|mcp-registry|scheduled-tasks)/
// Bare built-in control tools (ask the user, plan mode, tool search, skills):
// UI/flow only, never client data, so they are exempt like the mcp__ infra above.
const INFRA_BUILTIN = new Set(['ToolSearch', 'Skill', 'AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'])
export const isInfraTool = (tool: string): boolean => INFRA_TOOL.test(tool) || INFRA_BUILTIN.has(tool)

export const isMemoryWrite = (c: Call): boolean =>
  c.family === 'file' &&
  (c.actions.includes('move') || c.actions.includes('create')) &&
  /\/memory\/|MEMORY\.md$/.test(String(c.args.file_path ?? ''))
