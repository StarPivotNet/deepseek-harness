/**
 * Cross-turn todo queue as a pre-step user snapshot.
 *
 * Official `todos` projection clears to `null` on every `turn/start` (UI
 * current-plan bar). The model still needs the last whole-list snapshot
 * across turns. This row scans session events for the latest `todo/write`
 * and injects in_progress / pending / blocked / completed-count on
 * `agent/pre-step` step 1 (official tmux-context shape: prepend, skip when
 * unchanged). Empty queues (no in_progress, pending, or blocked) are dropped.
 * It does not write `systemPrompt.context`, so a changing queue cannot bust
 * the stable prefix cache.
 *
 * Publishes no service. Relative path is this directory (preset-local row
 * in agent.cordis.yml).
 */

export const name = 'todo-inject'

const PLUGIN = 'dsh-grok-code-todo-inject'

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

export function latestTodos(events) {
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event == null || event.type !== 'todo/write') continue
    const todos = event.data == null ? undefined : event.data.todos
    return Array.isArray(todos) ? todos : undefined
  }
  return undefined
}

const BLOCKED_RE = /\bblocked\b|阻塞|blocked:/i

export function renderQueue(todos) {
  if (!Array.isArray(todos) || todos.length === 0) return ''
  const inProgress = []
  const pending = []
  const blocked = []
  let completed = 0
  for (const item of todos) {
    if (item == null || typeof item.content !== 'string' || item.content.length === 0) continue
    if (item.status === 'completed') {
      completed += 1
      continue
    }
    if (item.status !== 'in_progress' && item.status !== 'pending') continue
    if (BLOCKED_RE.test(item.content)) blocked.push(item.content)
    else if (item.status === 'in_progress') inProgress.push(item.content)
    else pending.push(item.content)
  }
  if (inProgress.length === 0 && pending.length === 0 && blocked.length === 0) return ''
  const lines = ['Current todo queue:']
  lines.push(
    inProgress.length === 0
      ? '- in_progress: (none)'
      : `- in_progress: ${inProgress.join(' | ')}`,
  )
  lines.push(pending.length === 0 ? '- pending: (none)' : `- pending: ${pending.join(' → ')}`)
  lines.push(blocked.length === 0 ? '- blocked: (none)' : `- blocked: ${blocked.join(' | ')}`)
  lines.push(`- completed: ${completed}`)
  return lines.join('\n')
}

function latestInjectedText(agent) {
  const events = agent == null || agent.session == null ? undefined : agent.session.events
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event == null || event.type !== 'user/message') continue
    const source = event.data == null ? undefined : event.data.source
    if (source == null || source.kind !== 'plugin' || source.plugin !== PLUGIN) continue
    const content = event.data.content
    const block = Array.isArray(content) ? content[0] : undefined
    if (block == null || block.type !== 'text' || typeof block.text !== 'string') return undefined
    return block.text
  }
  return undefined
}

async function snapshotMessage(text) {
  const createUserMessage = await createUserMessagePromise
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: PLUGIN,
      form: 'snapshot',
      sections: [{ name: 'todos:queue', text }],
    },
  })
}

export function apply(ctx) {
  ctx.on(
    'agent/pre-step',
    async ({ agent, step, signal }, next) => {
      const decision = await next()
      try {
        if (step !== 1 || decision == null || decision.kind === 'reject') return decision
        if (signal != null && signal.aborted) return decision
        const text = renderQueue(latestTodos(agent == null || agent.session == null ? undefined : agent.session.events))
        if (text === '') return decision
        const previous = latestInjectedText(agent)
        if (previous === text) return decision
        const message = await snapshotMessage(text)
        const rest = Array.isArray(decision.messages) ? decision.messages : []
        return { kind: 'enter', messages: [message, ...rest] }
      } catch (error) {
        return decision
      }
    },
    { prepend: true },
  )
}
