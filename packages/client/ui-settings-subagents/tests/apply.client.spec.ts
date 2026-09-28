/** What the browser half registers, and that it all leaves with the fiber. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope, TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-subagents/client'
import type { SubagentsSectionInjected } from '@deepseek-ai/dsh-client-ui-settings-subagents/client'

usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  locale.setLocale('zh')
  new TestRemote(ctx)
  ctx.provide('connection', {
    isLoopback: true,
    api: {
      settings: { describe: vi.fn(() => Promise.resolve({ rpcId: 's', result: { ok: false, error: { message: 'no' } } })) },
    },
  } as never)
  ctx.provide('remote.settings', { describe: vi.fn(() => Promise.resolve({ rpcId: 's', result: { ok: false, error: { message: 'no' } } })) } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-subagents apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.settings', 'settingsScope'])
  })

  it('registers one Subagents section between Models and Plugins', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = slots.entries('settings.section')[0]!
    expect(section.options).toMatchObject({ id: 'subagents', order: 12 })
    expect(resolveSlotLabel(section.options.label)).toBe('子代理')
    const face = (section.inject as unknown as () => SubagentsSectionInjected)()
    face.beginCreate()
    face.beginEdit('missing')
    face.cancelDraft()
    face.setDraftName('n')
    face.setDraftDescription('d')
    face.setDraftPersona('p')
    face.setDraftAllow('read')
    face.setDraftDeny('edit')
    face.confirmDelete(null)
    await face.saveDraft()
    await face.remove()
    expect(typeof face.load).toBe('function')
    expect(typeof face.setDelivery).toBe('function')
    expect(face.hooks.settlementBusy.getSnapshot()).toBe('steer')
    face.setDelivery('settlementBusy', 'queue')
    expect(face.hooks.settlementBusy.getSnapshot()).toBe('queue')
    // 测试裸 Context 不携带运行时模块合并出的客户端事件词表。
    // @ts-expect-error the client event vocabulary is runtime-declared
    ctx.emit('settings/document-updated', 'user-subagents')
    // 测试裸 Context 不携带运行时模块合并出的客户端事件词表。
    // @ts-expect-error the client event vocabulary is runtime-declared
    ctx.emit('settings/document-updated', 'other')
    ctx.emit('connection/reset')
    await face.load()
    // 测试裸 Context 不携带运行时模块合并出的客户端事件词表。
    // @ts-expect-error the client event vocabulary is runtime-declared
    ctx.emit('settings/document-updated', 'user-subagents')
  })

  it('unregisters the section with the fiber', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(1)
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
  })
})
