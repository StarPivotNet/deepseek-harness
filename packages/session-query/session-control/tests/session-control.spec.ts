import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SessionControl, {
  DEFAULT_SEARCH_LIMIT,
  SessionControlError,
  type SessionControlErrorCode,
} from '@deepseek-ai/dsh-session-control'

class TestSessionQueryEngine extends SessionQueryEngine {
  override searchSessions(
    ..._args: Parameters<SessionQueryEngine['searchSessions']>
  ): ReturnType<SessionQueryEngine['searchSessions']> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(
    request: Parameters<SessionQueryEngine['searchEvents']>[0],
  ): ReturnType<SessionQueryEngine['searchEvents']> {
    return this.readSurface(request.sessionId).then(surface => ({
      session: surface.session,
      items: [],
    }))
  }
}

async function harness(config?: { searchLimit?: number }): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TestSessionQueryEngine)
  await ctx.plugin(SessionControl, config ?? {})
  return ctx
}

function createNamed(
  ctx: Context,
  id: string,
  title: string,
  extra: {
    cwd?: string
    origin?: 'subagent' | 'automation'
    parentSession?: SessionId
    createdAt?: number
    agentPreset?: string
  } = {},
): Session {
  const session = ctx.sessions.create(SessionId(id), { meta: extra })
  session.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } })
  return session
}

function stubAgent(session: Session, status: 'idle' | 'running' = 'idle'): Agent {
  return {
    id: session.id,
    session,
    status,
    cancel: vi.fn(),
    followup: vi.fn(),
    steer: vi.fn(),
  } as unknown as Agent
}

function expectCode(code: SessionControlErrorCode): Error {
  return expect.objectContaining({ code, name: 'SessionControlError' }) as Error
}

