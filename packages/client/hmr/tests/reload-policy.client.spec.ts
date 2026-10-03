import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { ClientHmrReloadPolicy } from '../src/client/reload-policy.ts'
import { DEFAULT_AUTO_RELOAD, type ClientHmrSettings } from '../src/hmr-settings.ts'

function fakeScope(initial?: ClientHmrSettings): SettingsScope<ClientHmrSettings> & {
  publish: (value: ClientHmrSettings) => void
  setMock: ReturnType<typeof vi.fn>
} {
  const setMock = vi.fn(async () => undefined)
  let snapshot: SettingsScopeSnapshot<ClientHmrSettings> = {
    status: initial === undefined ? 'loading' : 'ready',
    value: initial,
    base: undefined,
    user: undefined,
    revision: initial === undefined ? undefined : 0,
    writable: true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: setMock,
    unset: vi.fn(async () => undefined),
    publish(value) {
      snapshot = { ...snapshot, status: 'ready', value, revision: (snapshot.revision ?? -1) + 1 }
      for (const listener of listeners) listener()
    },
    setMock,
  }
}

describe('ClientHmrReloadPolicy', () => {
  it('stays off without a host and publishes before writing', () => {
    const policy = new ClientHmrReloadPolicy()
    expect(policy.autoReload.getSnapshot()).toBe(DEFAULT_AUTO_RELOAD)
    policy.setAutoReload(true)
    expect(policy.autoReload.getSnapshot()).toBe(true)
    policy.setAutoReload(true)
    expect(policy.autoReload.getSnapshot()).toBe(true)
  })

  it('adopts a later host section and writes through set', async () => {
    const host = fakeScope()
    const policy = new ClientHmrReloadPolicy(host)
    expect(policy.autoReload.getSnapshot()).toBe(false)
    host.publish({ autoReload: true })
    expect(policy.autoReload.getSnapshot()).toBe(true)
    policy.setAutoReload(false)
    expect(host.setMock).toHaveBeenCalledWith('autoReload', false)
  })
})
