/**
 * Swap DSH's generic compaction instruction for this preset's.
 *
 * dsh-compaction-basic hardcodes COMPACTION_INSTRUCTION and has no config
 * hook. The summarizer call is hand-built (`purpose: 'compaction'`), not an
 * agent-loop request, so it is not frozen. `llm/stream`'s `next()` takes no
 * replacement options; mutating `options.messages` is the legal rewrite.
 *
 * The event is bound to the host LlmRuntime, so a session-scoped listener
 * would be filtered out. Register globally and rewrite only when the live
 * session's current agentPreset is this preset (`dsh-grok-code`). Do not
 * key off agent/created: that event is scope-filtered and a standing
 * mount may miss it. Filter with sessions.get + header / latest
 * agent-preset/selected event instead.
 *
 * Match the official last user message by `source.plugin ===
 * 'dsh-compaction-basic'` first so a DSH instruction-text bump does not
 * silently skip the rewrite. Keep the prefix fallback for older hosts.
 * Wrap the rewrite in try/catch like grok-conv-header: frozen options
 * must never break the summarizer stream.
 *
 * Compacted history drops shadowed assistant reasoning from later turns.
 * The instruction therefore tells the summarizer to lift still-live
 * hypotheses into ## Problem Solving, which is what the successor reads.
 * The recent uncompacted tail stays in the next request, so the checkpoint
 * must not dump full files.
 */
export const name = 'compaction-instruction'
export const inject = ['sessions']

const GROK_PREFIX = 'dsh-grok'
const DSH_PLUGIN = 'dsh-compaction-basic'
const OURS_PLUGIN = 'dsh-grok-code-compaction-instruction'

const DSH_INSTRUCTION_PREFIX =
  'You are now acting as a compaction engine for this AI coding assistant.'

const GROK_INSTRUCTION = [
  'Your task is to produce a faithful, concise summary of the conversation ABOVE so a successor assistant can continue after the earlier turns are discarded. The successor will see this checkpoint plus the recent uncompacted tail. Capture what is needed to continue — the user\'s explicit requests, your most recent actions, key technical details, file paths, commands, configuration, architectural decisions, and still-live hidden-thought state — but be economical: prefer tight prose and short references over long verbatim dumps, and do not pad. A focused summary that fits is far more useful than an exhaustive one that gets cut off.',
  '',
  'CRITICAL: If earlier turns include a prior checkpoint (a <compacted-summary> block or "This is an automatically generated checkpoint" preamble), treat it as authoritative for the early history and carry its still-relevant information forward. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.',
  '',
  'Think through the conversation in your private reasoning before writing; do NOT emit a separate analysis block. Hidden thoughts on assistant messages above (reasoning / thinking blocks) are evidence. If they use the six headings (Goal, Constraints, Kills, Live, Choice, Next), extract still-live rows into Problem Solving — do not dump draft code or the full chain. If `$DSH_HOME/cognitions/<project>/<sessionId>/cognition.md` was read or written above, treat it as authoritative for Goal, Constraints, Kills, Live, Next, Paths, and Queue; fold live rows into Problem Solving, Current Work, and Pending Jobs. Omit `- [x]` Goal/Queue rows and Queue completed from Pending Jobs — they are receipts, not open jobs, unless the user asked to redo or continue. Do not invent a ledger that was never used. Ignore leftover workspace `.dsh/cognition.md`. If notes.md at `$DSH_HOME/cognitions/<project>/<sessionId>/notes.md` was read or written above, fold still-true User/Facts/Decisions into Key Technical Concepts / Files / Critical Context; do not invent unused notes; ignore leftover workspace `.dsh/notes.md`. Do not dump Open as Pending Jobs. If plan mode was entered, still active, or an exit_plan_mode review was pending/approved/kept-planning, record that state in Current Work and Next Step.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  "- [the user's explicit requests and underlying intent; quote verbatim where the exact wording matters. Preserve constraints, scope boundaries, and stated preferences.]",
  '',
  '## Key Technical Concepts',
  '- [technologies, languages, frameworks, libraries, tools, and patterns discussed or relied upon]',
  '',
  '## Files and Code',
  '- [exact path: why it matters; key signatures or 1–3 line fragments only. The successor still has the recent uncompacted tail — do not dump whole files or the most recent edits in full.]',
  '',
  '## Errors and Fixes',
  '- [error / failed command / test failure: root cause and exact fix. Quote user-supplied fixes verbatim.]',
  '',
  '## Problem Solving',
  '- [solved problems; in-progress diagnosis; live hypotheses; killed hypotheses and why; constraints that must hold; the next check or edit]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed — do not invent tasks. Include live todo_write / ledger Queue pending, current, and blocked items if they exist — each key once. Omit Queue completed and `- [x]` rows; they are receipts, not open jobs unless the user asked to redo or continue.]',
  '',
  '## Current Work',
  '- [precisely what was in progress at this checkpoint, with recent file names, commands, and state. Include plan-mode status when relevant.]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)". When a next step exists, quote the leave-off point.]',
  '',
  '## Critical Context',
  '- [decisions and rationale, constraints, user preferences, open questions, data needed to continue. Include an approved or in-review plan title if one exists, not the full plan dump.]',
  '',
  'Rules:',
  '- Write ## Problem Solving in English as compact decision rows for the successor. Write other sections in Simplified Chinese unless the user explicitly named a reply language; then those sections may follow that named language. The language of user messages is not a language request. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
].join('\n')

