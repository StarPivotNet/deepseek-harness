/**
 * One-scan turn-close gates (stuck, acceptance, critic, ledger, deferral).
 *
 * Serial `agent/turn-stopping`. At most one steer. No model-facing tools.
 * Subsumes think-act-loop (stuck) and ledger-flush (stale ledger).
 * Ledger gate scans this-turn edit/write of cognition.md (not mtime).
 * Publishes no service. Relative path is this directory (preset-local row).
 */

import { scanTurn } from './agi-gates-scan.mjs'

export const name = 'agi-gates'

const PLUGIN = 'dsh-grok-code-agi-gates'

async function loadCreateUserMessage() {
  try {
    const mod = await import('@deepseek-ai/dsh-llm')
    if (mod != null && typeof mod.createUserMessage === 'function') {
      return mod.createUserMessage
    }
  } catch {
    // Host package missing in isolated tests; fall back below.
  }
  return (input) => ({
    role: 'user',
    content: input.content,
    source: input.source,
  })
}

const createUserMessagePromise = loadCreateUserMessage()

export function apply(ctx) {
  ctx.on('agent/turn-stopping', async (payload) => {
    try {
      const turn = payload == null ? undefined : payload.turn
      if (typeof turn !== 'number') return
      const agents = ctx.get('agents')
      let initiator
      try {
        initiator =
          agents == null || typeof agents.requireInitiator !== 'function'
            ? undefined
            : agents.requireInitiator()
      } catch {
        initiator = undefined
      }
      if (initiator == null || typeof initiator.steer !== 'function') return
      const session = initiator.session
      if (session == null) return
      const events = Array.isArray(session.events) ? session.events : []
      const gate = scanTurn(events)
      if (gate == null) return
      const createUserMessage = await createUserMessagePromise
      initiator.steer(
        createUserMessage({
          content: [{ type: 'text', text: gate.text }],
          source: { kind: 'plugin', plugin: PLUGIN, form: 'notice', gate: gate.id },
        }),
      )
    } catch {
      // Never break turn-close.
    }
  })
}
