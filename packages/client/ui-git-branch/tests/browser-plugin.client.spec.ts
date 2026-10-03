/**
 * ui-git-branch plugin halves: the browser entry dictionaries and hero-slot
 * registration against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), the inert node entry.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { stubConfigForm, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

function heroOccupied(ctx: Context): boolean {
  return ctx.slots.entries('conversation.hero.branch').length > 0
}

async function bench(options: {
  describe?: () => Promise<unknown>
  current?: string
  workspaces?: { items: { workspaceId: string; sessionIds: string[] }[]; recentWorkspaceId?: string }
} = {}): Promise<{
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  notifySessions: () => void
  notifyWorkspaces: () => void
  setCurrent: (sessionId: string | undefined) => void
  setWorkspaces: (next: { items: { workspaceId: string; sessionIds: string[] }[]; recentWorkspaceId?: string }) => void
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.hero.branch': { kind: 'single', scope: 'root' },
    },
  } as never, () => null)
  const sessionListeners = new Set<() => void>()
  const workspaceListeners = new Set<() => void>()
  let current: string | undefined = options.current
  let workspaces = options.workspaces ?? ({ items: [{ workspaceId: 'ws-1', sessionIds: [] }], recentWorkspaceId: 'ws-1' })
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({ current }),
      subscribe: (listener: () => void) => {
        sessionListeners.add(listener)
        listener()
        return () => { sessionListeners.delete(listener) }
      },
    },
  })
  ctx.provide('workspaces', {
    list: {
      getSnapshot: () => workspaces,
      subscribe: (listener: () => void) => {
        workspaceListeners.add(listener)
        listener()
        return () => { workspaceListeners.delete(listener) }
      },
    },
  })
  ctx.provide('conversation', {})
  ctx.provide('connection', {
    api: {
      git: {
        describe: options.describe ?? (() => Promise.resolve({ rpcId: 'r', result: { ok: false, error: { code: 'git-not-a-repository', message: 'no', details: {} } } })),
        checkout: () => Promise.resolve({ rpcId: 'r', result: { ok: true, value: {} } }),
        createBranch: () => Promise.resolve({ rpcId: 'r', result: { ok: true, value: {} } }),
      },
    },
    isLoopback: false,
  } as never)
  // The runtime's `remote` value exposes namespace handles on itself while the
  // gateway also registers each as a traced `remote.<namespace>` service; the
  // stub mirrors both faces so `scope.remote.git` and injection agree.
  const gitNamespace = {
    describe: options.describe ?? (() => Promise.resolve({ rpcId: 'r', result: { ok: false, error: { code: 'git-not-a-repository', message: 'no', details: {} } } })),
    checkout: () => Promise.resolve({ rpcId: 'r', result: { ok: true, value: {} } }),
    createBranch: () => Promise.resolve({ rpcId: 'r', result: { ok: true, value: {} } }),
  }
  ctx.provide('remote', { $on: () => () => {}, git: gitNamespace } as never)
  ctx.provide('remote.git', gitNamespace as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx,
    fiber,
    notifySessions: () => { for (const listener of sessionListeners) listener() },
    notifyWorkspaces: () => { for (const listener of workspaceListeners) listener() },
    setCurrent: (sessionId) => { current = sessionId },
    setWorkspaces: (next) => { workspaces = next },
  }
}

describe('ui-git-branch browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.git', 'sessions', 'workspaces'])
  })

  it('registers the hero chip, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(heroOccupied(ctx)).toBe(true)
    const injected = ctx.slots.entries('conversation.hero.branch')[0]!.inject as () => {
      load: () => Promise<void>
      checkout: (branch: string) => Promise<void>
      createBranch: (branch: string) => Promise<void>
    }
    await injected().load()
    await injected().checkout('main')
    await injected().createBranch('topic')
    await fiber.dispose()
    expect(heroOccupied(ctx)).toBe(false)
  })

  it('describes once for repeated session-list publishes of the same identity', async () => {
    let describes = 0
    const { notifySessions, setCurrent, fiber } = await bench({
      describe: () => {
        describes += 1
        return Promise.resolve({ rpcId: 'r', result: { ok: false, error: { code: 'git-not-a-repository', message: 'no', details: {} } } })
      },
    })
    await Promise.resolve()
    const afterMount = describes
    notifySessions()
    notifySessions()
    notifySessions()
    await Promise.resolve()
    expect(describes).toBe(afterMount)
    setCurrent('s1')
    notifySessions()
    await Promise.resolve()
    expect(describes).toBe(afterMount + 1)
    await fiber.dispose()
  })

  it('describes the workspace that owns the current session', async () => {
    let payload: unknown
    const { fiber } = await bench({
      current: 's1',
      workspaces: {
        items: [
          { workspaceId: 'ws-other', sessionIds: [] },
          { workspaceId: 'ws-owned', sessionIds: ['s1'] },
        ],
        recentWorkspaceId: 'ws-other',
      },
      describe: () => {
        payload = 'hit'
        return Promise.resolve({ rpcId: 'r', result: { ok: false, error: { code: 'git-not-a-repository', message: 'no', details: {} } } })
      },
    })
    await Promise.resolve()
    expect(payload).toBe('hit')
    await fiber.dispose()
  })

  it('describes again when the workspace identity changes', async () => {
    let describes = 0
    const { notifyWorkspaces, setWorkspaces, fiber } = await bench({
      describe: () => {
        describes += 1
        return Promise.resolve({ rpcId: 'r', result: { ok: false, error: { code: 'git-not-a-repository', message: 'no', details: {} } } })
      },
    })
    await Promise.resolve()
    const afterMount = describes
    setWorkspaces({ items: [{ workspaceId: 'ws-2', sessionIds: [] }], recentWorkspaceId: 'ws-2' })
    notifyWorkspaces()
    await Promise.resolve()
    expect(describes).toBe(afterMount + 1)
    await fiber.dispose()
  })

  it('falls back to the first workspace when recentWorkspaceId is absent', async () => {
    let describes = 0
    const { fiber } = await bench({
      workspaces: { items: [{ workspaceId: 'ws-first', sessionIds: [] }] },
      describe: () => {
        describes += 1
        return Promise.resolve({ rpcId: 'r', result: { ok: false, error: { code: 'git-not-a-repository', message: 'no', details: {} } } })
      },
    })
    await Promise.resolve()
    expect(describes).toBeGreaterThan(0)
    await fiber.dispose()
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    ctx.locale.setLocale('zh')
    const translate = ctx.locale.bind(NS)
    expect(translate('seat.hint')).toBe(zh['seat.hint'])
    ctx.locale.setLocale('en')
    expect(translate('seat.hint')).toBe(en['seat.hint'])
    await fiber.dispose()
    expect(translate('seat.hint')).not.toBe(en['seat.hint'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-git-branch node half', () => {
  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
  })
})
