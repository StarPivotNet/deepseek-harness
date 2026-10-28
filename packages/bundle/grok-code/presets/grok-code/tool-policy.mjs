/**
 * Runtime policy on official tool hooks.
 *
 * Plan-mode write bans and delegated-subagent write bans use
 * `ctx.tools.guard()` after `tools/pre-execute` so later listeners cannot
 * re-allow them. Guard reads `ctx.planMode.get` (same isolate as
 * enter-plan-mode) — never session-log scraping.
 *
 * Dangerous outbound `web_fetch` uses `tools/pre-execute` ask.
 * AgentTeams members keep mutation: captain tools are already restricted
 * away on `agent.ctx.tools.get`.
 *
 * Publishes no service. Relative path is this directory (preset-local
 * row in agent.cordis.yml, same `planMode` isolate as enter-plan-mode).
 */
import { isSessionMemoryPath } from './cognition-path.mjs'

export const name = 'tool-policy'
export const inject = ['tools', 'planMode']

const WRITE_TOOLS = new Set(['file_write', 'file_edit', 'file_move'])
const SHELL_TOOLS = new Set(['pwsh', 'bash'])
const PLAN_TEAM_WRITE_TOOLS = new Set([
  'agent_teams_create',
  'agent_teams_approve',
  'agent_teams_edit_plan',
  'agent_teams_create_task',
  'agent_teams_reassign_task',
])
const CAPTAIN_TEAM_TOOLS = ['agent_teams_create', 'agent_teams_approve']
const MEMBER_TEAM_TOOLS = [
  'agent_teams_claim_task',
  'agent_teams_update_task',
  'agent_teams_send_message',
  'agent_teams_status',
]
const SHELL_MUTATE_RE =
  /(?:^|[;&|\n]|`\s*)\s*(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|Rename-Item|ni\b|rm\b|mv\b|cp\b|echo\s+.+>|tee\b|sed\s+-i|perl\s+-i|python\s+-c\s+.*(?:open|write)|git\s+(?:add|commit|checkout|reset|rebase|merge|push|rm|mv)\b|npm\s+install|pnpm\s+add|yarn\s+add)/i

const PLAN_DENY =
  'Plan mode is active. Do not mutate files (except this session cognition ledger) or start AgentTeams that would edit. Explore, ask, and call exit_plan_mode only when planning is finished.'

const CHILD_DENY =
  'Delegated subagent cannot call write or edit. Mutation belongs to AgentTeams; report the assigned task blocked rather than patching.'

const OUTBOUND_ASK =
  'This web_fetch target is local, private, or not public HTTP(S). Confirm before sending data off this machine.'

export function pathOfArgs(args) {
  if (args == null || typeof args !== 'object') return ''
  if (typeof args.path === 'string' && args.path.length > 0) return args.path
  if (typeof args.file_path === 'string' && args.file_path.length > 0) return args.file_path
  if (Array.isArray(args.files) && args.files.length === 1) {
    const file = args.files[0]
    if (typeof file === 'string' && file.length > 0) return file
    if (file != null && typeof file.file_path === 'string' && file.file_path.length > 0) {
      return file.file_path
    }
  }
  return ''
}

function urlOf(args) {
  if (args == null || typeof args !== 'object') return ''
  return typeof args.url === 'string' ? args.url.trim() : ''
}

function planActive(planMode, agent) {
  if (planMode == null || typeof planMode.get !== 'function' || agent == null) return false
  let state
  try {
    state = planMode.get(agent)
  } catch {
    return false
  }
  if (state == null || typeof state !== 'object') return false
  if (state.active === true) return true
  return state.pending === true
}

export function planWriteReason(exec, planMode) {
  if (exec == null || typeof exec.name !== 'string') return undefined
  if (!planActive(planMode, exec.agent)) return undefined
  if (WRITE_TOOLS.has(exec.name)) {
    const path = pathOfArgs(exec.arguments)
    if (path !== '' && isSessionMemoryPath(path)) return undefined
    return PLAN_DENY
  }
  if (PLAN_TEAM_WRITE_TOOLS.has(exec.name)) return PLAN_DENY
  if (SHELL_TOOLS.has(exec.name)) {
    const command =
      exec.arguments != null && typeof exec.arguments.command === 'string'
        ? exec.arguments.command
        : ''
    if (SHELL_MUTATE_RE.test(command)) return PLAN_DENY
  }
  return undefined
}

function isDelegatedChild(agent) {
  if (agent == null) return false
  const header = agent.session == null ? undefined : agent.session.header
  if (header != null && header.origin === 'subagent') return true
  // Forked conversation branches carry parentSession but no subagent origin
  // or depth, so parentSession alone must not count as delegation.
  const headerDepth = header == null ? undefined : header.delegationDepth
  if (typeof headerDepth === 'number' && headerDepth > 0) return true
  const depth = agent.options == null ? undefined : agent.options.subagentDepth
  return typeof depth === 'number' && depth > 0
}

function isAgentTeamsMember(agent) {
  if (agent == null || agent.ctx == null || agent.ctx.tools == null) return false
  const get = agent.ctx.tools.get
  if (typeof get !== 'function') return false
  const lookup = (name) => {
    try {
      return get.call(agent.ctx.tools, name, agent)
    } catch {
      try {
        return get.call(agent.ctx.tools, name)
      } catch {
        return undefined
      }
    }
  }
  const captainHidden = CAPTAIN_TEAM_TOOLS.every((name) => lookup(name) === undefined)
  const memberVisible = MEMBER_TEAM_TOOLS.some((name) => lookup(name) != null)
  return captainHidden && memberVisible
}

export function childWriteDecision(exec) {
  if (exec == null || typeof exec.name !== 'string') return { kind: 'allow' }
  const blocked =
    WRITE_TOOLS.has(exec.name) ||
    (SHELL_TOOLS.has(exec.name) && SHELL_MUTATE_RE.test(shellCommand(exec)))
  if (!blocked) return { kind: 'allow' }
  const agent = exec.agent
  if (!isDelegatedChild(agent)) return { kind: 'allow' }
  if (isAgentTeamsMember(agent)) return { kind: 'allow' }
  return { kind: 'deny', reason: CHILD_DENY }
}

function shellCommand(exec) {
  if (exec.arguments == null || typeof exec.arguments.command !== 'string') return ''
  return exec.arguments.command
}

function ipv4Octets(hostname) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (match == null) return undefined
  const octets = match.slice(1).map((part) => Number(part))
  if (octets.some((n) => n > 255)) return undefined
  return octets
}

function ipv4MappedOctets(host) {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host)
  if (dotted != null) return ipv4Octets(dotted[1])
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (hex == null) return undefined
  const hi = Number.parseInt(hex[1], 16)
  const lo = Number.parseInt(hex[2], 16)
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255]
}

function isPrivateIpv4(octets) {
  const [a, b] = octets
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

function isNonPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || host === '::') return true
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  const octets = ipv4Octets(host) ?? ipv4MappedOctets(host)
  if (octets != null) return isPrivateIpv4(octets)
  if (host.includes(':') && (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd'))) return true
  return false
}

export function outboundDecision(exec) {
  if (exec == null || exec.name !== 'web_fetch') return { kind: 'allow' }
  const raw = urlOf(exec.arguments)
  if (raw === '') return { kind: 'allow' }
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return { kind: 'ask', reason: OUTBOUND_ASK }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'ask', reason: OUTBOUND_ASK }
  }
  if (isNonPublicHost(parsed.hostname)) return { kind: 'ask', reason: OUTBOUND_ASK }
  return { kind: 'allow' }
}

export function apply(ctx) {
  ctx.tools.guard((exec) => {
    const plan = planWriteReason(exec, ctx.planMode)
    if (plan != null) return plan
    const child = childWriteDecision(exec)
    if (child.kind === 'deny') return child.reason
    return undefined
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    const child = childWriteDecision(exec)
    if (child.kind === 'deny') return child
    const outbound = outboundDecision(exec)
    if (outbound.kind === 'ask') return outbound
    return next()
  })
}
