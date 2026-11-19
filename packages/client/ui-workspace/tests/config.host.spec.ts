import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { apply, Config } from '../src/index.ts'
import { WORKSPACE_SETTINGS_NAMESPACE } from '../src/workspace-settings.ts'

describe('ui-workspace host', () => {
  it('keeps ten recent views by default and rejects a negative or fractional limit', () => {
    expect(Config({}).recentViewLimit?.get()).toBe(10)
    expect(Config({ recentViewLimit: 3 }).recentViewLimit?.get()).toBe(3)
    expect(Config({ recentViewLimit: 0 }).recentViewLimit?.get()).toBe(0)
    expect(() => Config({ recentViewLimit: -1 })).toThrow()
    expect(() => Config({ recentViewLimit: 1.5 })).toThrow()
  })

  it('registers the durable Session-overflow section when a settings service is present', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const register = vi.fn()
    ctx.provide('settings', { register } as never)
    apply(ctx)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledOnce() })
    expect(register.mock.calls[0]![0]).toBe(WORKSPACE_SETTINGS_NAMESPACE)
  })

  it('declares nothing when no settings service is mounted', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    expect(() => { apply(ctx) }).not.toThrow()
  })

  it('loads as a Loader entry that declares its synced Config', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    let received: Config | undefined
    const fiber = ctx.plugin({
      Config,
      apply: (_ctx: Context, config: Config) => { received = config; apply() },
    }, { recentViewLimit: 4 })
    await expect(fiber.await()).resolves.toBeDefined()
    expect(received?.recentViewLimit.get()).toBe(4)
  })
})
