/** Library writes and per-model bindings go through settings.replace. */

import { describe, expect, it, vi } from 'vitest'
import type { ClientRemote, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { bindingFor, messageOf, refreshIfLoaded, slugFromName, SystemPromptsStore } from '../src/client/store.ts'

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

function view(section: { prompts: unknown[]; bindings: unknown[]; overrides?: unknown[] }, revision = 1): SettingsNamespaceView {
  return {
    ns: 'user-system-prompts',
    schema: {},
    value: section,
    applies: 'live',
    secrets: [],
    revision,
  }
}

function api(initial: {
  prompts?: unknown[]
  bindings?: unknown[]
  overrides?: unknown[]
} = {}): {
  settings: Pick<ClientRemote, 'settings'>['settings']
  llm: Pick<ClientRemote, 'llm'>['llm']
  systemPrompt: Pick<ClientRemote, 'systemPrompt'>['systemPrompt']
  replace: ReturnType<typeof vi.fn>
} {
  let current = view({
    prompts: initial.prompts ?? [],
    bindings: initial.bindings ?? [],
    overrides: initial.overrides ?? [],
  })
  type PromptSection = { prompts: unknown[]; bindings: unknown[]; overrides?: unknown[] }
  const replace = vi.fn(async (_ns: string, section: PromptSection, expectedRevision?: number) => {
    current = view(section, (expectedRevision ?? current.revision) + 1)
    return ok(current)
  })
  return {
    settings: {
      describe: vi.fn(async () => ok({ writable: true, hasDocument: true, namespaces: [current] })),
      replace,
    },
    llm: {
      models: vi.fn(async () => ok({
        groups: [{
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
        }],
        failures: [],
      })),
    },
    systemPrompt: {
      list: vi.fn(async () => ok({
        sections: [{
          name: 'harness:identity',
          order: -100,
          text: 'You are an AI agent powered by DeepSeek Harness.',
          complete: false,
        }],
      })),
    },
    replace,
  } as unknown as {
    settings: Pick<ClientRemote, 'settings'>['settings']
    llm: Pick<ClientRemote, 'llm'>['llm']
    systemPrompt: Pick<ClientRemote, 'systemPrompt'>['systemPrompt']
    replace: ReturnType<typeof vi.fn>
  }
}

describe('messageOf', () => {
  it('stringifies a non-Error rejection', () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf('plain')).toBe('plain')
  })
})

describe('slugFromName', () => {
  it('slugs a display name and avoids collisions', () => {
    expect(slugFromName('Be concise', [])).toBe('be-concise')
    expect(slugFromName('Be concise', ['be-concise'])).toBe('be-concise-2')
    expect(slugFromName('!!!', [])).toBe('prompt')
  })
})

describe('bindingFor', () => {
  it('returns the stored row or an empty selection', () => {
    const stored = { provider: 'p', model: 'm', promptIds: ['a'], override: true }
    expect(bindingFor([stored], 'p', 'm')).toEqual(stored)
    expect(bindingFor([stored], 'p', 'other')).toEqual({
      provider: 'p', model: 'other', promptIds: [], override: false,
    })
  })
})

