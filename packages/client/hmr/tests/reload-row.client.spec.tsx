// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ReloadRow } from '../src/client/ReloadRow.tsx'
import type { ReloadRowProps } from '../src/client/ReloadRow.tsx'
import { ClientHmrReloadPolicy } from '../src/client/reload-policy.ts'
import { en } from '../src/client/locales.ts'

const useResource = (() => ({
  status: 'none' as const, value: undefined, failure: undefined, reload: () => {},
})) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    projectionsBySession: {},
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], hiddenWorkspaceIds: [],
    state: 'idle', phase: 'ready', error: null,
  }))
}

function mount(reloadPlugins = vi.fn(async () => 2)) {
  const policy = new ClientHmrReloadPolicy()
  const setAutoReload = vi.fn((enabled: boolean) => { policy.setAutoReload(enabled) })
  const props: ReloadRowProps = {
    usePanelInfo,
    useSessions: emptySessions(),
    useSessionStatus: selector => selector(new Map()),
    useSessionRetainInfo: () => undefined,
    useResource,
    useWorkspaces: emptyWorkspaces(),
    useAutoReload: bindSnapshotSelector(policy.autoReload),
    setAutoReload,
    reloadPlugins,
    t: makeTranslate(en),
  }
  render(<ReloadRow {...props} />)
  return { policy, setAutoReload, reloadPlugins }
}

describe('ReloadRow', () => {
  it('explains manual reload and keeps automatic reload off by default', () => {
    mount()
    expect(screen.getByText('Plugin hot reload')).toBeDefined()
    expect(screen.getByText(/saving source does not replace running plugins/)).toBeDefined()
    expect(screen.getByRole('switch', { name: 'Automatic hot reload' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('button', { name: 'Reload plugins' })).toBeDefined()
  })

  it('toggles automatic reload and reports a successful manual reload', async () => {
    const b = mount()
    fireEvent.click(screen.getByRole('switch', { name: 'Automatic hot reload' }))
    expect(b.setAutoReload).toHaveBeenCalledWith(true)
    expect(screen.getByRole('switch', { name: 'Automatic hot reload' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Reload plugins' }))
    expect(b.reloadPlugins).toHaveBeenCalledOnce()
    expect(await screen.findByText('Reloaded 2 plugins')).toBeDefined()
  })

  it('reports a failed manual reload', async () => {
    mount(vi.fn(async () => { throw new Error('nope') }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload plugins' }))
    expect(await screen.findByText('Reload failed')).toBeDefined()
  })

  it('follows a later preference change from the policy', () => {
    const b = mount()
    act(() => { b.policy.setAutoReload(true) })
    expect(screen.getByRole('switch', { name: 'Automatic hot reload' }).getAttribute('aria-checked')).toBe('true')
  })
})