describe('SessionControl', () => {
  it('rejects a non-positive searchLimit at load', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(TestSessionQueryEngine)
    await expect(ctx.plugin(SessionControl, { searchLimit: 0 })).rejects.toEqual(
      expectCode('SESSION_CONTROL_INVALID_CONFIG'),
    )
  })

  it('lists every logical session with live driver status', async () => {
    const ctx = await harness()
    const live = createNamed(ctx, 'live', 'Live work', { cwd: '/proj' })
    createNamed(ctx, 'cold', 'Cold archive', {
      cwd: '/other',
      origin: 'automation',
      parentSession: SessionId('live'),
    })
    ctx.agents.register(stubAgent(live, 'running'))

    const rows = await ctx.sessionControl.search()
    const byId = Object.fromEntries(rows.map(row => [row.sessionId, row]))

    expect(rows).toHaveLength(2)
    expect(byId['live']).toMatchObject({
      title: 'Live work',
      activity: 'running',
      cwd: '/proj',
      live: true,
      persisted: false,
      archived: false,
    })
    expect(byId['cold']).toMatchObject({
      title: 'Cold archive',
      activity: 'ready',
      origin: 'automation',
      parentSessionId: SessionId('live'),
      live: true,
      archived: false,
    })
    const idle = createNamed(ctx, 'idle', 'Idle work')
    ctx.agents.register(stubAgent(idle, 'idle'))
    await expect(ctx.sessionControl.get(idle.id)).resolves.toMatchObject({ activity: 'idle' })
    await ctx.fiber.dispose()
  })

  it('filters by id, cwd, and title and honors the result cap', async () => {
    const ctx = await harness({ searchLimit: 1 })
    createNamed(ctx, 'alpha', 'Design notes', { cwd: '/design', agentPreset: 'web' })
    createNamed(ctx, 'beta', 'Build log', { cwd: '/build' })

    await expect(ctx.sessionControl.search({ query: 'design' })).resolves.toEqual([
      expect.objectContaining({ sessionId: SessionId('alpha'), title: 'Design notes' }),
    ])
    await expect(ctx.sessionControl.search({ query: 'BETA' })).resolves.toEqual([
      expect.objectContaining({ sessionId: SessionId('beta') }),
    ])
    await expect(ctx.sessionControl.search()).resolves.toHaveLength(1)
    await expect(ctx.sessionControl.search({ limit: 0 })).rejects.toEqual(
      expectCode('SESSION_CONTROL_INVALID_REQUEST'),
    )
    await ctx.fiber.dispose()
  })

  it('stops reading older sessions once a query reaches its result cap', async () => {
    const ctx = await harness()
    try {
      createNamed(ctx, 'newest', 'Matching title', { createdAt: 2 })
      createNamed(ctx, 'oldest', 'Matching title', { createdAt: 1 })
      const readTitles = ctx.sessionQuery.readTitleSnapshots.bind(ctx.sessionQuery)
      const reads = vi.spyOn(ctx.sessionQuery, 'readTitleSnapshots').mockImplementation((ids, signal) => {
        if (ids.includes(SessionId('oldest'))) throw new Error('unnecessary older log read')
        return readTitles(ids, signal)
      })

      await expect(ctx.sessionControl.search({ query: 'MATCHING', limit: 1 })).resolves.toEqual([
        expect.objectContaining({ sessionId: SessionId('newest'), title: 'Matching title' }),
      ])
      expect(reads).toHaveBeenCalledTimes(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('continues title matching across batches after archive filtering in newest-first order', async () => {
    const ctx = await harness()
    try {
      createNamed(ctx, 'archived', 'Needle archived', { createdAt: 6 })
      createNamed(ctx, 'title-match', 'Needle title', { createdAt: 5 })
      createNamed(ctx, 'unmatched', 'Other title', { createdAt: 4 })
      createNamed(ctx, 'cwd-match', 'Folder title', { createdAt: 3, cwd: '/NEEDLE' })
      createNamed(ctx, 'needle-older', 'Older title', { createdAt: 2 })
      ctx.provide('workspaceRegistry', { archivedSessionIds: [SessionId('archived')] })
      const reads = vi.spyOn(ctx.sessionQuery, 'readTitleSnapshots')

      await expect(ctx.sessionControl.search({ query: 'needle', limit: 2, archive: 'exclude' })).resolves.toEqual([
        expect.objectContaining({ sessionId: SessionId('title-match'), title: 'Needle title' }),
        expect.objectContaining({ sessionId: SessionId('cwd-match'), title: 'Folder title' }),
      ])
      expect(reads.mock.calls.map(([ids]) => ids)).toEqual([
        [SessionId('title-match'), SessionId('unmatched')],
        [SessionId('cwd-match')],
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('cancels a later title batch without reading remaining sessions', async () => {
    const ctx = await harness()
    try {
      createNamed(ctx, 'newest', 'Other title', { createdAt: 3 })
      createNamed(ctx, 'middle', 'Matching title', { createdAt: 2 })
      createNamed(ctx, 'oldest', 'Matching title', { createdAt: 1 })
      const controller = new AbortController()
      const readTitles = ctx.sessionQuery.readTitleSnapshots.bind(ctx.sessionQuery)
      const reads = vi.spyOn(ctx.sessionQuery, 'readTitleSnapshots').mockImplementation((ids, signal) => {
        if (ids.includes(SessionId('middle'))) {
          controller.abort('stop')
          return Promise.resolve([])
        }
        return readTitles(ids, signal)
      })

      await expect(ctx.sessionControl.search({ query: 'matching', limit: 1 }, controller.signal))
        .rejects.toEqual(expectCode('SESSION_CONTROL_CANCELLED'))
      expect(reads.mock.calls.map(([ids, signal]) => ({ ids, signal }))).toEqual([
        { ids: [SessionId('newest')], signal: controller.signal },
        { ids: [SessionId('middle')], signal: controller.signal },
      ])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('falls back to the session id when the title observation fails', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('untitled'))
    const spy = vi.spyOn(ctx.sessionQuery, 'readTitleSnapshots').mockResolvedValue([
      { sessionId: session.id, status: 'rejected', reason: new Error('boom') },
    ])

    await expect(ctx.sessionControl.get(session.id)).resolves.toMatchObject({
      sessionId: session.id,
      title: session.id,
      activity: 'ready',
      archived: false,
    })
    await expect(ctx.sessionControl.search({ query: 'untitled' })).resolves.toEqual([
      expect.objectContaining({ sessionId: session.id, title: session.id }),
    ])
    spy.mockRestore()
    vi.spyOn(ctx.sessionQuery, 'readTitleSnapshots').mockResolvedValue([
      {
        sessionId: session.id,
        status: 'fulfilled',
        value: { session: session.header },
      },
    ])
    await expect(ctx.sessionControl.get(session.id)).resolves.toMatchObject({
      sessionId: session.id,
      title: session.id,
    })
    await expect(ctx.sessionControl.search({ query: 'untitled' })).resolves.toEqual([
      expect.objectContaining({ sessionId: session.id, title: session.id }),
    ])
    await ctx.fiber.dispose()
  })

  it('rejects an unknown identity on get and stop', async () => {
    const ctx = await harness()
    await expect(ctx.sessionControl.get(SessionId('missing'))).rejects.toEqual(
      expectCode('SESSION_CONTROL_SESSION_NOT_FOUND'),
    )
    await expect(ctx.sessionControl.stop(SessionId('missing'))).rejects.toEqual(
      expectCode('SESSION_CONTROL_SESSION_NOT_FOUND'),
    )
    await ctx.fiber.dispose()
  })

  it('cancels a live Agent and treats a session-only identity as a no-op', async () => {
    const ctx = await harness()
    const live = createNamed(ctx, 'live', 'Live')
    const attached = createNamed(ctx, 'attached', 'Attached')
    const agent = stubAgent(live, 'running')
    ctx.agents.register(agent)

    await expect(ctx.sessionControl.stop(live.id)).resolves.toEqual({ accepted: true, attached: true })
    expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    await expect(ctx.sessionControl.stop(attached.id)).resolves.toEqual({ accepted: true, attached: false })
    await ctx.fiber.dispose()
  })

  it('delivers queue and steer messages to a live Agent', async () => {
    const ctx = await harness()
    const session = createNamed(ctx, 'live', 'Live')
    const agent = stubAgent(session)
    ctx.agents.register(agent)

    const queued = await ctx.sessionControl.send({ sessionId: session.id, message: 'hello' })
    const steered = await ctx.sessionControl.send({ sessionId: session.id, message: 'now', mode: 'steer' })

    expect(queued.messageId).toEqual(expect.any(String))
    expect(agent.followup).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'plugin', plugin: 'session-control' },
    }))
    expect(agent.steer).toHaveBeenCalledWith(expect.objectContaining({
      content: [{ type: 'text', text: 'now' }],
    }))
    expect(steered.messageId).not.toBe(queued.messageId)
    await ctx.fiber.dispose()
  })

  it('refuses to send to a storage-only or session-only identity', async () => {
    const ctx = await harness()
    const attached = createNamed(ctx, 'attached', 'Attached')
    await expect(ctx.sessionControl.send({ sessionId: attached.id, message: 'hi' })).rejects.toEqual(
      expectCode('SESSION_CONTROL_NOT_ATTACHED'),
    )
    await expect(ctx.sessionControl.send({ sessionId: SessionId('cold'), message: 'hi' })).rejects.toEqual(
      expectCode('SESSION_CONTROL_SESSION_NOT_FOUND'),
    )
    await expect(ctx.sessionControl.send({ sessionId: attached.id, message: '' })).rejects.toEqual(
      expectCode('SESSION_CONTROL_INVALID_REQUEST'),
    )
    await ctx.fiber.dispose()
  })

  it('maps a throwing followup to SESSION_CONTROL_DELIVERY_FAILED', async () => {
    const ctx = await harness()
    const session = createNamed(ctx, 'live', 'Live')
    const agent = stubAgent(session)
    agent.followup = vi.fn(() => {
      throw new Error('inbox closed')
    })
    ctx.agents.register(agent)

    await expect(ctx.sessionControl.send({ sessionId: session.id, message: 'hi' })).rejects.toEqual(
      expectCode('SESSION_CONTROL_DELIVERY_FAILED'),
    )
    agent.followup = vi.fn(() => {
      throw 'plain-throw'
    })
    await expect(ctx.sessionControl.send({ sessionId: session.id, message: 'hi' })).rejects.toMatchObject({
      code: 'SESSION_CONTROL_DELIVERY_FAILED',
      message: expect.stringContaining('plain-throw'),
    })
    await ctx.fiber.dispose()
  })

  it('reports SESSION_CONTROL_RESUME_REQUIRED for a persisted storage-only identity', async () => {
    const ctx = await harness()
    const sessionId = SessionId('persisted-cold')
    vi.spyOn(ctx.sessionQuery, 'filterSessions').mockResolvedValue([
      {
        header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, isSeeded: false },
        live: false,
        persisted: true,
      },
    ])

    await expect(ctx.sessionControl.send({ sessionId, message: 'hi' })).rejects.toEqual(
      expectCode('SESSION_CONTROL_RESUME_REQUIRED'),
    )
    await expect(ctx.sessionControl.stop(sessionId)).resolves.toEqual({ accepted: true, attached: false })
    await ctx.fiber.dispose()
  })

  it('stamps archived membership from an optional workspace registry', async () => {
    const ctx = await harness()
    createNamed(ctx, 'kept', 'Kept', { createdAt: 3 })
    createNamed(ctx, 'gone', 'Gone', { createdAt: 2 })
    ctx.provide('workspaceRegistry', { archivedSessionIds: [SessionId('gone')] })

    const all = await ctx.sessionControl.search()
    expect(all.map(row => [row.sessionId, row.archived])).toEqual([
      ['kept', false],
      ['gone', true],
    ])
    await expect(ctx.sessionControl.search({ archive: 'all' })).resolves.toEqual(all)
    await expect(ctx.sessionControl.search({ archive: 'only' })).resolves.toEqual([
      expect.objectContaining({ sessionId: SessionId('gone'), archived: true, title: 'Gone' }),
    ])
    await expect(ctx.sessionControl.search({ archive: 'exclude' })).resolves.toEqual([
      expect.objectContaining({ sessionId: SessionId('kept'), archived: false }),
    ])
    await expect(ctx.sessionControl.get(SessionId('gone'))).resolves.toMatchObject({
      sessionId: SessionId('gone'),
      archived: true,
    })
    await ctx.fiber.dispose()
  })

  it('applies limit after the archive filter', async () => {
    const ctx = await harness()
    createNamed(ctx, 'newest', 'Newest', { createdAt: 3 })
    createNamed(ctx, 'middle', 'Middle', { createdAt: 2 })
    createNamed(ctx, 'oldest', 'Oldest', { createdAt: 1 })
    ctx.provide('workspaceRegistry', { archivedSessionIds: [SessionId('oldest')] })

    await expect(ctx.sessionControl.search({ limit: 1 })).resolves.toEqual([
      expect.objectContaining({ sessionId: SessionId('newest'), archived: false }),
    ])
    await expect(ctx.sessionControl.search({ archive: 'only', limit: 1 })).resolves.toEqual([
      expect.objectContaining({ sessionId: SessionId('oldest'), archived: true }),
    ])
    await ctx.fiber.dispose()
  })

  it('treats a missing registry as unarchived and an empty only-filter', async () => {
    const ctx = await harness()
    createNamed(ctx, 'live', 'Live')
    await expect(ctx.sessionControl.search({ archive: 'only' })).resolves.toEqual([])
    await expect(ctx.sessionControl.search({ archive: 'exclude' })).resolves.toEqual([
      expect.objectContaining({ sessionId: SessionId('live'), archived: false }),
    ])
    await ctx.fiber.dispose()
  })

  it('rejects an invalid archive filter', async () => {
    const ctx = await harness()
    await expect(ctx.sessionControl.search({ archive: 'hidden' as 'all' })).rejects.toEqual(
      expectCode('SESSION_CONTROL_INVALID_REQUEST'),
    )
    await ctx.fiber.dispose()
  })

  it('completes search under a live abort signal and surfaces a listing fault', async () => {
    const ctx = await harness()
    createNamed(ctx, 'live', 'Live')
    await expect(ctx.sessionControl.search({}, new AbortController().signal)).resolves.toEqual([
      expect.objectContaining({ sessionId: SessionId('live') }),
    ])
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockRejectedValue(new Error('backend'))
    await expect(ctx.sessionControl.search({}, new AbortController().signal)).rejects.toThrow('backend')
    await ctx.fiber.dispose()
  })

  it('rejects a cancelled search before listing', async () => {
    const ctx = await harness()
    const signal = AbortSignal.abort('stop')
    await expect(ctx.sessionControl.search({}, signal)).rejects.toEqual(
      expectCode('SESSION_CONTROL_CANCELLED'),
    )
    await ctx.fiber.dispose()
  })

  it('rejects when cancellation wins a pending listing', async () => {
    const ctx = await harness()
    createNamed(ctx, 'live', 'Live')
    const controller = new AbortController()
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockImplementation(() => new Promise((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
    }))
    const pending = ctx.sessionControl.search({}, controller.signal)
    controller.abort('stop')
    await expect(pending).rejects.toEqual(expectCode('SESSION_CONTROL_CANCELLED'))
    await ctx.fiber.dispose()
  })

  it('rejects a listing that settles after abort', async () => {
    const ctx = await harness()
    let resolveList: (value: never[]) => void = () => {}
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockImplementation(
      () => new Promise((resolve) => { resolveList = resolve }),
    )
    const controller = new AbortController()
    const pending = ctx.sessionControl.search({}, controller.signal)
    controller.abort('stop')
    resolveList([])
    await expect(pending).rejects.toEqual(expectCode('SESSION_CONTROL_CANCELLED'))
    await ctx.fiber.dispose()
  })

  it('rejects a listing that fails after abort', async () => {
    const ctx = await harness()
    let rejectList: (reason: unknown) => void = () => {}
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockImplementation(
      () => new Promise((_resolve, reject) => { rejectList = reject }),
    )
    const controller = new AbortController()
    const pending = ctx.sessionControl.search({}, controller.signal)
    controller.abort('stop')
    rejectList(new Error('backend'))
    await expect(pending).rejects.toEqual(expectCode('SESSION_CONTROL_CANCELLED'))
    await ctx.fiber.dispose()
  })

  it('rejects when abort is observed only inside settleWithCancellation', async () => {
    const ctx = await harness()
    createNamed(ctx, 'live', 'Live')
    const signal = new AbortController().signal
    let aborted = false
    Object.defineProperty(signal, 'aborted', { get: () => aborted })
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockImplementation(async () => {
      aborted = true
      return []
    })
    await expect(ctx.sessionControl.search({}, signal)).rejects.toEqual(
      expectCode('SESSION_CONTROL_CANCELLED'),
    )
    await ctx.fiber.dispose()
  })

  it('exports the default search limit', () => {
    expect(DEFAULT_SEARCH_LIMIT).toBe(50)
    expect(new SessionControlError('x', 'SESSION_CONTROL_CANCELLED').name).toBe('SessionControlError')
  })
})
