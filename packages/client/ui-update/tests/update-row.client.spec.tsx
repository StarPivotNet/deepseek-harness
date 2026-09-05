// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { UpdateRow, type ProductUpdateUiStatus, type UpdateRowProps } from '../src/client/UpdateRow.tsx'
import { UpdateToast, type UpdateToastProps } from '../src/client/UpdateToast.tsx'
import { en } from '../src/client/locales.ts'

type AttentionSnapshot = Parameters<Parameters<UpdateRowProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: UpdateRowProps['useSessionPendingInteraction'] = selector => selector(noAttention)
const runtime = {
  useSessions: (() => { throw new Error('unused') }) as never,
  useSessionPendingInteraction,
  useWorkspaces: (() => { throw new Error('unused') }) as never,
}

afterEach(cleanup)

const latest = {
  tag: 'dsh-v1.2.4',
  version: '1.2.4',
  url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v1.2.4',
  notes: 'notes',
}

const desktopLatest = {
  tag: 'desktop-v1.2.4',
  version: '1.2.4',
  url: 'https://github.com/StarPivotNet/deepseek-harness/releases/tag/desktop-v1.2.4',
  notes: 'notes',
  artifact: {
    name: 'DeepSeek Harness-1.2.4-win.zip',
    url: 'https://github.com/StarPivotNet/deepseek-harness/releases/download/desktop-v1.2.4/DeepSeek%20Harness-1.2.4-win.zip',
    sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    size: 100,
    platform: 'win32' as const,
  },
}

function mountRow(status: ProductUpdateUiStatus, canInstall = false) {
  const checkNow = vi.fn()
  const dismiss = vi.fn()
  const openRelease = vi.fn()
  const installNow = vi.fn()
  const cancelInstall = vi.fn()
  const relaunchToUpdate = vi.fn()
  const props: UpdateRowProps = {
    ...runtime,
    useStatus: bindSnapshotSelector(createSnapshotStore(status)),
    checkNow,
    dismiss,
    openRelease,
    canInstall: () => canInstall,
    installNow,
    cancelInstall,
    relaunchToUpdate,
    t: makeTranslate(en),
  }
  render(<UpdateRow {...props} />)
  return { checkNow, dismiss, openRelease, installNow, cancelInstall, relaunchToUpdate }
}

function mountToast(status: ProductUpdateUiStatus, canInstall = false) {
  const dismiss = vi.fn()
  const openRelease = vi.fn()
  const installNow = vi.fn()
  const cancelInstall = vi.fn()
  const relaunchToUpdate = vi.fn()
  const props: UpdateToastProps = {
    ...runtime,
    useStatus: bindSnapshotSelector(createSnapshotStore(status)),
    dismiss,
    openRelease,
    canInstall: () => canInstall,
    installNow,
    cancelInstall,
    relaunchToUpdate,
    t: makeTranslate(en),
  }
  render(<UpdateToast {...props} />)
  return { dismiss, openRelease, installNow, cancelInstall, relaunchToUpdate }
}

