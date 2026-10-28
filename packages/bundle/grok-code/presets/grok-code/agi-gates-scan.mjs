/**
 *
 * Pure functions over session events. The plugin (`agi-gates.mjs`) runs this
 * once on serial `agent/turn-stopping` and steers at most one notice.
 * No model-facing tools. No service.
 *
 * Priority (first hit wins):
 *   stuck → acceptance → critic → ledger → deferral
 *   (no open-ended goal gate; deferral only catches an offer to do same-goal work later)
 */
import { isCognitionPath, isSessionMemoryPath, normalizePath } from './cognition-path.mjs'

export const GATE_ORDER = [
  'stuck',
  'acceptance',
  'critic',
  'ledger',
  'deferral',
]


const REVIEWER_PROMPT_RE = /read-only Senior Code Reviewer/i
const MUTATE_TOOLS = new Set(['file_write', 'file_edit', 'file_move'])
const PROOF_TOOLS = new Set(['pwsh', 'bash'])
const RETRY_TOOLS = new Set(['pwsh', 'bash', 'web_search', 'web_fetch'])
const PLAN_ENTER = 'enter_plan_mode'
const PLAN_EXIT = 'exit_plan_mode'

const CLAIM_RE =
  /\b(done|fixed|pass(?:es|ing|ed)?|ready(?: to merge)?|complete[d]?|resolved|works now|should work)\b|测试通过|已修复|已完成|修好了|可以合并/
const UNVERIFIED_RE =
  /\b(did not verify|not verified|unverified|cannot run|can't run|no test|blocked)\b|未验证|没法跑|没有测试/
const DEFERRAL_RE = /if you want|let me know if|如果需要|要不要我|我可以再/i

const EXIT_RE = /\[exit code:\s*(-?\d+)\]/g

export function eventsThisTurn(events) {
  if (!Array.isArray(events) || events.length === 0) return []
  let start = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index] != null && events[index].type === 'turn/start') {
      start = index
      break
    }
  }
  return events.slice(start)
}

export function blockText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block == null) continue
    if (typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

function toolCallName(event) {
  if (event == null || event.type !== 'tool/call' || event.data == null) return ''
  return typeof event.data.name === 'string' ? event.data.name : ''
}

function toolCallId(event) {
  if (event == null || event.data == null) return ''
  if (typeof event.data.callId === 'string') return event.data.callId
  const message = event.data.message
  if (message != null && typeof message.callId === 'string') return message.callId
  return ''
}

function toolResultMessage(event) {
  if (event == null || event.type !== 'tool/result' || event.data == null) return undefined
  return event.data.message
}

export function toolResultText(event) {
  const message = toolResultMessage(event)
  return blockText(message == null ? undefined : message.content)
}

export function toolResultIsError(event) {
  if (event == null || event.type !== 'tool/result' || event.data == null) return false
  if (event.data.error != null) return true
  const message = event.data.message
  if (message != null && message.isError === true) return true
  return false
}

export function lastExitCode(text) {
  if (typeof text !== 'string' || text.length === 0) return undefined
  let last = undefined
  EXIT_RE.lastIndex = 0
  let match
  while ((match = EXIT_RE.exec(text)) !== null) {
    last = Number(match[1])
  }
  return last
}

function argsOf(event) {
  const raw = event == null || event.data == null ? undefined : event.data.arguments
  if (raw == null) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed != null && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  if (typeof raw === 'object') return raw
  return {}
}

function parseArgs(raw) {
  if (raw == null) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

export function argsKey(raw) {
  return stableStringify(parseArgs(raw))
}

function proofIdentity(raw) {
  const parsed = parseArgs(raw)
  if (
    parsed != null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof parsed.command === 'string' &&
    parsed.command.length > 0
  ) {
    return parsed.command
  }
  return argsKey(raw)
}

function pathsOfFileEntries(files) {
  if (!Array.isArray(files)) return []
  const paths = []
  for (const file of files) {
    if (typeof file === 'string' && file.length > 0) paths.push(file)
    else if (file != null && typeof file.file_path === 'string' && file.file_path.length > 0) {
      paths.push(file.file_path)
    }
  }
  return paths
}

export function pathOfArgs(args) {
  if (args == null || typeof args !== 'object') return ''
  if (typeof args.path === 'string' && args.path.length > 0) return args.path
  if (typeof args.file_path === 'string' && args.file_path.length > 0) return args.file_path
  const paths = pathsOfFileEntries(args.files)
  return paths.length === 1 ? paths[0] : ''
}

export function pathsOfArgs(args) {
  if (args == null || typeof args !== 'object') return []
  const paths = pathsOfFileEntries(args.files)
  if (paths.length > 0) return paths
  if (typeof args.from === 'string' && args.from.length > 0) paths.push(args.from)
  if (typeof args.to === 'string' && args.to.length > 0) paths.push(args.to)
  if (paths.length > 0) return paths
  const path = pathOfArgs(args)
  return path === '' ? [] : [path]
}

function isSkillMdPath(value) {
  return /SKILL\.md$/i.test(normalizePath(value))
}

export function latestTodos(events) {
  if (!Array.isArray(events)) return []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event == null || event.type !== 'todo/write') continue
    const todos = event.data == null ? undefined : event.data.todos
    return Array.isArray(todos) ? todos : []
  }
  return []
}

