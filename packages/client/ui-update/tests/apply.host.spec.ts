import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import {
  Config, PRODUCT_UPDATE_RPC_CHANNEL, PRODUCT_UPDATE_SETTINGS_NAMESPACE, apply, inject,
} from '@deepseek-ai/dsh-client-ui-update'
import { desktopArtifactName, isSupportedDesktopTarget } from '../src/artifact.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

function fakeConnection(handlerRef: { current: ConnectionRpcHandler | undefined }): Pick<HostConnectionHandle, 'rpc'> {
  return {
    rpc: {
      handle: (channel, handler) => {
        expect(channel).toBe(PRODUCT_UPDATE_RPC_CHANNEL)
        handlerRef.current = handler
        return async () => { handlerRef.current = undefined }
      },
      intercept: () => async () => {},
    },
  }
}

describe('client-ui-update host', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('registers the durable cache, handles check/dismiss, and disposes the namespace', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const handlerRef: { current: ConnectionRpcHandler | undefined } = { current: undefined }
    ctx.provide('connection', fakeConnection(handlerRef))
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{
      tag_name: 'dsh-v1.2.4',
      html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v1.2.4',
      draft: false,
      prerelease: false,
      body: 'notes',
    }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchImpl)
    vi.stubEnv('DSH_PRODUCT_VERSION', '1.2.3')
    const fiber = ctx.plugin({ inject: [...inject], Config, apply })
    await fiber.await()
    const ns = settingsNamespace(PRODUCT_UPDATE_SETTINGS_NAMESPACE)
    expect(handlerRef.current).toBeTypeOf('function')
    await vi.waitFor(() => {
      expect((ctx.settings.get(ns) as { lastResult?: { available?: boolean } } | undefined)?.lastResult?.available).toBe(true)
    })
    const handler = handlerRef.current
    if (handler === undefined) throw new Error('product-update RPC handler missing after apply')
    const checked = await handler('check', { force: true }, new AbortController().signal)
    expect(checked).toMatchObject({ ok: true, value: { available: true, currentVersion: '1.2.3' } })
    const dismissed = await handler('dismiss', { tag: 'dsh-v1.2.4' }, new AbortController().signal)
    expect(dismissed).toEqual({ ok: true, value: { ok: true } })
    expect((ctx.settings.get(ns) as { dismissedTag?: string }).dismissedTag).toBe('dsh-v1.2.4')
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('attaches a desktop archive from SHA256SUMS on the desktop channel', async () => {
    const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const names = [
      desktopArtifactName('1.2.4', 'darwin'),
      desktopArtifactName('1.2.4', 'linux'),
      desktopArtifactName('1.2.4', 'win32'),
    ]
    const download = (file: string): string =>
      `https://github.com/StarPivotNet/deepseek-harness/releases/download/desktop-v1.2.4/${encodeURIComponent(file)}`
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const handlerRef: { current: ConnectionRpcHandler | undefined } = { current: undefined }
    ctx.provide('connection', fakeConnection(handlerRef))
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/SHA256SUMS')) {
        return new Response(names.map(name => `${hash}  ${name}`).join('\n') + '\n', { status: 200 })
      }
      return new Response(JSON.stringify([{
        tag_name: 'desktop-v1.2.4',
        html_url: 'https://github.com/StarPivotNet/deepseek-harness/releases/tag/desktop-v1.2.4',
        draft: false,
        prerelease: false,
        body: 'notes',
        assets: [
          ...names.map(name => ({ name, browser_download_url: download(name), size: 42 })),
          { name: 'SHA256SUMS', browser_download_url: download('SHA256SUMS'), size: 80 },
        ],
      }]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchImpl)
    vi.stubEnv('DSH_PRODUCT_VERSION', '1.2.3')
    vi.stubEnv('DSH_PRODUCT_CHANNEL', 'desktop')
    const fiber = ctx.plugin({ inject: [...inject], Config, apply })
    await fiber.await()
    const ns = settingsNamespace(PRODUCT_UPDATE_SETTINGS_NAMESPACE)
    const expectedName = isSupportedDesktopTarget(process.platform, process.arch)
      && (process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32')
      ? desktopArtifactName('1.2.4', process.platform)
      : undefined
    await vi.waitFor(() => {
      const latest = (ctx.settings.get(ns) as { lastResult?: { latest?: { artifact?: { name: string } } } } | undefined)
        ?.lastResult?.latest
      expect(latest?.artifact?.name).toBe(expectedName)
    })
    const handler = handlerRef.current
    if (handler === undefined) throw new Error('product-update RPC handler missing after apply')
    const checked = await handler('check', { force: true }, new AbortController().signal)
    expect(checked).toMatchObject({
      ok: true,
      value: {
        available: true,
        channel: 'desktop',
        latest: {
          tag: 'desktop-v1.2.4',
          ...expectedName === undefined
            ? {}
            : { artifact: { name: expectedName, sha256: hash, size: 42, platform: process.platform } },
        },
      },
    })
    await fiber.dispose()
  })

  it('polls on the configured interval and clears the timer on dispose', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const handlerRef: { current: ConnectionRpcHandler | undefined } = { current: undefined }
    ctx.provide('connection', fakeConnection(handlerRef))
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{
      tag_name: 'dsh-v1.2.4',
      html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v1.2.4',
      draft: false,
      prerelease: false,
      body: 'notes',
    }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchImpl)
    vi.stubEnv('DSH_PRODUCT_VERSION', '1.2.3')
    const fiber = ctx.plugin({ inject: [...inject], Config, apply }, { checkIntervalMs: 60_000 })
    await fiber.await()
    await Promise.resolve()
    await fetchImpl.mock.results[0]!.value
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    await fetchImpl.mock.results[1]!.value
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await fiber.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('aborts an in-flight poll on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const handlerRef: { current: ConnectionRpcHandler | undefined } = { current: undefined }
    ctx.provide('connection', fakeConnection(handlerRef))
    let seen: AbortSignal | undefined
    const fetchImpl = vi.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
      seen = init?.signal
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', fetchImpl)
    vi.stubEnv('DSH_PRODUCT_VERSION', '1.2.3')
    const fiber = ctx.plugin({ inject: [...inject], Config, apply })
    await fiber.await()
    await vi.waitFor(() => { expect(seen).toBeDefined() })
    expect(seen!.aborted).toBe(false)
    await fiber.dispose()
    expect(seen!.aborted).toBe(true)
  })
})