describe('UpdateRow', () => {
  it('explains the check and keeps Check now enabled while idle', () => {
    mountRow({ checking: false, error: false, result: undefined })
    expect(screen.getByText('Product updates')).toBeDefined()
    expect(screen.getByText(/Checking itself does not download/)).toBeDefined()
    expect(screen.getByText('Not checked yet')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Check now' })).toBeDefined()
  })

  it('shows an available update and forwards Check now, Open, and Dismiss', () => {
    const b = mountRow({
      checking: false,
      error: false,
      result: {
        available: true,
        currentVersion: '1.2.3',
        latest,
        checkedAt: 1_700_000_000_000,
        channel: 'dsh',
      },
    })
    expect(screen.getByText('Installed version: 1.2.3')).toBeDefined()
    expect(screen.getByText('Last checked: ' + new Date(1_700_000_000_000).toLocaleString())).toBeDefined()
    expect(screen.getByText('Update available: 1.2.4')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open release notes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(b.checkNow).toHaveBeenCalledOnce()
    expect(b.openRelease).toHaveBeenCalledOnce()
    expect(b.dismiss).toHaveBeenCalledOnce()
  })

  it('disables Check now while checking and reports a failure', () => {
    mountRow({ checking: true, error: false, result: undefined })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Check now' }).disabled).toBe(true)
    expect(screen.getByText('Checking…')).toBeDefined()
    cleanup()
    mountRow({ checking: false, error: true, result: undefined })
    expect(screen.getByText('Could not check for updates.')).toBeDefined()
  })

  it('reports up to date and dismissed states', () => {
    mountRow({
      checking: false,
      error: false,
      result: { available: false, currentVersion: '1.2.3', checkedAt: 1, channel: 'dsh' },
    })
    expect(screen.getByText('You are on the latest release.')).toBeDefined()
    cleanup()
    mountRow({
      checking: false,
      error: false,
      result: { available: false, currentVersion: '1.2.3', latest, checkedAt: 1, channel: 'dsh' },
    })
    expect(screen.getByText('This release was dismissed.')).toBeDefined()
  })

  it('offers Install only when a packaged desktop artifact is present', () => {
    const idle = {
      checking: false,
      error: false,
      result: {
        available: true,
        currentVersion: '1.2.3',
        latest: desktopLatest,
        checkedAt: 1,
        channel: 'desktop' as const,
      },
    }
    mountRow(idle, false)
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    cleanup()
    const b = mountRow(idle, true)
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(b.installNow).toHaveBeenCalledOnce()
    cleanup()
    const downloading = mountRow({
      ...idle,
      install: { phase: 'downloading', received: 40, total: 100 },
    }, true)
    expect(screen.getByText('Downloading… 40%')).toBeDefined()
    expect(screen.getByRole('progressbar')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(downloading.cancelInstall).toHaveBeenCalledOnce()
    cleanup()
    const ready = mountRow({
      ...idle,
      install: { phase: 'ready', received: 100, total: 100 },
    }, true)
    expect(screen.getByText('Update downloaded. Restart to apply it.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(ready.relaunchToUpdate).toHaveBeenCalledOnce()
    cleanup()
    mountRow({
      ...idle,
      install: { phase: 'error', received: 0, total: 0 },
    }, true)
    expect(screen.getByText('Could not install the update.')).toBeDefined()
    cleanup()
    mountRow({
      ...idle,
      install: { phase: 'verifying', received: 100, total: 100 },
    }, true)
    expect(screen.getByText('Downloading the update…')).toBeDefined()
  })
})

describe('UpdateToast', () => {
  it('renders nothing when no update is available', () => {
    mountToast({ checking: false, error: false, result: undefined })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders the toast and forwards Open and Dismiss', () => {
    const b = mountToast({
      checking: false,
      error: false,
      result: { available: true, currentVersion: '1.2.3', latest, checkedAt: 1, channel: 'dsh' },
    })
    expect(screen.getByRole('status').textContent).toContain('Version 1.2.4 is available.')
    fireEvent.click(screen.getByRole('button', { name: 'Release notes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(b.openRelease).toHaveBeenCalledOnce()
    expect(b.dismiss).toHaveBeenCalledOnce()
  })

  it('offers Install on the toast when a packaged desktop artifact is present', () => {
    const idle = {
      checking: false,
      error: false,
      result: {
        available: true,
        currentVersion: '1.2.3',
        latest: desktopLatest,
        checkedAt: 1,
        channel: 'desktop' as const,
      },
    }
    const b = mountToast(idle, true)
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(b.installNow).toHaveBeenCalledOnce()
    cleanup()
    const ready = mountToast({
      ...idle,
      install: { phase: 'ready', received: 100, total: 100 },
    }, true)
    expect(screen.getByText('Update downloaded. Restart to apply it.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(ready.relaunchToUpdate).toHaveBeenCalledOnce()
    cleanup()
    const downloading = mountToast({
      ...idle,
      install: { phase: 'downloading', received: 10, total: 100 },
    }, true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(downloading.cancelInstall).toHaveBeenCalledOnce()
    cleanup()
    mountToast({
      ...idle,
      install: { phase: 'error', received: 0, total: 0 },
    }, true)
    expect(screen.getByText('Could not install the update.')).toBeDefined()
  })
})
