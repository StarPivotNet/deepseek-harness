import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { describe, expect, it, vi } from 'vitest'
import { SessionUsageController } from '../src/usage.ts'
import { EMPTY_SESSION_USAGE } from '@deepseek-ai/dsh-session-stats'

function observation(sessionId: SessionId, usage = EMPTY_SESSION_USAGE): SessionObservation {
  const events = Object.freeze([])
  const lease = (): SessionObservation => ({
    source: 'live',
    header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, isSeeded: false, cwd: '/project' },
    events,
    inheritedEventCount: SessionLogOffset(0),
    cursor: -1,
    projections: { asOfSeq: -1, values: { sessionUsage: usage } },
    retain: lease,
    [Symbol.dispose]: () => {},
  })
  return lease()
}

async function context(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  return ctx
}

describe('SessionUsageController', () => {
  it('rejects an invalid IANA zone before listing Sessions', async () => {
    const ctx = await context()
    const listSessions = vi.fn()
    ctx.provide('sessionQuery', { listSessions, observeSession: vi.fn() } as never)
    const controller = new SessionUsageController(ctx)
    await expect(controller.overview({ timeZone: 'Not/AZone' }, new AbortController().signal)).rejects.toMatchObject({ code: 'session/invalid-time-zone' })
    expect(listSessions).not.toHaveBeenCalled()
  })

  it('sums projected usage without activating Agents', async () => {
    const ctx = await context()
    const first = SessionId('one')
    const second = SessionId('two')
    const observeSession = vi.fn((sessionId: SessionId) => Promise.resolve(observation(sessionId, {
      ...EMPTY_SESSION_USAGE,
      tokens: sessionId === first ? 10 : 5,
      peakTokens: sessionId === first ? 10 : 7,
      durationMs: sessionId === first ? 1000 : 200,
      peakDurationMs: sessionId === first ? 1000 : 200,
      firstActivityAt: Date.parse('2026-03-01T00:00:00.000Z'),
      lastActivityAt: Date.parse('2026-03-01T00:00:00.000Z'),
      days: [{ day: '2026-03-01', tokens: sessionId === first ? 10 : 5, durationMs: sessionId === first ? 1000 : 200, models: { a: sessionId === first ? 10 : 5 } }],
      models: [{ model: 'a', tokens: sessionId === first ? 10 : 5 }],
    })))
    ctx.provide('sessionQuery', {
      listSessions: () => Promise.resolve([{ header: { id: first } }, { header: { id: second } }]),
      observeSession,
    } as never)
    const resume = vi.spyOn(ctx.agents, 'resume')
    const controller = new SessionUsageController(ctx)
    const value = await controller.overview({ timeZone: 'UTC' }, new AbortController().signal)
    expect(value.tokens).toBe(15)
    expect(value.peakTokens).toBe(10)
    expect(value.durationMs).toBe(1200)
    expect(value.models).toEqual([{ model: 'a', tokens: 15 }])
    expect(resume).not.toHaveBeenCalled()
    expect(observeSession).toHaveBeenCalledTimes(2)
  })

  it('treats a missing Session as empty usage', async () => {
    const ctx = await context()
    const sessionId = SessionId('gone')
    ctx.provide('sessionQuery', {
      listSessions: () => Promise.resolve([{ header: { id: sessionId } }]),
      observeSession: () => Promise.reject(new SessionQueryError('missing', 'SESSION_QUERY_SESSION_NOT_FOUND')),
    } as never)
    const controller = new SessionUsageController(ctx)
    await expect(controller.overview({ timeZone: 'UTC' }, new AbortController().signal)).resolves.toMatchObject({ tokens: 0, days: [], models: [] })
  })

  it('treats an unreadable Session as empty usage and still sums the rest', async () => {
    const ctx = await context()
    const broken = SessionId('broken')
    const ok = SessionId('ok')
    ctx.provide('sessionQuery', {
      listSessions: () => Promise.resolve([{ header: { id: broken } }, { header: { id: ok } }]),
      observeSession: (sessionId: SessionId) => sessionId === broken
        ? Promise.reject(new Error('disk'))
        : Promise.resolve(observation(sessionId, {
          ...EMPTY_SESSION_USAGE,
          tokens: 9,
          peakTokens: 9,
          durationMs: 100,
          peakDurationMs: 100,
          firstActivityAt: Date.parse('2026-03-01T00:00:00.000Z'),
          lastActivityAt: Date.parse('2026-03-01T00:00:00.000Z'),
          days: [{ day: '2026-03-01', tokens: 9, durationMs: 100, models: { a: 9 } }],
          models: [{ model: 'a', tokens: 9 }],
        })),
    } as never)
    const controller = new SessionUsageController(ctx)
    await expect(controller.overview({ timeZone: 'UTC' }, new AbortController().signal)).resolves.toMatchObject({ tokens: 9 })
  })

  it('propagates abort while inspecting a Session', async () => {
    const ctx = await context()
    const sessionId = SessionId('live')
    const abort = new AbortController()
    ctx.provide('sessionQuery', {
      listSessions: () => Promise.resolve([{ header: { id: sessionId } }]),
      observeSession: () => {
        abort.abort()
        return Promise.reject(new Error('disk'))
      },
    } as never)
    const controller = new SessionUsageController(ctx)
    await expect(controller.overview({ timeZone: 'UTC' }, abort.signal)).rejects.toThrow()
  })

  it('uses empty usage when a Session observation has no sessionUsage view', async () => {
    const ctx = await context()
    const sessionId = SessionId('bare')
    const events = Object.freeze([])
    ctx.provide('sessionQuery', {
      listSessions: () => Promise.resolve([{ header: { id: sessionId } }]),
      observeSession: () => Promise.resolve({
        source: 'live',
        header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, isSeeded: false, cwd: '/project' },
        events,
        inheritedEventCount: SessionLogOffset(0),
        cursor: -1,
        retain: () => { throw new Error('unused') },
        [Symbol.dispose]: () => {},
      }),
    } as never)
    const controller = new SessionUsageController(ctx)
    await expect(controller.overview({ timeZone: 'UTC' }, new AbortController().signal)).resolves.toMatchObject({ tokens: 0, days: [], models: [] })
  })
})
