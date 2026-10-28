/**
 * Think-act reminder right after a tool result.
 *
 * `agi-gates` steers when the turn is closing on the same retry-prone tool.
 * This row fires earlier: after the call, via official `tools/post-execute`
 * (same shape as `dsh-repeat-tool-reminder`). It never rewrites tool
 * content/value; it only prepends additionalContexts.
 * Triggers: error/block, or two consecutive identical-argument mutable tools this turn.
 * Silent on read/grep/glob/todo_write/skill. Complements host
 * repeat-tool-reminder (identical arguments) without replacing it.
 *
 * A `file_edit` with an empty `files` array, or a file whose `edits` array
 * is empty, is denied on `tools/pre-execute`, before the tool runs. The
 * model emitted that payload on its own; waiting for the tool error still
 * let it repeat the call.
 *
 * Publishes no service. Relative path is this directory (preset-local row
 * in agent.cordis.yml).
 */
import { argsKey } from './agi-gates-scan.mjs'

export const name = 'tool-observe'

const MUTE_TOOLS = new Set(['file_read', 'grep', 'glob', 'todo_write', 'skill'])
const MUTABLE_TOOLS = new Set(['file_edit', 'pwsh', 'bash', 'web_search', 'web_fetch'])
const DUPLICATE_THRESHOLD = 2
const NOTICE =
  '[tool-observe] keep/kill/narrow from this result, then the next tool calls. Do not retry the same failing call.'
export const EMPTY_EDIT_REASON =
  '[tool-observe] file_edit was denied before it ran: files or a file edits array is empty. Resend one payload with at least one file and one { old_string, new_string }. Do not retry this call.'

async function loadCreateUserMessage() {
  try {
    const mod = await import('@deepseek-ai/dsh-llm')
    if (mod != null && typeof mod.createUserMessage === 'function') {
      return mod.createUserMessage
    }
  } catch {
    // Host package missing in isolated tests; fall back below.
  }
  return (input) => {
    const message = {
      role: 'user',
      content: input.content,
      source: input.source,
    }
    try {
      if (typeof crypto === 'object' && crypto != null && typeof crypto.randomUUID === 'function') {
        message.id = crypto.randomUUID()
      }
    } catch (error) {}
    return message
  }
}

const createUserMessagePromise = loadCreateUserMessage()

async function noticeMessage() {
  const createUserMessage = await createUserMessagePromise
  return createUserMessage({
    content: [{ type: 'text', text: NOTICE }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-grok-code-tool-observe',
      form: 'notice',
    },
  })
}

function prependContext(ours, theirs) {
  return [ours, ...(theirs ?? [])]
}

function consecutiveSameMutable(events, toolName, args) {
  if (!Array.isArray(events) || !MUTABLE_TOOLS.has(toolName)) return 0
  const target = argsKey(args)
  let count = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event == null) continue
    if (event.type === 'turn/start') break
    if (event.type !== 'tool/call' || event.data == null) continue
    const name = event.data.name
    if (typeof name !== 'string' || name.length === 0) continue
    if (name !== toolName) break
    if (argsKey(event.data.arguments) !== target) break
    count += 1
  }
  return count
}

export function shouldObserve(exec, downstream) {
  if (exec == null || typeof exec.name !== 'string' || MUTE_TOOLS.has(exec.name)) return false
  if (downstream != null && downstream.kind === 'block') return true
  if (downstream != null && downstream.isError === true) return true
  const agent = exec.agent
  if (agent == null || agent.session == null) return false
  return consecutiveSameMutable(agent.session.events, exec.name, exec.arguments) >= DUPLICATE_THRESHOLD
}

function parsedArguments(args) {
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      return undefined
    }
  }
  if (args == null || typeof args !== 'object' || Array.isArray(args)) return undefined
  return args
}

export function emptyEditDenial(exec) {
  if (exec == null || exec.name !== 'file_edit') return undefined
  const args = parsedArguments(exec.arguments)
  if (args === undefined || !Array.isArray(args.files)) return undefined
  const empty = args.files.length === 0 || args.files.some((file) => (
    file != null &&
    typeof file === 'object' &&
    Array.isArray(file.edits) &&
    file.edits.length === 0
  ))
  return empty ? EMPTY_EDIT_REASON : undefined
}

export function apply(ctx) {
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const reason = emptyEditDenial(exec)
      if (reason !== undefined) return { kind: 'deny', reason }
    } catch {
      // A guard failure must not block a well-formed edit.
    }
    return next()
  })
  ctx.on('tools/post-execute', async (exec, _result, next) => {
    const downstream = await next()
    try {
      if (!shouldObserve(exec, downstream)) return downstream
      const extra = await noticeMessage()
      const ctxs = prependContext(extra, downstream == null ? undefined : downstream.additionalContexts)
      if (downstream != null && downstream.kind === 'block') {
        return {
          kind: 'block',
          feedback: downstream.feedback,
          additionalContexts: ctxs,
        }
      }
      return { ...downstream, additionalContexts: ctxs }
    } catch (error) {
      return downstream
    }
  })
}
