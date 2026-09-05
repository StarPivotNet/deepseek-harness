// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name, NS } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import type { ProductCheckResult } from '../src/update-settings.ts'
import { PRODUCT_UPDATE_RPC_CHANNEL } from '../src/rpc-channel.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function fakeScope(lastResult?: ProductCheckResult) {
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({
      status: 'ready' as const,
      value: lastResult === undefined ? {} : { lastResult },
      base: undefined,
      user: undefined,
      revision: 1,
      writable: true,
      mode: 'host' as const,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async () => {},
    unset: async () => {},
    listeners,
  }
}

const githubLatest = {
  tag: 'dsh-v1.2.4',
  version: '1.2.4',
  url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v1.2.4',
  notes: '',
}

describe('product-update client apply', () => {
  it('registers dictionaries and slots, hydrates from settings, and does not prefetch', async () => {
    const ctx = new Context()
    const localeDisposer = vi.fn()
    const locale = { register: vi.fn(() => localeDisposer) }
    const scope = fakeScope({
      available: true,
      currentVersion: '1.2.3',
      latest: githubLatest,
      checkedAt: 1,
      channel: 'dsh',
    })
    const settingsScope = { bind: vi.fn(() => scope) }
    const registered: Array<{ name: string; id: string }> = []
    const slots = {
      inject: vi.fn((_name: string, factory: () => void) => { factory() }),
      register: vi.fn((spec: {
        name: string
        id: string
        inject?: () => {
          checkNow: () => void
          dismiss: () => void
          openRelease: () => void
          canInstall: () => boolean
          installNow: () => void
          cancelInstall: () => void
          relaunchToUpdate: () => void
        }
      }) => {
        registered.push({ name: spec.name, id: spec.id })
        return () => {}
      }),
    }
    const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
    const rpc = {
      call: vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
        calls.push({ channel, endpoint, payload })
        if (endpoint === 'check') {
          return {
            ok: true,
            value: {
              available: true,
              currentVersion: '1.2.3',
              latest: githubLatest,
              checkedAt: 2,
              channel: 'dsh',
            },
          }
        }
        return { ok: true, value: { ok: true } }
      }),
    }
    ctx.provide('locale', locale as never)
    ctx.provide('settingsScope', settingsScope as never)
    ctx.provide('slots', slots as never)
    ctx.provide('connection', { rpc } as never)
    const open = vi.fn()
    vi.stubGlobal('open', open)
    apply(ctx)
    expect(locale.register).toHaveBeenCalledWith(NS, { zh, en })
    expect(registered).toEqual([
      { name: 'settings.general.item', id: 'product-update' },
      { name: 'shell.overlay', id: 'product-update' },
    ])
    expect(name).toBe('client-ui-update')
    expect(inject).toEqual(['slots', 'locale', 'settingsScope', 'connection'])
    expect(calls).toEqual([])
    const rowSpec = slots.register.mock.calls[0]![0]
    rowSpec.inject!().checkNow()
    await vi.waitFor(() => { expect(calls).toEqual([{ channel: PRODUCT_UPDATE_RPC_CHANNEL, endpoint: 'check', payload: { force: true } }]) })
    rowSpec.inject!().dismiss()
    await vi.waitFor(() => { expect(calls.some(row => row.channel === PRODUCT_UPDATE_RPC_CHANNEL && row.endpoint === 'dismiss')).toBe(true) })
    rowSpec.inject!().openRelease()
    expect(open).toHaveBeenCalledWith(githubLatest.url, '_blank', 'noopener,noreferrer')
    expect(rowSpec.inject!().canInstall()).toBe(false)
    rowSpec.inject!().installNow()
    rowSpec.inject!().cancelInstall()
    rowSpec.inject!().relaunchToUpdate()
  })

  it('forwards Install through the desktop preload when an artifact is present', async () => {
    const artifact = {
      name: 'DeepSeek Harness-1.2.4-win.zip',
      url: 'https://github.com/StarPivotNet/deepseek-harness/releases/download/desktop-v1.2.4/DeepSeek%20Harness-1.2.4-win.zip',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      size: 12,
      platform: 'win32' as const,
    }
    const desktopLatest = {
      tag: 'desktop-v1.2.4',
      version: '1.2.4',
      url: 'https://github.com/StarPivotNet/deepseek-harness/releases/tag/desktop-v1.2.4',
      notes: '',
      artifact,
    }
    const ctx = new Context()
    const locale = { register: vi.fn(() => () => {}) }
    const settingsScope = { bind: vi.fn(() => fakeScope({
      available: true,
      currentVersion: '1.2.3',
      latest: desktopLatest,
      checkedAt: 1,
      channel: 'desktop',
    })) }
    let injected: {
      canInstall: () => boolean
      installNow: () => void
      cancelInstall: () => void
      relaunchToUpdate: () => void
      hooks: { status: { getSnapshot: () => { install?: { phase: string } } } }
    } | undefined
    const slots = {
      inject: vi.fn((_name: string, factory: () => void) => { factory() }),
      register: vi.fn((spec: {
        inject?: () => {
          canInstall: () => boolean
          installNow: () => void
          cancelInstall: () => void
          relaunchToUpdate: () => void
          hooks: { status: { getSnapshot: () => { install?: { phase: string } } } }
        }
      }) => {
        injected ??= spec.inject?.()
        return () => {}
      }),
    }
    ctx.provide('locale', locale as never)
    ctx.provide('settingsScope', settingsScope as never)
    ctx.provide('slots', slots as never)
    ctx.provide('connection', { rpc: { call: vi.fn() } } as never)
    let releaseInstall: ((value: { ok: true }) => void) | undefined
    const installUpdate = vi.fn(() => new Promise<{ ok: true }>((resolve) => {
      releaseInstall = resolve
    }))
    const cancelUpdate = vi.fn()
    const relaunchToUpdate = vi.fn()
    const progress: Array<(event: unknown) => void> = []
    vi.stubGlobal('dshDesktop', {
      canInstall: () => true,
      installUpdate,
      cancelUpdate,
      relaunchToUpdate,
      onUpdateProgress: (cb: (event: unknown) => void) => {
        progress.push(cb)
        return () => {}
      },
    })
    apply(ctx)
    expect(injected!.canInstall()).toBe(true)
    injected!.installNow()
    injected!.installNow()
    expect(installUpdate).toHaveBeenCalledOnce()
    expect(installUpdate).toHaveBeenCalledWith({
      tag: desktopLatest.tag,
      version: desktopLatest.version,
      artifact,
    })
    progress[0]?.({ phase: 'downloading', received: 4, total: 12 })
    injected!.installNow()
    progress[0]?.({ phase: 'verifying' })
    injected!.installNow()
    progress[0]?.({ phase: 'applying' })
    injected!.installNow()
    progress[0]?.({ phase: 'error', message: 'nope' })
    progress[0]?.({ phase: 'ready' })
    progress[0]?.('ignored')
    releaseInstall?.({ ok: true })
    await vi.waitFor(() => {
      expect(injected!.hooks.status.getSnapshot().install?.phase).toBe('ready')
    })
    injected!.installNow()
    expect(installUpdate).toHaveBeenCalledOnce()
    injected!.cancelInstall()
    injected!.relaunchToUpdate()
    expect(cancelUpdate).toHaveBeenCalledOnce()
    expect(relaunchToUpdate).toHaveBeenCalledOnce()
  })

  it('records an install error from the preload', async () => {
    const artifact = {
      name: 'DeepSeek Harness-1.2.4-win.zip',
      url: 'https://github.com/StarPivotNet/deepseek-harness/releases/download/desktop-v1.2.4/DeepSeek%20Harness-1.2.4-win.zip',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      size: 12,
      platform: 'win32' as const,
    }
    const ctx = new Context()
    const locale = { register: vi.fn(() => () => {}) }
    const settingsScope = { bind: vi.fn(() => fakeScope({
      available: true,
      currentVersion: '1.2.3',
      latest: {
        tag: 'desktop-v1.2.4',
        version: '1.2.4',
        url: 'https://github.com/StarPivotNet/deepseek-harness/releases/tag/desktop-v1.2.4',
        notes: '',
        artifact,
      },
      checkedAt: 1,
      channel: 'desktop',
    })) }
    let injected: {
      installNow: () => void
      hooks: { status: { getSnapshot: () => { install?: { phase: string; error?: string } } } }
    } | undefined
    const slots = {
      inject: vi.fn((_name: string, factory: () => void) => { factory() }),
      register: vi.fn((spec: {
        inject?: () => {
          installNow: () => void
          hooks: { status: { getSnapshot: () => { install?: { phase: string; error?: string } } } }
        }
      }) => {
        injected ??= spec.inject?.()
        return () => {}
      }),
    }
    ctx.provide('locale', locale as never)
    ctx.provide('settingsScope', settingsScope as never)
    ctx.provide('slots', slots as never)
    ctx.provide('connection', { rpc: { call: vi.fn() } } as never)
    vi.stubGlobal('dshDesktop', {
      canInstall: () => true,
      installUpdate: async () => ({ ok: false as const, error: 'not-packaged' }),
    })
    apply(ctx)
    injected!.installNow()
    await vi.waitFor(() => {
      expect(injected!.hooks.status.getSnapshot().install).toEqual({
        phase: 'error',
        received: 0,
        total: 0,
        error: 'not-packaged',
      })
    })
    vi.stubGlobal('dshDesktop', {
      canInstall: () => true,
      installUpdate: async () => { throw new Error('ipc') },
    })
    const ctx2 = new Context()
    let injected2: {
      installNow: () => void
      hooks: { status: { getSnapshot: () => { install?: { phase: string } } } }
    } | undefined
    ctx2.provide('locale', { register: vi.fn(() => () => {}) } as never)
    ctx2.provide('settingsScope', settingsScope as never)
    ctx2.provide('slots', {
      inject: vi.fn((_name: string, factory: () => void) => { factory() }),
      register: vi.fn((spec: {
        inject?: () => {
          installNow: () => void
          hooks: { status: { getSnapshot: () => { install?: { phase: string } } } }
        }
      }) => {
        injected2 ??= spec.inject?.()
        return () => {}
      }),
    } as never)
    ctx2.provide('connection', { rpc: { call: vi.fn() } } as never)
    apply(ctx2)
    injected2!.installNow()
    await vi.waitFor(() => {
      expect(injected2!.hooks.status.getSnapshot().install?.phase).toBe('error')
    })
  })

  it('refuses to window.open a non-github release URL', () => {
    const ctx = new Context()
    const locale = { register: vi.fn(() => () => {}) }
    const settingsScope = { bind: vi.fn(() => fakeScope({
      available: true,
      currentVersion: '1.2.3',
      latest: { ...githubLatest, url: 'https://example.test/1.2.4' },
      checkedAt: 1,
      channel: 'dsh',
    })) }
    let injected: { openRelease: () => void } | undefined
    const slots = {
      inject: vi.fn((_name: string, factory: () => void) => { factory() }),
      register: vi.fn((spec: { inject?: () => { openRelease: () => void } }) => {
        injected = spec.inject?.()
        return () => {}
      }),
    }
    ctx.provide('locale', locale as never)
    ctx.provide('settingsScope', settingsScope as never)
    ctx.provide('slots', slots as never)
    ctx.provide('connection', { rpc: { call: vi.fn() } } as never)
    const open = vi.fn()
    vi.stubGlobal('open', open)
    apply(ctx)
    injected!.openRelease()
    expect(open).not.toHaveBeenCalled()
  })

  it('marks the status error when check RPC fails and no-ops dismiss without a tag', async () => {
    const ctx = new Context()
    const locale = { register: vi.fn(() => () => {}) }
    const settingsScope = { bind: vi.fn(() => fakeScope()) }
    let injected: { checkNow: () => void; dismiss: () => void; openRelease: () => void } | undefined
    const slots = {
      inject: vi.fn((_name: string, factory: () => void) => { factory() }),
      register: vi.fn((spec: {
        inject?: () => { checkNow: () => void; dismiss: () => void; openRelease: () => void }
      }) => {
        injected ??= spec.inject?.()
        return () => {}
      }),
    }
    const rpc = {
      call: vi.fn(async (_channel: string, _endpoint: string, _payload?: unknown) => (
        { ok: false, error: { code: 'internal', message: 'offline', details: {} } }
      )),
    }
    ctx.provide('locale', locale as never)
    ctx.provide('settingsScope', settingsScope as never)
    ctx.provide('slots', slots as never)
    ctx.provide('connection', { rpc } as never)
    apply(ctx)
    expect(rpc.call).not.toHaveBeenCalled()
    injected!.dismiss()
    injected!.openRelease()
    expect(rpc.call).not.toHaveBeenCalled()
    injected!.checkNow()
    await vi.waitFor(() => { expect(rpc.call).toHaveBeenCalled() })
    expect(rpc.call.mock.calls.some(call => call[1] === 'dismiss')).toBe(false)
  })

  it('leaves available true when dismiss RPC fails', async () => {
    const ctx = new Context()
    const locale = { register: vi.fn(() => () => {}) }
    const settingsScope = { bind: vi.fn(() => fakeScope({
      available: true,
      currentVersion: '1.2.3',
      latest: githubLatest,
      checkedAt: 1,
      channel: 'dsh',
    })) }
    let injected: { dismiss: () => void; hooks: { status: { getSnapshot: () => { result?: { available: boolean } } } } } | undefined
    const slots = {
      inject: vi.fn((_name: string, factory: () => void) => { factory() }),
      register: vi.fn((spec: {
        inject?: () => { dismiss: () => void; hooks: { status: { getSnapshot: () => { result?: { available: boolean } } } } }
      }) => {
        injected ??= spec.inject?.()
        return () => {}
      }),
    }
    const rpc = {
      call: vi.fn(async () => ({ ok: false, error: { code: 'internal', message: 'offline', details: {} } })),
    }
    ctx.provide('locale', locale as never)
    ctx.provide('settingsScope', settingsScope as never)
    ctx.provide('slots', slots as never)
    ctx.provide('connection', { rpc } as never)
    apply(ctx)
    injected!.dismiss()
    await vi.waitFor(() => { expect(rpc.call).toHaveBeenCalled() })
    expect(injected!.hooks.status.getSnapshot().result?.available).toBe(true)
  })
})
