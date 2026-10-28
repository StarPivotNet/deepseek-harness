/**
 * Session notes snapshot at the start of a turn (per session).
 *
 * This row injects a trimmed read of `$DSH_HOME/cognitions/<project>/<sessionId>/notes.md`
 * on `agent/pre-step` step 1 (official tmux-context shape: prepend, skip when unchanged).
 * Duplicate headings keep the first copy so an appended rewrite does not inject twice.
 * Checked-off (`- [x]`) receipts are kept.
 * It never creates or writes the file.
 * Publishes no service. Relative path is this directory (preset-local row
 * in agent.cordis.yml).
 */

import { cwdOf, notesPathFor, sessionIdOf } from './cognition-path.mjs'

export const name = 'notes-inject'

const PLUGIN = 'dsh-grok-code-notes-inject'
const MAX_CHARS = 4000
const HEADINGS = new Set(['User', 'Facts', 'Decisions', 'Open'])

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

export function extractSections(markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) return ''
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const kept = []
  const seenHeadings = new Set()
  let keep = false
  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line)
    if (match) {
      const heading = match[1]
      if (!HEADINGS.has(heading)) {
        keep = false
        continue
      }
      if (seenHeadings.has(heading)) {
        keep = false
        continue
      }
      seenHeadings.add(heading)
      keep = true
      kept.push(line)
      continue
    }
    if (!keep) continue
    kept.push(line)
  }
  let text = kept.join('\n').trim()
  if (text.length === 0) return ''
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS).trimEnd()}\n…`
  return text
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
      sections: [{ name: 'cognition:notes', text }],
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
        const notesPath = notesPathFor(cwdOf(agent), sessionIdOf(agent))
        if (notesPath === undefined) return decision
        const fs = ctx.get('fs')
        if (fs == null || typeof fs.resolve !== 'function' || typeof fs.readText !== 'function') return decision
        let target = undefined
        try {
          target = await fs.resolve(notesPath)
        } catch (error) {
          return decision
        }
        if (target == null) return decision
        let raw = undefined
        try {
          raw = await fs.readText(target, signal)
        } catch (error) {
          return decision
        }
        const text = extractSections(raw)
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