describe('SystemPromptsStore', () => {
  it('loads the library, bindings, and catalog', async () => {
    const wire = api({
      prompts: [{ id: 'style', name: 'Style', text: 'Be concise.' }],
      bindings: [{
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        promptIds: ['style'],
        override: true,
      }],
    })
    const store = new SystemPromptsStore(wire)
    await store.load()
    const snapshot = store.store.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.prompts).toEqual([{ id: 'style', name: 'Style', text: 'Be concise.' }])
    expect(snapshot.builtIns).toEqual([{
      name: 'harness:identity',
      order: -100,
      text: 'You are an AI agent powered by DeepSeek Harness.',
      complete: false,
      overridden: false,
    }])
    expect(snapshot.catalog).toEqual([{
      provider: 'deepseek-official',
      providerName: 'DeepSeek',
      model: 'deepseek-v4-flash',
      modelName: 'DeepSeek V4 Flash',
    }])
    expect(snapshot.bindings[0]?.override).toBe(true)
    store.dispose()
    refreshIfLoaded(store)
  })

  it('ignores malformed library and binding rows', async () => {
    const wire = api({
      prompts: [null, { id: 1 }, { id: 'ok', name: 'Ok' }, { id: 'named', name: 'Named', text: 3 }],
      bindings: [null, { provider: 'p' }, { provider: 'p', model: 'm' }, {
        provider: 'p',
        model: 'n',
        promptIds: ['ok', 2],
        override: false,
      }],
    })
    const store = new SystemPromptsStore(wire)
    await store.load()
    expect(store.store.getSnapshot().prompts).toEqual([
      { id: 'ok', name: 'Ok', text: '' },
      { id: 'named', name: 'Named', text: '' },
    ])
    expect(store.store.getSnapshot().bindings).toEqual([
      { provider: 'p', model: 'm', promptIds: [], override: false },
      { provider: 'p', model: 'n', promptIds: ['ok'], override: false },
    ])
  })

  it('creates a prompt through settings.replace', async () => {
    const wire = api()
    const store = new SystemPromptsStore(wire)
    await store.load()
    store.beginCreate()
    store.setDraftName('Style')
    store.setDraftText('Be concise.')
    await store.saveDraft()
    expect(wire.replace).toHaveBeenCalledWith(
      'user-system-prompts',
      {
        prompts: [{ id: 'style', name: 'Style', text: 'Be concise.' }],
        bindings: [],
        overrides: [],
      },
      1,
    )
    expect(store.store.getSnapshot().draft).toBeNull()
    expect(store.store.getSnapshot().prompts).toHaveLength(1)
  })

  it('closes the draft even when a refresh starts during save', async () => {
    const wire = api()
    const store = new SystemPromptsStore(wire)
    await store.load()
    store.beginCreate()
    store.setDraftName('Style')
    store.setDraftText('Be concise.')
    let finishReplace: ((value: RpcResponse<SettingsNamespaceView>) => void) | undefined
    wire.replace.mockImplementationOnce(() => new Promise((resolve) => {
      finishReplace = resolve
    }))
    const saving = store.saveDraft()
    await store.load()
    const written = view({
      prompts: [{ id: 'style', name: 'Style', text: 'Be concise.' }],
      bindings: [],
      overrides: [],
    }, 2)
    finishReplace?.(ok(written))
    await saving
    expect(store.store.getSnapshot().draft).toBeNull()
    expect(store.store.getSnapshot().status).toBe('ready')
    expect(store.store.getSnapshot().prompts).toEqual([
      { id: 'style', name: 'Style', text: 'Be concise.' },
    ])
  })

  it('refuses an empty draft name', async () => {
    const wire = api()
    const store = new SystemPromptsStore(wire)
    await store.load()
    store.beginCreate()
    store.setDraftText('text')
    await store.saveDraft()
    expect(wire.replace).not.toHaveBeenCalled()
    expect(store.store.getSnapshot().draft?.error).toBe('nameRequired')
  })

  it('writes selected ids and override for one model', async () => {
    const wire = api({
      prompts: [{ id: 'style', name: 'Style', text: 'Be concise.' }],
      bindings: [],
    })
    const store = new SystemPromptsStore(wire)
    await store.load()
    await store.setPromptIds('deepseek-official', 'deepseek-v4-flash', ['style'])
    await store.setOverride('deepseek-official', 'deepseek-v4-flash', true)
    expect(wire.replace.mock.calls.at(-1)?.[1].bindings).toEqual([{
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      promptIds: ['style'],
      override: true,
    }])
  })

  it('edits an existing prompt and cancels a draft', async () => {
    const wire = api({
      prompts: [{ id: 'style', name: 'Style', text: 'Be concise.' }],
      bindings: [],
    })
    const store = new SystemPromptsStore(wire)
    await store.load()
    store.beginEdit('style')
    store.setDraftName('Voice')
    store.setDraftText('Speak plainly.')
    await store.saveDraft()
    expect(wire.replace).toHaveBeenCalledWith(
      'user-system-prompts',
      {
        prompts: [{ id: 'style', name: 'Voice', text: 'Speak plainly.' }],
        bindings: [],
        overrides: [],
      },
      1,
    )
    store.beginCreate()
    store.cancelDraft()
    expect(store.store.getSnapshot().draft).toBeNull()
  })

  it('refuses an empty draft text and reports a failed write', async () => {
    const wire = api()
    const store = new SystemPromptsStore(wire)
    await store.load()
    store.beginCreate()
    store.setDraftName('Style')
    await store.saveDraft()
    expect(store.store.getSnapshot().draft?.error).toBe('textRequired')

    wire.replace.mockRejectedValueOnce(new Error('conflict'))
    store.setDraftText('Be concise.')
    await store.saveDraft()
    expect(store.store.getSnapshot().draft?.error).toBe('conflict')
  })

  it('keeps a shipped-prompt listing error while the library stays editable', async () => {
    const wire = api()
    wire.systemPrompt.list = vi.fn(async () => ({
      rpcId: 'p' as RpcId,
      result: { ok: false, error: { message: 'down' } },
    })) as unknown as typeof wire.systemPrompt.list
    const store = new SystemPromptsStore(wire)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({
      status: 'ready',
      builtInError: 'down',
      builtIns: [],
    })
  })

  it('ignores malformed override and registered-section rows', async () => {
    const wire = api({
      prompts: [],
      bindings: [],
      overrides: [null, { name: 1 }, { name: 'harness:identity', text: 3 }, { name: 'ok' }],
    })
    wire.systemPrompt.list = vi.fn(async () => ok({
      sections: [
        null,
        { name: 1 },
        { name: 'harness:identity', order: -100, text: 'You are an AI agent powered by DeepSeek Harness.', complete: false },
        { name: 'empty', order: 1 },
      ],
    })) as unknown as typeof wire.systemPrompt.list
    const store = new SystemPromptsStore(wire)
    await store.load()
    expect(store.store.getSnapshot().overrides).toEqual([
      { name: 'harness:identity', text: '' },
      { name: 'ok', text: '' },
    ])
    expect(store.store.getSnapshot().builtIns).toEqual([
      {
        name: 'harness:identity',
        order: -100,
        text: '',
        complete: false,
        overridden: true,
      },
      {
        name: 'empty',
        order: 1,
        text: '',
        complete: false,
        overridden: false,
      },
    ])
  })

  it('keeps a catalog error while the library stays editable', async () => {
    const wire = api()
    wire.llm.models = vi.fn(async () => ({
      rpcId: 'm' as RpcId,
      result: { ok: false, error: { message: 'down' } },
    })) as unknown as typeof wire.llm.models
    const store = new SystemPromptsStore(wire)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({
      status: 'ready',
      catalogError: 'down',
      catalog: [],
    })
  })

  it('surfaces a missing namespace and a catalog failure', async () => {
    const store = new SystemPromptsStore({
      settings: {
        describe: vi.fn(async () => ok({ writable: true, hasDocument: true, namespaces: [] })),
        replace: vi.fn(),
      },
      llm: {
        models: vi.fn(async () => ({ rpcId: 'm' as RpcId, result: { ok: false, error: { message: 'catalog down' } } })),
      },
      systemPrompt: { list: vi.fn(async () => ok({ sections: [] })) },
    } as never)
    await store.load()
    expect(store.store.getSnapshot().status).toBe('unavailable')

    const failing = new SystemPromptsStore({
      settings: {
        describe: vi.fn(async () => { throw new Error('describe failed') }),
        replace: vi.fn(),
      },
      llm: { models: vi.fn(async () => ok({ groups: [], failures: [] })) },
      systemPrompt: { list: vi.fn(async () => ok({ sections: [] })) },
    } as never)
    await failing.load()
    expect(failing.store.getSnapshot()).toMatchObject({ status: 'error', error: 'describe failed' })
  })

  it('drops a deleted prompt from every binding', async () => {
    const wire = api({
      prompts: [{ id: 'style', name: 'Style', text: 'Be concise.' }],
      bindings: [{
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        promptIds: ['style'],
        override: false,
      }],
    })
    const store = new SystemPromptsStore(wire)
    await store.load()
    store.confirmDelete('style')
    await store.remove()
    expect(wire.replace).toHaveBeenCalledWith(
      'user-system-prompts',
      { prompts: [], bindings: [], overrides: [] },
      1,
    )
  })

  it('writes and resets a shipped-section override', async () => {
    const wire = api()
    const store = new SystemPromptsStore(wire)
    await store.load()
    store.beginEditBuiltIn('harness:identity')
    store.setDraftText('Custom opener.')
    await store.saveDraft()
    expect(wire.replace).toHaveBeenCalledWith(
      'user-system-prompts',
      {
        prompts: [],
        bindings: [],
        overrides: [{ name: 'harness:identity', text: 'Custom opener.' }],
      },
      1,
    )
    expect(store.store.getSnapshot().builtIns[0]).toMatchObject({
      name: 'harness:identity',
      text: 'Custom opener.',
      overridden: true,
    })
    await store.resetBuiltIn('harness:identity')
    expect(wire.replace.mock.calls.at(-1)?.[1].overrides).toEqual([])
    expect(store.store.getSnapshot().builtIns[0]?.overridden).toBe(false)
  })

  it('does not write a shipped-section reset when nothing is overridden', async () => {
    const wire = api()
    const store = new SystemPromptsStore(wire)
    await store.load()
    store.beginEditBuiltIn('missing')
    expect(store.store.getSnapshot().draft).toBeNull()
    await store.resetBuiltIn('harness:identity')
    expect(wire.replace).not.toHaveBeenCalled()
  })
})
