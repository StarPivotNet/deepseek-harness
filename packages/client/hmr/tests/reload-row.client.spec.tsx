// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ReloadRow } from '../src/client/ReloadRow.tsx'
import type { ReloadRowProps } from '../src/client/ReloadRow.tsx'
import { ClientHmrReloadPolicy } from '../src/client/reload-policy.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], hiddenWorkspaceIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

function mount(reloadPlugins = vi.fn(async () => 2)) {
  const policy = new ClientHmrReloadPolicy()
  const setAutoReload = vi.fn((enabled: boolean) => { policy.setAutoReload(enabled) })
  const props: ReloadRowProps = {
    useSessions: emptySessions(),
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
