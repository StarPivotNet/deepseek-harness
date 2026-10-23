import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as gate from '../src/index.ts'

/** In-memory settings provider: the smallest real subclass of the Service Definition. */
class MemorySettings extends SettingsProvider {
  private doc: Record<string, unknown>

  constructor(ctx: Context, doc: Record<string, unknown> = {}) {
    super(ctx)
    this.doc = structuredClone(doc)
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected async persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
  }
}

/** The plugin in the object shape the Loader unwraps function-plugin exports into. */
const plugin = {
  name: gate.name,
  inject: gate.inject,
  Config: gate.Config,
  apply: gate.apply,
}

/** Core services the gate composes over, without the gate itself. */
async function base(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  return ctx
}

interface Mounted {
  ctx: Context
  gateFiber: Fiber
  settingsFiber: Fiber | undefined
}

async function mount(options: {
  gateConfig?: gate.Config
  settingsDoc?: Record<string, unknown>
  withSettings?: boolean
} = {}): Promise<Mounted> {
  const ctx = await base()
  const settingsFiber = options.withSettings === false
    ? undefined
    : ctx.plugin(MemorySettings, options.settingsDoc ?? {})
  const gateFiber = ctx.plugin(plugin, options.gateConfig)
  await Promise.all([gateFiber, settingsFiber].filter(fiber => fiber !== undefined))
  return { ctx, gateFiber, settingsFiber }
}

/** Mint a registered Agent whose `ctx` is a real scope keyed by the agent itself. */
async function scopedAgent(ctx: Context, id: string): Promise<{ agent: Agent; scope: Scope }> {
  const session = Session.create(SessionId(id))
  const agent = { id: session.id, session, status: 'idle' } as unknown as Agent
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => {
    scope = createScope(inner, agent)
  }, { inject: ['tools', 'systemPrompt'] }))
  Object.defineProperty(agent, 'ctx', { value: scope.ctx })
  ctx.agents.register(agent)
  return { agent, scope }
}

function sessionTool(name: string): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    },
    execute: () => Promise.resolve(`ran:${name}`),
  }
}

function visibleNames(ctx: Context, agent: Agent): string[] {
  return ctx.tools.schemas(agent).map(schema => schema.name).sort()
}

function call(ctx: Context, name: string, agent?: Agent): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    calls: [{ type: 'tool-call', id: ToolCallId('c1'), name, arguments: '{}' }],
    signal: new AbortController().signal,
    ...agent === undefined ? {} : { agent },
  }).then((batch) => {
    const result = batch.results[0]?.result
    if (result === undefined) throw new Error('tool batch returned no result')
    return result
  })
}

function hasSection(ctx: Context): boolean {
  return ctx.systemPrompt.listSections().some(section => section.name === 'session-history-gate')
}

/** Drain the microtask chains that serialize settings watcher invocations. */
const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('session-history-gate config validation', () => {
  it('rejects the reserved run_code transport at load', async () => {
    const ctx = await base()
    await expect(ctx.plugin(plugin, { tools: ['run_code'] })).rejects.toThrow(/reserved transport/)
    await ctx.fiber.dispose()
  })

  it('rejects an empty tools list at load', async () => {
    const ctx = await base()
    await expect(ctx.plugin(plugin, { tools: [] })).rejects.toThrow(/at least one tool/)
    await ctx.fiber.dispose()
  })

  it('falls back to DEFAULT_TOOLS when applied without schema validation', async () => {
    const ctx = await base()
    ctx.tools.register(sessionTool('agent_session_list'))
    const { agent } = await scopedAgent(ctx, 'defaults')
    expect(visibleNames(ctx, agent)).toEqual(['agent_session_list'])

    gate.apply(ctx, {})
    expect(visibleNames(ctx, agent)).toEqual([])
    await ctx.fiber.dispose()
  })
})

