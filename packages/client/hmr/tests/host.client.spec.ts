import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import {
  CLIENT_HMR_SETTINGS_NAMESPACE, Config, DEFAULT_AUTO_RELOAD, apply, inject,
} from '@deepseek-ai/dsh-client-hmr'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

function fakeClientModules(): ClientModuleRegistry {
  const fake: Pick<ClientModuleRegistry, 'graph' | 'clientPath' | 'rebuilt' | 'onRebuilt' | 'onGraphChanged'> = {
    graph: () => ({ rev: 'r', entries: [] }),
    clientPath: () => undefined,
    rebuilt: () => undefined,
    onRebuilt: () => () => {},
    onGraphChanged: () => () => {},
  }
  return fake as ClientModuleRegistry
}

function fakeWebServer(): WebServer {
  const fake: Pick<WebServer, 'register' | 'tapIndex' | 'port'> = {
    register: () => () => {},
    tapIndex: () => () => {},
    port: 0,
  }
  return fake as WebServer
}

describe('client-hmr host', () => {
  it('registers, validates, and disposes the durable autoReload preference', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    ctx.provide('clientModules', fakeClientModules())
    ctx.provide('webServer', fakeWebServer())
    const fiber = ctx.plugin({ inject: [...inject], Config, apply })
    await fiber.await()
    const ns = settingsNamespace(CLIENT_HMR_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ autoReload: DEFAULT_AUTO_RELOAD })
    await ctx.settings.update(ns, { autoReload: true })
    expect(ctx.settings.get(ns)).toEqual({ autoReload: true })
    await expect(ctx.settings.update(ns, { autoReload: 'always' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
