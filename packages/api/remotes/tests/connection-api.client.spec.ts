/** Historical connection.api projection over ctx.remote llm/settings. */
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { LlmConfigurableProvider, LlmProviderInfo } from '@deepseek-ai/dsh-llm/types'
import type { SettingsDescribeValue } from '@deepseek-ai/dsh-settings/types'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  catalogFromDescribe,
  createConnectionApi,
  installConnectionApi,
  joinHistoricalProviders,
} from '../src/client/connection-api.ts'

function ok<T>(value: T): RemoteResult<T> {
  return { ok: true, value }
}

function fail(message: string): RemoteResult<never> {
  return { ok: false, error: new RemoteError('gateway/internal', message, {}) }
}

const registered: LlmProviderInfo[] = [
  { id: 'fac', name: 'FAC' },
  { id: 'orphan', name: 'Orphan' },
]

const declared: LlmConfigurableProvider[] = [
  { provider: 'fac', displayName: 'FAC', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'fac'] },
  { provider: 'dormant', displayName: 'Dormant', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'dormant'] },
]

const describeValue: SettingsDescribeValue = {
  writable: true,
  hasDocument: true,
  namespaces: [{
    ns: 'llm-pi-ai',
    schema: {},
    value: {
      providers: {
        fac: {
          models: [
            { id: 'grok-4.6', name: 'Grok 4.6' },
            { id: 12 },
            { id: '' },
            { id: 'glm-5.3' },
          ],
        },
        dormant: {
          models: [{ id: 'sleeping' }],
        },
      },
    },
    autoGenerate: false, applies: 'live',
    secrets: [],
    revision: 3,
  }],
}

describe('joinHistoricalProviders', () => {
  it('marks declared routes live or dormant and appends undeclared live routes', () => {
    expect(joinHistoricalProviders(registered, declared)).toEqual([
      { provider: 'fac', displayName: 'FAC', settingsNs: 'llm-pi-ai', active: true },
      { provider: 'dormant', displayName: 'Dormant', settingsNs: 'llm-pi-ai', active: false },
      { provider: 'orphan', displayName: 'Orphan', settingsNs: '', active: true },
    ])
  })
})

describe('catalogFromDescribe', () => {
  it('keeps advertised models on live llm-pi-ai routes and drops dormant groups', () => {
    expect(catalogFromDescribe(describeValue, registered, declared)).toEqual({
      groups: [{
        id: 'fac',
        name: 'FAC',
        models: [
          { id: 'grok-4.6', name: 'Grok 4.6' },
          { id: 'glm-5.3', name: 'glm-5.3' },
        ],
      }],
      failures: [],
    })
  })

  it('uses the live route name when the directory has no matching row', () => {
    const settings: SettingsDescribeValue = {
      writable: true,
      hasDocument: true,
      namespaces: [{
        ns: 'llm-pi-ai',
        schema: {},
        value: { providers: { orphan: { models: [{ id: 'solo' }] } } },
        autoGenerate: false, applies: 'live',
        secrets: [],
        revision: 1,
      }],
    }
    expect(catalogFromDescribe(settings, registered, declared).groups).toEqual([
      { id: 'orphan', name: 'Orphan', models: [{ id: 'solo', name: 'solo' }] },
    ])
  })

  it('returns no groups when llm-pi-ai is absent or a live profile has no model list', () => {
    expect(catalogFromDescribe({
      writable: true,
      hasDocument: true,
      namespaces: [],
    }, registered, declared)).toEqual({ groups: [], failures: [] })
    expect(catalogFromDescribe({
      writable: true,
      hasDocument: true,
      namespaces: [{
        ns: 'llm-pi-ai',
        schema: {},
        value: { providers: { fac: { models: 'none' } } },
        autoGenerate: false, applies: 'live',
        secrets: [],
        revision: 1,
      }],
    }, registered, declared)).toEqual({ groups: [], failures: [] })
  })
})