function isGrokPreset(session) {
  if (session == null) return false
  const names = []
  try {
    if (session.header != null && typeof session.header.agentPreset === 'string') names.push(session.header.agentPreset)
    const events = session.events
    if (Array.isArray(events)) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event != null && event.type === 'agent-preset/selected' && event.data != null && typeof event.data.agentPreset === 'string') {
          names.push(event.data.agentPreset)
          break
        }
      }
    }
  } catch (error) {}
  for (const name of names) {
    if (typeof name === 'string' && name.indexOf(GROK_PREFIX) === 0) return true
  }
  return false
}

function lastUserText(message) {
  if (message == null || message.role !== 'user' || !Array.isArray(message.content)) return
  const parts = []
  for (const block of message.content) {
    if (block != null && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  if (parts.length === 0) return
  return parts.join('\n')
}

function pluginOf(message) {
  const source = message == null ? undefined : message.source
  return source != null && source.kind === 'plugin' && typeof source.plugin === 'string'
    ? source.plugin
    : undefined
}

function isDshCompactionUserMessage(message) {
  if (message == null || message.role !== 'user') return false
  const plugin = pluginOf(message)
  if (plugin === OURS_PLUGIN) return false
  if (plugin === DSH_PLUGIN) return true
  const text = lastUserText(message)
  return typeof text === 'string' && text.startsWith(DSH_INSTRUCTION_PREFIX)
}

function freezeDeep(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item)
  } else {
    for (const key of Object.keys(value)) freezeDeep(value[key])
  }
  return Object.freeze(value)
}

function rewriteCompactionOptions(options) {
  const messages = options.messages
  if (!Array.isArray(messages) || messages.length === 0) return
  const last = messages[messages.length - 1]
  if (!isDshCompactionUserMessage(last)) return
  const replacement = {
    role: 'user',
    content: [{ type: 'text', text: GROK_INSTRUCTION }],
    source: {
      kind: 'plugin',
      plugin: OURS_PLUGIN,
    },
  }
  if (typeof last.id === 'string') replacement.id = last.id
  const next = messages.slice()
  next[next.length - 1] = freezeDeep(replacement)
  options.messages = next
}

export function apply(ctx) {
  ctx.on('llm/stream', (options, next) => {
    try {
      if (options == null || options.purpose !== 'compaction') return next()
      const sessions = ctx.sessions ?? ctx.get('sessions')
      if (sessions === undefined) return next()
      const session = sessions.get(options.sessionId)
      if (!isGrokPreset(session)) return next()
      rewriteCompactionOptions(options)
    } catch (error) {
      // Frozen options, missing services, anything else: never break compaction.
    }
    return next()
  }, { global: true })
}