describe('session-history-gate closed by default', () => {
  it('hides a registered global tool from the agent view and denies execution as UNKNOWN_TOOL', async () => {
    const { ctx } = await mount()
    const disposeTool = ctx.tools.register(sessionTool('agent_session_search'))
    ctx.tools.register(sessionTool('read'))
    const { agent } = await scopedAgent(ctx, 'a1')

    expect(visibleNames(ctx, agent)).toEqual(['read'])
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('agent_session_search')

    const denied = await call(ctx, 'agent_session_search', agent)
    expect(denied.isError).toBe(true)
    expect(denied.error?.info?.code).toBe('UNKNOWN_TOOL')
    const allowed = await call(ctx, 'read', agent)
    expect(allowed.isError).toBe(false)
    disposeTool()
    await ctx.fiber.dispose()
  })

  it('registers the compensating section directly after the session-query family while closed', async () => {
    const { ctx } = await mount()
    expect(hasSection(ctx)).toBe(true)
    const section = ctx.systemPrompt.listSections().find(entry => entry.name === 'session-history-gate')
    expect(section?.order).toBe(ctx.systemPrompt.getSectionOrder('SESSION_HISTORY_GATE'))
    expect(section?.text).toContain('disabled by a user setting')
    await ctx.fiber.dispose()
  })

  it('skips configured names that are not registered without throwing', async () => {
    const { ctx } = await mount({ gateConfig: { tools: ['never_registered_anywhere', 'agent_session_read'] } })
    ctx.tools.register(sessionTool('agent_session_read'))
    ctx.tools.register(sessionTool('read'))
    const { agent } = await scopedAgent(ctx, 'a2')

    expect(visibleNames(ctx, agent)).toEqual(['read'])
    await ctx.fiber.dispose()
  })

  it('deduplicates the configured names', async () => {
    const { ctx } = await mount({ gateConfig: { tools: ['agent_session_search', 'agent_session_search'] } })
    ctx.tools.register(sessionTool('agent_session_search'))
    const { agent } = await scopedAgent(ctx, 'a3')

    expect(visibleNames(ctx, agent)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('restricts agents that predate the gate load', async () => {
    const ctx = await base()
    ctx.tools.register(sessionTool('session_search'))
    const { agent } = await scopedAgent(ctx, 'early')
    expect(visibleNames(ctx, agent)).toEqual(['session_search'])

    await ctx.plugin(plugin)
    expect(visibleNames(ctx, agent)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('stays closed without a settings provider', async () => {
    const { ctx } = await mount({ withSettings: false })
    ctx.tools.register(sessionTool('session_search'))
    const { agent } = await scopedAgent(ctx, 'a4')

    expect(visibleNames(ctx, agent)).toEqual([])
    expect(hasSection(ctx)).toBe(true)
    await ctx.fiber.dispose()
  })
})

describe('session-history-gate open', () => {
  it('leaves the tool and prompt intact when the stored toggle is on', async () => {
    const { ctx } = await mount({ settingsDoc: { 'session-history-tools': { enabled: true } } })
    ctx.tools.register(sessionTool('agent_session_search'))
    const { agent } = await scopedAgent(ctx, 'a5')

    expect(visibleNames(ctx, agent)).toEqual(['agent_session_search'])
    const result = await call(ctx, 'agent_session_search', agent)
    expect(result.isError).toBe(false)
    expect(hasSection(ctx)).toBe(false)
    await ctx.fiber.dispose()
  })

  it('registers the settings namespace with a live-applied boolean defaulting off', async () => {
    const { ctx } = await mount()
    const descriptor = ctx.settings.describe().find(entry => entry.ns === 'session-history-tools')
    expect(descriptor).toMatchObject({ applies: 'live', value: { enabled: false } })
    await ctx.fiber.dispose()
  })
})

describe('session-history-gate live toggle', () => {
  it('re-applies to an already-created agent in both directions', async () => {
    const { ctx } = await mount()
    ctx.tools.register(sessionTool('agent_session_search'))
    const { agent } = await scopedAgent(ctx, 'a6')
    expect(visibleNames(ctx, agent)).toEqual([])

    await ctx.settings.update('session-history-tools', { enabled: true })
    await settle()
    expect(visibleNames(ctx, agent)).toEqual(['agent_session_search'])
    expect(hasSection(ctx)).toBe(false)

    // A gated tool registered while open stays visible.
    const disposeLate = ctx.tools.register(sessionTool('agent_session_read'))
    expect(visibleNames(ctx, agent)).toEqual(['agent_session_read', 'agent_session_search'])

    await ctx.settings.update('session-history-tools', { enabled: false })
    await settle()
    expect(visibleNames(ctx, agent)).toEqual([])
    expect(hasSection(ctx)).toBe(true)
    const denied = await call(ctx, 'agent_session_search', agent)
    expect(denied.error?.info?.code).toBe('UNKNOWN_TOOL')
    disposeLate()
    await ctx.fiber.dispose()
  })
})

describe('session-history-gate registry changes while closed', () => {
  it('hides a gated tool that registers after the agent exists', async () => {
    const { ctx } = await mount()
    const { agent } = await scopedAgent(ctx, 'a7')
    expect(visibleNames(ctx, agent)).toEqual([])

    const disposeGated = ctx.tools.register(sessionTool('agent_session_search'))
    expect(visibleNames(ctx, agent)).toEqual([])

    // An unrelated registration leaves the applied deny set unchanged.
    ctx.tools.register(sessionTool('unrelated'))
    expect(visibleNames(ctx, agent)).toEqual(['unrelated'])
    disposeGated()
    await ctx.fiber.dispose()
  })
})

describe('session-history-gate lifecycle', () => {
  it('fails closed when the settings provider detaches while open', async () => {
    const { ctx, settingsFiber } = await mount({
      settingsDoc: { 'session-history-tools': { enabled: true } },
    })
    ctx.tools.register(sessionTool('agent_session_search'))
    const { agent } = await scopedAgent(ctx, 'a8')
    expect(visibleNames(ctx, agent)).toEqual(['agent_session_search'])

    await settingsFiber!.dispose()
    await settle()

    expect(visibleNames(ctx, agent)).toEqual([])
    expect(hasSection(ctx)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('lifts restrictions and drops the section when the gate unloads', async () => {
    const { ctx, gateFiber } = await mount()
    ctx.tools.register(sessionTool('agent_session_search'))
    const { agent } = await scopedAgent(ctx, 'a9')
    expect(visibleNames(ctx, agent)).toEqual([])

    await gateFiber.dispose()
    expect(visibleNames(ctx, agent)).toEqual(['agent_session_search'])
    expect(hasSection(ctx)).toBe(false)
    await ctx.fiber.dispose()
  })

  it('unloads cleanly while open, where no restriction or section exists', async () => {
    const { ctx, gateFiber } = await mount({
      settingsDoc: { 'session-history-tools': { enabled: true } },
    })
    ctx.tools.register(sessionTool('agent_session_search'))
    const { agent } = await scopedAgent(ctx, 'a10')
    expect(visibleNames(ctx, agent)).toEqual(['agent_session_search'])

    await gateFiber.dispose()
    expect(visibleNames(ctx, agent)).toEqual(['agent_session_search'])
    expect(hasSection(ctx)).toBe(false)
    await ctx.fiber.dispose()
  })
})

describe('session-history-gate export shape', () => {
  it('keeps name/inject/Config/apply through Loader export unwrapping', () => {
    expect('default' in gate).toBe(false)
    expect(gate.name).toBe('session-history-gate')
    expect(gate.inject).toEqual(['tools', 'agents', 'systemPrompt'])

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(gate) as Record<string, unknown>
    expect(unwrapped).toBe(gate)
    expect(unwrapped.name).toBe('session-history-gate')
  })
})
