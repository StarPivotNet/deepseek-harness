// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../../src/client/index.ts'
import { MarketplaceSettingsSection } from '../../src/client/MarketplaceSettingsSection.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  ctx.provide('settingsScope', {
    bind: () => ({
      getSnapshot: () => ({ value: { catalogUrls: [] } }),
      subscribe: () => () => {},
      set: async () => {},
    }),
  })
  ctx.provide('connection', {
    rpc: { call: async () => ({ ok: true, value: {} }) },
  })
  ctx.provide('loader', {})
  ctx.provide('modules', {})
  ctx.provide('commandUi', { decorate: () => () => {} })
  ctx.provide('sessions', { get: () => ({}) })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugin-marketplace browser plugin', () => {
  it('declares the services the Discover tab and reload toast read', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'settingsScope', 'connection', 'loader', 'modules', 'commandUi', 'sessions',
    ])
  })

  it('waits for the Plugins section to declare the tab slot', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(MarketplaceSettingsSection)
    expect(entry.options).toMatchObject({ id: 'discover', order: 5 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('插件市场')

    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Marketplace')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(MarketplaceSettingsSection)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