describe('createConnectionApi', () => {
  it('wraps llm.providers, llm.models, and settings.describe/update', async () => {
    const listProviders = vi.fn(async () => ok(registered))
    const listConfigurableProviders = vi.fn(async () => ok(declared))
    const describe = vi.fn(async () => ok(describeValue))
    const update = vi.fn(async () => ok(describeValue.namespaces[0]!))
    const api = createConnectionApi({
      llm: { listProviders, listConfigurableProviders },
      settings: { describe, update },
    } as never)

    const providers = await api.llm.providers({})
    expect(providers.result.ok).toBe(true)
    if (providers.result.ok) {
      expect(providers.result.value.providers.map(entry => entry.provider)).toEqual(['fac', 'dormant', 'orphan'])
    }

    const models = await api.llm.models({})
    expect(models.result.ok).toBe(true)
    if (models.result.ok) {
      expect(models.result.value.groups).toHaveLength(1)
      expect(models.result.value.groups[0]!.models.map(model => model.id)).toEqual(['grok-4.6', 'glm-5.3'])
    }

    const described = await api.settings.describe({})
    expect(described.result).toEqual(ok(describeValue))

    const written = await api.settings.update({
      ns: 'dsh-auxiliary',
      patch: { tool: { enabled: true } },
      expectedRevision: 1,
    })
    expect(update).toHaveBeenCalledWith('dsh-auxiliary', { tool: { enabled: true } }, 1)
    expect(written.result.ok).toBe(true)
  })

  it('forwards a Remote failure without throwing', async () => {
    const providersFail = createConnectionApi({
      llm: {
        listProviders: async () => fail('providers down'),
        listConfigurableProviders: async () => ok(declared),
      },
      settings: {
        describe: async () => ok(describeValue),
        update: async () => fail('write refused'),
      },
    } as never)
    expect((await providersFail.llm.providers()).result).toEqual(fail('providers down'))
    expect((await providersFail.settings.update({ ns: 'dsh-auxiliary', patch: {} })).result)
      .toEqual(fail('write refused'))

    const declaredFail = createConnectionApi({
      llm: {
        listProviders: async () => ok(registered),
        listConfigurableProviders: async () => fail('directory down'),
      },
      settings: {
        describe: async () => fail('describe down'),
        update: async () => fail('write refused'),
      },
    } as never)
    expect((await declaredFail.llm.providers()).result).toEqual(fail('directory down'))
    expect((await declaredFail.llm.models()).result).toEqual(fail('directory down'))
    expect((await declaredFail.settings.describe()).result).toEqual(fail('describe down'))

    const describeFail = createConnectionApi({
      llm: {
        listProviders: async () => ok(registered),
        listConfigurableProviders: async () => ok(declared),
      },
      settings: {
        describe: async () => fail('describe down'),
        update: async () => fail('write refused'),
      },
    } as never)
    expect((await describeFail.llm.models()).result).toEqual(fail('describe down'))

    const providersFailOnModels = createConnectionApi({
      llm: {
        listProviders: async () => fail('providers down'),
        listConfigurableProviders: async () => ok(declared),
      },
      settings: {
        describe: async () => ok(describeValue),
        update: async () => fail('write refused'),
      },
    } as never)
    expect((await providersFailOnModels.llm.models()).result).toEqual(fail('providers down'))
  })
})

describe('installConnectionApi', () => {
  const remote = {
    llm: {
      listProviders: async () => ok(registered),
      listConfigurableProviders: async () => ok(declared),
    },
    settings: {
      describe: async () => ok(describeValue),
      update: async () => ok(describeValue.namespaces[0]!),
    },
  } as never

  it('installs the face and restores the previous slot on dispose', () => {
    const connection = {} as ConnectionHandle
    const uninstall = installConnectionApi(connection, remote)
    expect(connection.api?.llm.providers).toEqual(expect.any(Function))
    uninstall()
    expect(connection.api).toBeUndefined()
  })

  it('restores a previously installed face', () => {
    const previous = { llm: {}, settings: {} } as ConnectionHandle['api']
    const connection = { api: previous } as ConnectionHandle
    const uninstall = installConnectionApi(connection, remote)
    expect(connection.api).not.toBe(previous)
    uninstall()
    expect(connection.api).toBe(previous)
  })
})
