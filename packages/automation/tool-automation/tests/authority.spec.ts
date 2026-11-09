import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { automationToolExecution, requireDirectHuman } from '../src/authority.ts'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

function agentStub(options: {
  status?: 'idle' | 'running'
  events?: Array<{ type: string; data?: unknown }>
  origin?: 'subagent'
}) {
  const id = SessionId('session-root')
  const events = options.events ?? [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { source: { kind: 'user' } } },
  ]
  const agent = {
    id,
    status: options.status ?? 'running',
    session: {
      id,
      header: { cwd: '/work/project', ...options.origin === undefined ? {} : { origin: options.origin } },
      events,
      snapshotEvents: () => events,
    },
    ctx: new Context(),
  }
  return { agent }
}

describe('automation tool authority', () => {
  it('accepts a live root agent with a human user message', () => {
    const { agent } = agentStub({})
    const ctx = new Context()
    ctx.provide('agents', {
      get: () => agent,
      currentInitiator: () => agent,
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
    })
    const execution = automationToolExecution(ctx, { agent } as unknown as ToolRunContext)
    expect(() => { requireDirectHuman(ctx, execution) }).toThrow(HarnessError)
  })

  it('rejects a subagent caller', () => {
    const { agent } = agentStub({ origin: 'subagent' })
    const ctx = new Context()
    ctx.provide('agents', {
      get: () => agent,
      currentInitiator: () => agent,
    })
    const execution = automationToolExecution(ctx, { agent } as unknown as ToolRunContext)
    expect(() => { requireDirectHuman(ctx, execution) }).toThrow(/subagent/)
  })
})
