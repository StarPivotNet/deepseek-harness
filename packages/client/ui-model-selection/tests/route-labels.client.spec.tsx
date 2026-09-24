// @vitest-environment jsdom
/**
 * The two read-only route labels: the session header's identity chip
 * (requestRoute projection → catalog display name + effort segment) and the
 * per-step clock line (provenance preferred over requestConfig). Both render
 * from LOGGED identity with the composer trigger's resolution (groups →
 * models → name; effort name-by-id over `model.reasoning.efforts`), degrade
 * to raw ids on a catalog miss, and paint nothing without an identity to
 * name. Direct props + driven stores, the model-select spec's lane.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComponentProps } from 'react'
import type { RequestRouteProjection } from '@deepseek-ai/dsh-session-route/client'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelIdentityLabel } from '../src/client/ModelIdentityLabel.tsx'
import { ModelRouteLine } from '../src/client/ModelRouteLine.tsx'
import { zh } from '../src/client/locales.ts'

// Same lookup chain as the model-select spec: package dictionary, then key.
const t = ((key: string, params?: Record<string, string>) => {
  const template = (zh as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}) as ComponentProps<typeof ModelIdentityLabel>['t']

const efforts = [
  { id: 'off', name: 'Off' },
  { id: 'high', name: 'High' },
]

function directoryState(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: null,
    routable: null,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning: { efforts, defaultEffort: 'high' } },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }],
    failures: [],
    status: 'ready',
    pending: null,
    error: null,
    ...overrides,
  }
}

function renderLabel(
  route: RequestRouteProjection | null | undefined,
  state: Partial<ModelDirectoryState> = {},
) {
  const store = createSnapshotStore<ModelDirectoryState>(directoryState(state))
  const load = vi.fn()
  const useProjection = vi.fn(() => route)
  const view = render(<ModelIdentityLabel {...({
    load,
    useDirectory: bindSnapshotSelector(store),
    useProjection,
    t,
  } as unknown as ComponentProps<typeof ModelIdentityLabel>)} />)
  return { load, view }
}

afterEach(cleanup)

describe('ModelIdentityLabel (session header chip)', () => {
  it('renders the catalog display name and the effort segment of the last dispatched route', () => {
    renderLabel({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })
    const chip = screen.getByTitle(zh['identity.headerTitle'].replace('{route}', 'deepseek-official / deepseek-v4-flash'))
    expect(chip.textContent).toBe('DeepSeek-V4-Flash · High')
    expect(chip.querySelector(':scope > span:last-child')?.textContent).toBe(' · High')
  })

  it('falls back to the raw model and effort ids when the catalog misses', () => {
    renderLabel({ provider: 'other-provider', model: 'unlisted-model', reasoningEffort: 'weird' })
    // A route serving a model it stopped advertising is real: raw ids, not blank.
    expect(screen.getByTitle(zh['identity.headerTitle'].replace('{route}', 'other-provider / unlisted-model')).textContent)
      .toBe('unlisted-model · weird')
  })

  it('omits the effort segment when the logged header carried none', () => {
    renderLabel({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(screen.getByTitle(zh['identity.headerTitle'].replace('{route}', 'deepseek-official / deepseek-v4-pro')).textContent)
      .toBe('DeepSeek-V4-Pro')
  })

  it('renders the raw effort id when the model exists but the vocabulary lacks the level', () => {
    renderLabel({ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'extreme' })
    expect(screen.getByTitle(/deepseek-v4-flash/).textContent).toBe('DeepSeek-V4-Flash · extreme')
  })

  it('renders nothing before the first request header and while the projection is absent', () => {
    for (const absent of [null, undefined]) {
      const { view } = renderLabel(absent)
      expect(view.container.textContent).toBe('')
    }
  })

  it('primes the directory load at mount so names resolve without the composer menu', () => {
    const { load } = renderLabel({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('ModelRouteLine (per-step clock line)', () => {
  const renderLine = (
    owner: { requestConfig?: object; provenance?: object },
    state: Partial<ModelDirectoryState> = {},
  ) => {
    const store = createSnapshotStore<ModelDirectoryState>(directoryState(state))
    const load = vi.fn()
    const view = render(<ModelRouteLine {...({
      ...owner,
      load,
      useDirectory: bindSnapshotSelector(store),
      t,
    } as unknown as ComponentProps<typeof ModelRouteLine>)} />)
    return { load, view }
  }

  it('prefers the serving message provenance and takes the effort from the request config', () => {
    const { view } = renderLine({
      provenance: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      requestConfig: { provider: 'stale-provider', model: 'stale-model', reasoningEffort: 'high' },
    })
    expect(view.container.textContent).toBe('DeepSeek-V4-Flash · High')
  })

  it('falls back to the governing request config when the message carried no source', () => {
    const { view } = renderLine({
      requestConfig: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'off' },
    })
    expect(view.container.textContent).toBe('DeepSeek-V4-Flash · Off')
  })

  it('renders the raw effort id when the model carries no adapter vocabulary', () => {
    const { view } = renderLine({
      requestConfig: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'off' },
    })
    expect(view.container.textContent).toBe('DeepSeek-V4-Pro · off')
  })

  it('renders no effort segment when the header logged none', () => {
    const { view } = renderLine({
      provenance: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      requestConfig: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    })
    expect(view.container.textContent).toBe('DeepSeek-V4-Pro')
  })

  it('degrades to raw ids on a catalog miss', () => {
    const { view } = renderLine({
      provenance: { provider: 'gone', model: 'gone-model' },
      requestConfig: { provider: 'gone', model: 'gone-model', reasoningEffort: 'high' },
    })
    expect(view.container.textContent).toBe('gone-model · high')
  })

  it('renders nothing when neither share is present', () => {
    const { view } = renderLine({})
    expect(view.container.textContent).toBe('')
  })

  it('primes the directory load at mount', () => {
    const { load } = renderLine({ provenance: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } })
    expect(load).toHaveBeenCalledTimes(1)
  })
})
