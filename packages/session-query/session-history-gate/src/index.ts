/**
 * Settings-owned gate over model-facing session-history tools: while closed
 * (the default) the configured tool names are restricted away from every live
 * Agent and a compensating prompt section tells the model to ask the user to
 * enable them; a live `session-history-tools` settings toggle re-exposes them.
 *
 * @module @deepseek-ai/dsh-session-history-gate
 */

import { FiberState } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'session-history-gate'

/** Capability services required by the gate; settings is consumed optionally. */
export const inject = ['tools', 'agents', 'systemPrompt']

/**
 * Default gated tool-name set: the session-history family — the
 * `agent_session_*` tools registered by third-party search plugins plus the
 * core `session_*` query tools. Unregistered names are skipped at runtime.
 */
export const DEFAULT_TOOLS: readonly string[] = [
  'agent_session_list',
  'agent_session_read',
  'agent_session_search',
  'session_search',
  'session_event_search',
  'session_trace',
  'session_event_trace',
  'session_event_read',
]

/** Plugin config: which globally registered tool names the gate hides while closed. */
export interface Config {
  /**
   * Tool names hidden from every Agent while the gate is closed. Names not
   * currently registered globally are skipped; `run_code` is rejected.
   * Defaults to {@link DEFAULT_TOOLS}.
   */
  tools?: string[]
}

/** Schemastery config for Loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  tools: z.array(z.string()).default([...DEFAULT_TOOLS]),
})

/** Settings namespace owning the session-history tools toggle. */
export const SESSION_HISTORY_TOOLS_SETTINGS_NAMESPACE = settingsNamespace('session-history-tools')

/** Resolved user-settings value for the gate toggle. */
export interface SessionHistoryToolsSettings {
  /** Whether session-history tools are visible to agents. */
  enabled: boolean
}

/** Schema served to settings clients for the gate toggle. */
export const SessionHistoryToolsSettingsSchema: z<SessionHistoryToolsSettings> = z.object({
  enabled: z.boolean().default(false),
})

/** Registration name of the compensating prompt section. */
const SECTION_NAME = 'session-history-gate'

/**
 * Model-facing statement served while the gate is closed: the capability is
 * user-owned, the calls will not work, and the enabling route is the user.
 */
const SECTION_TEXT =
  'Session-history tools such as agent_session_search and session_search are disabled by a user setting; '
  + 'calling them will not work. Do not attempt them. When your task genuinely needs recalling prior '
  + 'sessions, ask the user to enable "Session history tools" in Settings.'

/**
 * Validate the configured tool-name set at load: dedupe preserving order,
 * reject the reserved `run_code` transport, and reject an empty result.
 * @param configured - schema-resolved `tools` config value.
 * @returns the deduplicated gated name set.
 */
function resolveTools(configured: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const toolName of configured) {
    if (toolName === RUN_CODE_NAME) {
      throw new TypeError(`session-history-gate: tools must not name the reserved transport "${RUN_CODE_NAME}"`)
    }
    seen.add(toolName)
  }
  const tools = [...seen]
  if (tools.length === 0) {
    throw new TypeError('session-history-gate: tools must name at least one tool after deduplication')
  }
  return tools
}

/** Positional equality over deterministically ordered name lists. */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((toolName, index) => toolName === b[index])
}

/** Register the gate on a Host context. */
export function apply(ctx: Context, config: Config): void {
  const gated = resolveTools(config.tools ?? [...DEFAULT_TOOLS])
  const tools = ctx.tools
  const agents = ctx.agents
  const systemPrompt = ctx.systemPrompt
  // Central slot directly after the session-query tool family it compensates.
  const sectionOrder = systemPrompt.getSectionOrder('SESSION_HISTORY_GATE')

  let enabled = false
  /** Disposer of the active compensating section; undefined only while open. */
  let sectionLift: (() => void) | undefined = systemPrompt.section({
    name: SECTION_NAME,
    order: sectionOrder,
    text: SECTION_TEXT,
  })
  /** Names applied by the most recent closed-state pass; equal sets skip re-application. */
  let appliedDeny: readonly string[] = []
  const restrictions = new WeakMap<Agent, () => void>()
  let reconciling = false

  /** Run one pass while skipping re-entry from the registry notifications the pass itself emits. */
  function reconcile(run: () => void): void {
    if (reconciling) return
    reconciling = true
    try {
      run()
    } finally {
      reconciling = false
    }
  }

  /** Gated names currently registered globally; absent names cannot be restricted. */
  function gatedNames(): string[] {
    return gated.filter(toolName => tools.get(toolName) !== undefined)
  }

  /** Lift one agent's tracked restriction, when present. */
  function liftAgent(agent: Agent): void {
    const lift = restrictions.get(agent)
    if (lift === undefined) return
    restrictions.delete(agent)
    lift()
  }

  /** Converge one agent to the current state: lifted when open or nothing is gateable, otherwise denied. */
  function refreshAgent(agent: Agent): void {
    liftAgent(agent)
    if (enabled) return
    const deny = gatedNames()
    if (deny.length === 0) return
    restrictions.set(agent, agent.ctx.tools.restrict({ deny }))
  }

  /** Dispose the compensating section when one is registered. */
  function disposeSection(): void {
    const lift = sectionLift
    sectionLift = undefined
    if (lift !== undefined) lift()
  }

  /** Flip the gate; sweeping live agents and the compensating section to the new state. */
  function setEnabled(next: boolean): void {
    if (next === enabled) return
    enabled = next
    reconcile(() => {
      for (const agent of agents.list()) refreshAgent(agent)
      if (next) {
        disposeSection()
      } else {
        sectionLift = systemPrompt.section({ name: SECTION_NAME, order: sectionOrder, text: SECTION_TEXT })
      }
    })
  }

  /** Whether this plugin's own fiber is tearing down (provider detach is not). */
  function consumerTearingDown(): boolean {
    const state = ctx.fiber.state
    return state === FiberState.UNLOADING || state === FiberState.DISPOSED
  }

  ctx.on('agent/created', ({ agent }) => {
    reconcile(() => {
      refreshAgent(agent)
    })
  })
  // Registry changes while closed must keep a late-registered gated tool hidden;
  // an unchanged deny set makes the pass a no-op.
  ctx.on('tools/change', () => {
    reconcile(() => {
      const deny = gatedNames()
      if (sameNames(deny, appliedDeny)) return
      appliedDeny = deny
      for (const agent of agents.list()) refreshAgent(agent)
    })
  })
  // Restrictions live on each Agent's own scope, so unloading the gate must
  // lift them explicitly or they would outlive the plugin.
  ctx.effect(() => () => {
    reconcile(() => {
      for (const agent of agents.list()) liftAgent(agent)
      disposeSection()
    })
  }, 'session-history-gate.unload()')
  // Agents and gated tools may predate this load (plugin reload): enter the
  // closed state over the current registry before any settings value arrives.
  reconcile(() => {
    appliedDeny = gatedNames()
    for (const agent of agents.list()) refreshAgent(agent)
  })
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register<{ enabled: boolean }>(
      SESSION_HISTORY_TOOLS_SETTINGS_NAMESPACE,
      SessionHistoryToolsSettingsSchema,
      {},
    )
    setEnabled(scope.get().enabled)
    scope.watch((next) => {
      setEnabled(next.enabled)
    })
    // Losing the provider leaves this plugin running; without a resolvable
    // toggle the gate fails closed. The plugin's own unload is handled above.
    settingsCtx.effect(() => () => {
      if (consumerTearingDown()) return
      setEnabled(false)
    }, 'session-history-gate.settings-detach()')
  })
}
