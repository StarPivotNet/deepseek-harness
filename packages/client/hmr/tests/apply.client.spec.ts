// @vitest-environment jsdom
/** client-hmr apply wiring: settings dictionaries, declaration-aware
 * General-section row, and HMR collapse recovery. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-scope.ts'
import { apply, inject, SETTINGS_NS } from '../src/client/index.ts'
import type { ReloadRowInjected } from '../src/client/ReloadRow.tsx'
import { CLIENT_HMR_SETTINGS_NAMESPACE, ClientHmrSettingsSchema } from '../src/hmr-settings.ts'
import { ReloadRow } from '../src/client/ReloadRow.tsx'

usePinnedBrowserLanguages('zh-CN')

class FakeEventSource {
  addEventListener(): void {}
  close(): void {}
}
Object.assign(globalThis, { EventSource: FakeEventSource })

const SLOT = 'settings.general.item'

async function bench(isLoopback = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  let autoReload = false
  const namespace = () => ({
    ns: CLIENT_HMR_SETTINGS_NAMESPACE,
    schema: ClientHmrSettingsSchema.toJSON(),
    value: { autoReload },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'hmr-describe' as never,
    result: {
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [namespace()] },
    },
  }))
  const mutate = vi.fn(async (_ns: string, ops: { path: string[]; value?: boolean }[], _revision?: number) => {
    const value = ops[0]?.value
    if (typeof value === 'boolean') autoReload = value
    return {
      ok: true as const,
      value: namespace(),
    }
  })
  ctx.provide('connection', { api: { settings: { describe, mutate } }, isLoopback } as never)
  ctx.provide('loader', { entries: () => [] } as never)
  ctx.provide('modules', {
    invalidate() {},
    prefetch: async () => undefined,
    entries: { sync: async () => {}, reload: async () => {} },
  } as never)
  new TestRemote(ctx, { settings: { describe, mutate } })
  const connection = ctx.get('connection') as { api: never }
  const mirror = new SettingsDescribeMirror(connection.api)
  await ctx.plugin(SettingsScopeBinder, {
    mirror, schema: new SettingsSchemaService(ctx), persistence: 'host',
  }).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, describe, mutate,
  }
}

function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === ReloadRow)!
  const face = (entry.inject as unknown as () => ReloadRowInjected)()
  return { entry, face }
}

describe('client-hmr apply', () => {
  it('declares the slot, locale, and settings services', () => {
    expect(inject).toEqual(['loader', 'modules', 'slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('registers localized copy and the row (declaration before or after apply)', async () => {
    const before = await bench()
    declareItems(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.locale.bind(SETTINGS_NS)('title')).toBe('插件热重载')
    before.locale.setLocale('en')
    expect(before.locale.bind(SETTINGS_NS)('title')).toBe('Plugin hot reload')
    const entry = before.slots.entries(SLOT).find(e => e.component === ReloadRow)!
    expect(entry.options).toMatchObject({ id: 'plugin-reload', order: 30 })

    const after = await bench()
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
    declareItems(after.slots)
    await Promise.resolve()
    expect(after.slots.entries(SLOT).some(e => e.component === ReloadRow)).toBe(true)
  })

  it('routes face writes through the Host settings scope', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { face } = faceOf(b.slots)
    expect(face.hooks.autoReload.getSnapshot()).toBe(false)
    face.setAutoReload(true)
    expect(face.hooks.autoReload.getSnapshot()).toBe(true)
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledOnce() })
  })

  it('recovers after an HMR collapse of the declaring entry', async () => {
    const b = await bench()
    const host = declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)
    host()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    declareItems(b.slots)
    await Promise.resolve()
    expect(b.slots.entries(SLOT).some(e => e.component === ReloadRow)).toBe(true)
  })

  it('teardown removes the row and the dictionaries', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    expect(b.locale.bind(SETTINGS_NS)('title')).toBe('title')
  })
})
