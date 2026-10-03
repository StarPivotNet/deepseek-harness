/**
 * ui-automation plugin halves: the browser entry's dictionary and sidebar-slot
 * registrations against the real SlotRegistry (with fiber teardown proving
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

async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.automation': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const automation = {
    list: () => Promise.resolve({ rpcId: 'r', result: { ok: true, value: { items: [] } } }),
    create: () => Promise.resolve({ rpcId: 'r', result: { ok: true, value: { rule: {} } } }),
    update: () => Promise.resolve({ rpcId: 'r', result: { ok: true, value: { rule: {} } } }),
    setEnabled: () => Promise.resolve({ rpcId: 'r', result: { ok: true, value: { rule: {} } } }),
    runNow: () => Promise.resolve({
      rpcId: 'r',
      result: { ok: true, value: { run: { outcome: 'started', sessionId: 'session-1' } } },
    }),
    listRuns: () => Promise.resolve({ rpcId: 'r', result: { ok: true, value: { items: [] } } }),
    deleteRun: () => Promise.resolve({ rpcId: 'r', result: { ok: true, value: { id: 'run-1', deleted: true } } }),
    delete: () => Promise.resolve({ rpcId: 'r', result: { ok: true, value: { id: 'rule-1', deleted: true } } }),
  }
  ctx.provide('connection', { api: { automation, settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('remote.automation', { list: () => Promise.resolve({ rpcId: 'a', result: { ok: false, error: { code: 'x', message: 'no' } } }) } as never)
  ctx.provide('sessions', {
    list: {
      getSnapshot: () => ({ byId: { 'session-1': { id: 'session-1' } } }),
      subscribe: () => () => {},
    },
    open: () => undefined,
  } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-automation browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.automation', 'sessions', 'settingsScope'])
  })

  it('registers the sidebar occupant, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(ctx.slots.entries('sidebar.automation')).toHaveLength(1)
    expect(ctx.slots.entries('sidebar.automation')[0]!.options).toMatchObject({ id: 'host-automation', order: 0 })
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(1)
    const injected = (ctx.slots.entries('sidebar.automation')[0]!.inject as () => {
      load: () => Promise<void>
      create: (input: { task: string; workspaceId: never; afterSeconds: number }) => Promise<string | undefined>
      update: (id: never, input: { name?: string }) => Promise<string | undefined>
      setEnabled: (id: never, enabled: boolean) => Promise<string | undefined>
      runNow: (id: never) => Promise<string | undefined>
      openLastSession: (id: never) => Promise<string | undefined>
      openRun: (id: never) => Promise<string | undefined>
      deleteRun: (id: never) => Promise<string | undefined>
      remove: (id: never) => Promise<string | undefined>
      select: (id: never | null) => void
      setDetailTab: (tab: 'settings' | 'history') => void
      setPageOpen: (open: boolean) => void
      setKeepAwake: (enabled: boolean) => void
    })()
    await injected.load()
    await injected.create({ task: 'ping', workspaceId: 'ws-1' as never, afterSeconds: 60 })
    await injected.update('rule-1' as never, { name: 'renamed' })
    await injected.setEnabled('rule-1' as never, false)
    await injected.runNow('rule-1' as never)
    await injected.openLastSession('rule-1' as never)
    await injected.openRun('session-1' as never)
    await injected.deleteRun('run-1' as never)
    injected.select('rule-1' as never)
    injected.setDetailTab('history')
    await injected.remove('rule-1' as never)
    injected.setPageOpen(true)
    injected.setKeepAwake(true)
    ctx.emit('connection/reset')
    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.automation')).toHaveLength(0)
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('trigger')).toBe(zh.trigger)
    ctx.locale.setLocale('en')
    expect(translate('trigger')).toBe(en.trigger)

    await fiber.dispose()
    expect(translate('trigger')).not.toBe(en.trigger)
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-automation node half', () => {
  it('registers without a settings provider', () => {
    const ctx = new Context()
    expect(() => { applyNode(ctx) }).not.toThrow()
  })
})
