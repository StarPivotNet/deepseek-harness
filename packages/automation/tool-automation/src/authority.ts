/**
 * Execution-time authority for Host Automation tools.
 * @module @deepseek-ai/dsh-tool-automation
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
/** Throw one structured tool-policy failure. */
function reject(message: string, code: string): never {
  throw new HarnessError(message, code)
}
/** Locate the open turn enclosing a model tool call. */
function openTurn(agent: Agent): { start: SessionEvent; events: SessionEvent[] } {
  const events = agent.session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const boundary = events[index]
    if (boundary?.type === 'turn/end') {
      reject('automation tools require an open model turn', 'AUTOMATION_TOOL_DRIVER_REQUIRED')
    }
    if (boundary?.type === 'turn/start') {
      return { start: boundary, events: events.slice(index + 1) }
    }
  }
  return reject('automation tools require an open model turn', 'AUTOMATION_TOOL_DRIVER_REQUIRED')
}
/**
 * Resolve the calling live root agent.
 * @param ctx - Context carrying the live agent registry.
 * @param exec - Tool execution metadata supplied by the registry.
 * @returns The authenticated agent and its current turn window.
 */
export function automationToolExecution(ctx: Context, exec: ToolRunContext): {
  agent: Agent
  start: SessionEvent
  events: SessionEvent[]
} {
  const agent = exec.agent
  if (agent === undefined) {
    return reject('automation tools require a calling agent', 'AUTOMATION_TOOL_AGENT_REQUIRED')
  }
  if (ctx.agents.get(agent.id) !== agent || agent.status !== 'running'
        || ctx.agents.currentInitiator() !== agent) {
    return reject('automation tools require the exact live calling agent inside its active driver', 'AUTOMATION_TOOL_DRIVER_REQUIRED')
  }
  return { agent, ...openTurn(agent) }
}
/**
 * Whether this Agent is a runtime root rather than a subagent child.
 *
 * A subagent child records `origin: 'subagent'` in its Session header when it
 * is created, so the durable header alone decides. Ordinary Session forks and
 * resumed Sessions carry no such origin and lead their own trees.
 * @param agent - candidate live Agent.
 * @returns true for a top-level Agent, false for a subagent child.
 */
export function isRuntimeRootAgent(agent: Agent): boolean {
  return agent.session.header.origin !== 'subagent'
}
/**
 * Whether host-attested human input appears in the current root-agent turn.
 * An omitted `Agent.followup()` / `steer()` source resolves to `user`, so
 * Automation fires and other plugins must pass their own source.
 * @param ctx - Context carrying the live agent registry.
 * @param execution - Authenticated turn window.
 */
export function requireDirectHuman(ctx: Context, execution: { agent: Agent; events: SessionEvent[] }): void {
  if (!isRuntimeRootAgent(execution.agent)) {
    reject('automation tools refuse subagent callers', 'AUTOMATION_TOOL_AUTHORITY_REQUIRED')
  }
  const human = execution.events.some(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (!human) {
    reject('automation mutations require a direct human turn; plugin and Automation-sourced turns cannot create or edit rules', 'AUTOMATION_TOOL_AUTHORITY_REQUIRED')
  }
}