export function consecutiveSameRetryTool(turnEvents) {
  if (!Array.isArray(turnEvents)) return { count: 0, name: '' }
  const calls = []
  for (let index = turnEvents.length - 1; index >= 0; index -= 1) {
    const event = turnEvents[index]
    const name = toolCallName(event)
    if (name.length === 0) continue
    calls.push({ name, key: argsKey(event.data == null ? undefined : event.data.arguments) })
  }
  if (calls.length === 0) return { count: 0, name: '' }
  const last = calls[0]
  if (!RETRY_TOOLS.has(last.name)) return { count: 0, name: last.name }
  let count = 0
  for (const call of calls) {
    if (call.name !== last.name) break
    if (call.key !== last.key) break
    count += 1
  }
  return { count, name: last.name }
}

function lastAssistantText(turnEvents) {
  if (!Array.isArray(turnEvents)) return ''
  for (let index = turnEvents.length - 1; index >= 0; index -= 1) {
    const event = turnEvents[index]
    if (event == null || event.type !== 'assistant/message') continue
    const message = event.data == null ? undefined : event.data.message
    return blockText(message == null ? undefined : message.content)
  }
  return ''
}

function planModeActive(events) {
  if (!Array.isArray(events)) return false
  const namesById = new Map()
  let active = false
  for (const event of events) {
    if (event == null) continue
    if (event.type === 'tool/call') {
      const name = toolCallName(event)
      const id = toolCallId(event)
      if (id !== '' && name !== '') namesById.set(id, name)
      if (name === PLAN_ENTER) active = true
      continue
    }
    if (event.type !== 'tool/result') continue
    const id = toolCallId(event)
    const name = id === '' ? '' : namesById.get(id) ?? ''
    if (name === PLAN_EXIT) {
      const text = toolResultText(event)
      active = !/\bapproved\b/i.test(text)
    }
  }
  return active
}

function isIndependentReviewCall(event) {
  if (event == null || event.type !== 'tool/call') return false
  const name = toolCallName(event)
  const args = argsOf(event)
  if (name === 'subagent') {
    const prompt = typeof args.prompt === 'string' ? args.prompt : ''
    const description = typeof args.description === 'string' ? args.description : ''
    return (
      description === 'session reviewer' ||
      REVIEWER_PROMPT_RE.test(prompt) ||
      REVIEWER_PROMPT_RE.test(description)
    )
  }
  if (name === 'send_message') {
    const message = typeof args.message === 'string' ? args.message : ''
    return REVIEWER_PROMPT_RE.test(message)
  }
  if (name === 'agent_teams_create_task') {
    return args.kind === 'review'
  }
  if (name === 'agent_teams_update_task') {
    return typeof args.verdict === 'string' && args.verdict.length > 0
  }
  return false
}

function turnHasIndependentReview(events) {
  if (!Array.isArray(events)) return false
  for (const event of events) {
    if (isIndependentReviewCall(event)) return true
  }
  return false
}

function collectCalls(turnEvents) {
  const namesById = new Map()
  const argsById = new Map()
  const results = []
  const mutatePaths = []
  let proofOk = false
  let proofFail = false
  let lastProofExit = undefined
  let failedProofKey = undefined
  for (const event of turnEvents) {
    if (event == null) continue
    if (event.type === 'tool/call') {
      const name = toolCallName(event)
      const id = toolCallId(event)
      if (id !== '' && name !== '') {
        namesById.set(id, name)
        argsById.set(id, proofIdentity(event.data == null ? undefined : event.data.arguments))
      }
      if (MUTATE_TOOLS.has(name)) {
        mutatePaths.push(...pathsOfArgs(argsOf(event)))
      }
      continue
    }
    if (event.type !== 'tool/result') continue
    const id = toolCallId(event)
    const name = id === '' ? '' : namesById.get(id) ?? ''
    const text = toolResultText(event)
    const isError = toolResultIsError(event)
    const exit = lastExitCode(text)
    const failed = isError || (typeof exit === 'number' && exit !== 0)
    const ok = !failed
    results.push({ name, failed, ok, exit, text })
    if (PROOF_TOOLS.has(name)) {
      const key = id === '' ? '' : argsById.get(id) ?? ''
      if (failed) {
        lastProofExit = exit
        proofFail = true
        proofOk = false
        failedProofKey = key
      } else if (failedProofKey !== undefined && key === failedProofKey) {
        lastProofExit = exit
        proofOk = true
        proofFail = false
        failedProofKey = undefined
      } else if (!proofFail) {
        lastProofExit = exit
        proofOk = true
      }
    }
  }

  return {
    mutatePaths,
    proofOk,
    proofFail,
    lastProofExit,
    results,
  }
}

function distinctMutatedFiles(paths) {
  const seen = new Set()
  for (const path of paths) {
    if (typeof path !== 'string' || path.length === 0) continue
    if (isSessionMemoryPath(path)) continue
    seen.add(normalizePath(path).toLowerCase())
  }
  return seen
}

