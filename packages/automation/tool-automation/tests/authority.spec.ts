import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { automationToolExecution, requireDirectHuman } from '../src/authority.ts'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

function agentStub(options: {
  status?: 'idle' | 'running'
  events?: Array<{ type: string; data?: unknown }>
  root?: boolean
}) {
  const id = SessionId('session-root')
  const agent = {
    id,
    status: options.status ?? 'running',
    session: {
      id,
      header: { cwd: '/work/project' },
      events: options.events ?? [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { source: { kind: 'user' } } },
      ],
    },
    ctx: new Context(),
  }
  return { agent, root: options.root ?? true }
}

describe('automation tool authority', () => {
  it('accepts a live root agent with a human user message', () => {
    const { agent } = agentStub({})
    const ctx = new Context()
    ctx.provide('agents', {
      get: () => agent,
      currentInitiator: () => agent,
      roots: () => [agent],
    })
    const execution = automationToolExecution(ctx, { agent } as unknown as ToolRunContext)
    expect(() => { requireDirectHuman(ctx, execution) }).not.toThrow()
  })

  it('rejects a plugin-sourced Automation fire turn', () => {
    const { agent } = agentStub({
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'user/message', data: { source: { kind: 'automation', ruleId: 'rule' } } },
      ],
    })
    const ctx = new Context()
    ctx.provide('agents', {
      get: () => agent,
      currentInitiator: () => agent,
      roots: () => [agent],
    })
    const execution = automationToolExecution(ctx, { agent } as unknown as ToolRunContext)
    expect(() => { requireDirectHuman(ctx, execution) }).toThrow(HarnessError)
  })

  it('rejects a subagent caller', () => {
    const { agent } = agentStub({})
    const ctx = new Context()
    ctx.provide('agents', {
      get: () => agent,
      currentInitiator: () => agent,
      roots: () => [],
    })
    const execution = automationToolExecution(ctx, { agent } as unknown as ToolRunContext)
    expect(() => { requireDirectHuman(ctx, execution) }).toThrow(/subagent/)
  })
})