function openTodoCount(todos) {
  let open = 0
  for (const item of todos) {
    if (item == null || typeof item.content !== 'string') continue
    if (item.status === 'pending' || item.status === 'in_progress') open += 1
  }
  return open
}

function touchedFilesThisTurn(turnEvents) {
  for (const event of turnEvents) {
    if (event == null) continue
    if (event.type === 'fs/observed') return true
    const name = toolCallName(event)
    if (typeof name === 'string' && /^(edit|write|pwsh|bash)$/i.test(name)) return true
  }
  return false
}

/**
 * @param {unknown[]} events
 * @param {{ duplicateThreshold?: number }} [options]
 */
export function collectFacts(events, options = {}) {
  const list = Array.isArray(events) ? events : []
  const turnEvents = eventsThisTurn(list)
  const stuck = consecutiveSameRetryTool(turnEvents)
  const calls = collectCalls(turnEvents)
  const mutated = distinctMutatedFiles(calls.mutatePaths)
  const todos = latestTodos(list)
  const openTodos = openTodoCount(todos)
  const assistant = lastAssistantText(turnEvents)
  const claimed = CLAIM_RE.test(assistant)
  const admittedUnverified = UNVERIFIED_RE.test(assistant)
  const planMode = planModeActive(list)
  const hasReview = turnHasIndependentReview(turnEvents)
  const threshold = typeof options.duplicateThreshold === 'number' ? options.duplicateThreshold : 2
  let ledgerUpdatedThisTurn = false
  for (const path of calls.mutatePaths) {
    if (isCognitionPath(path)) {
      ledgerUpdatedThisTurn = true
      break
    }
  }
  const facts = {
    planMode,
    stuck: stuck.count >= threshold,
    stuckName: stuck.name,
    stuckCount: stuck.count,
    mutatedCount: mutated.size,
    mutatedPaths: [...mutated],
    claimed,
    admittedUnverified,
    proofOk: calls.proofOk,
    proofFail: calls.proofFail,
    lastProofExit: calls.lastProofExit,
    openTodos,
    hasReview,
    touchedFiles: touchedFilesThisTurn(turnEvents),
    ledgerUpdatedThisTurn,
    assistant,
  }

  const implMutated = facts.mutatedPaths.filter((path) => !isSkillMdPath(path))
  const implCount = implMutated.length
  const proofPassed = calls.proofOk && !calls.proofFail
  const proofNeeded = !planMode && !admittedUnverified && implCount > 0

  facts.implCount = implCount
  facts.acceptance = proofNeeded && !proofPassed
  facts.critic = !planMode && implCount >= 2 && !hasReview
  facts.ledger = mutated.size > 0 && !ledgerUpdatedThisTurn
  facts.deferral = !planMode && !admittedUnverified && DEFERRAL_RE.test(assistant)

  return facts
}

export function gateMessage(id, facts) {
  if (id === 'stuck') {
    return `[agi-gates:stuck] Same tool \`${facts.stuckName}\` ran ${facts.stuckCount} times in a row this turn. Change tool, arguments, or decompose before closing. Do not retry the same call.`
  }
  if (id === 'acceptance') {
    const exit =
      typeof facts.lastProofExit === 'number' ? ` Last proof exit was ${facts.lastProofExit}.` : ''
    return `[agi-gates:acceptance] This turn mutated files but has no this-turn pwsh/bash proof with exit 0.${exit} Run the proof now (the validating section). Do not claim done/fixed/passing without that result. If you cannot run it, say so and do not claim.`
  }
  if (id === 'critic') {
    return `[agi-gates:critic] ${facts.implCount ?? facts.mutatedCount} files changed this turn and no independent reviewer ran. Load requesting-code-review and hand the diff to the standing continuable reviewer labeled \`session reviewer\` (\`list_agents\`, then \`send_message\`; spawn \`subagent\` only if that label is absent, with \`run_in_background\` true). Do not start a one-shot reviewer and do not fork. Do not self-review this diff.`
  }
  if (id === 'ledger') {
    return `[agi-gates:ledger] This turn edited files but the cognition ledger was not updated. Before the turn closes, fold the keep/kill into \`$DSH_HOME/cognitions/<project>/<sessionId>/cognition.md\` (this session's ledger only), or state in one line why it needs no update.`
  }
  if (id === 'deferral') {
    return `[agi-gates:deferral] The closing text offers later work instead of doing it. Do that same-goal work now, or state the blocker. Do not offer.`
  }
}

/**
 * @param {ReturnType<typeof collectFacts>} facts
 * @returns {{ id: string, text: string } | null}
 */
export function pickGate(facts) {
  if (facts == null || typeof facts !== 'object') return null
  for (const id of GATE_ORDER) {
    if (facts[id] === true) return { id, text: gateMessage(id, facts) }
  }
  return null
}

/**
 * @param {unknown[]} events
 * @param {{ duplicateThreshold?: number }} [options]
 */

export function scanTurn(events, options) {
  return pickGate(collectFacts(events, options))
}
