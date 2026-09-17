// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { GeneralSectionComponentProps } from '../src/client/GeneralSection.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import { HostStartMeta } from '../src/client/HostStartMeta.tsx'
import type { TriggerContentProps } from '../src/client/chrome.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

/** Store over a real mirror derived from the same scripted context. */
function derivedDocumentStore(remote: object) {
  const ctx = { remote } as never
  return new SettingsDocumentStore(ctx, new SettingsDescribeMirror(ctx))
}
import { en } from '../src/client/locales.ts'
import { DesktopUpdateBadge } from '../src/client/DesktopUpdateIndicator.tsx'
import type { DesktopUpdateView } from '../src/client/desktop-update-bridge.ts'

afterEach(cleanup)

// The seat's key domain is settings ∪ common; the stub answers from the
// package dictionary and falls back to the key like the real chain.
const t: TriggerContentProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

// Global standard kit stubs: none of these components consume the hooks.
const unusedHook = (() => { throw new Error('unused by settings-general components') }) as never
type AttentionSnapshot = Parameters<Parameters<TriggerContentProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: TriggerContentProps['useSessionStatus'] = selector => selector(noAttention)
const kit = {
  useSessions: unusedHook, useSessionStatus,
  usePanelInfo, useSessionRetainInfo: () => undefined, useResource, useWorkspaces: unusedHook,
}

describe('Desktop collapsed update badge', () => {
  it('shows update status, marks failures, and yields to connection feedback', () => {
    let state: DesktopUpdateView = { failed: false, opening: false }
    let connection: 'connected' | 'connecting' | 'disconnected' = 'connected'
    const props = { ...kit, t,
      useDesktopUpdate: (select => select(state)) as Parameters<typeof DesktopUpdateBadge>[0]['useDesktopUpdate'],
      useConnectionState: (select => select(connection)) as Parameters<typeof DesktopUpdateBadge>[0]['useConnectionState'],
    }
    const view = render(<DesktopUpdateBadge {...props} />)
    expect(screen.queryByRole('img')).toBeNull()
    state = { ...state, presentation: { phase: 'available', version: '1.0.1' } }
    view.rerender(<DesktopUpdateBadge {...props} />)
    expect(screen.getByRole('img', { name: 'Update' }).getAttribute('data-error')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    state = { ...state, failed: true }
    view.rerender(<DesktopUpdateBadge {...props} />)
    expect(screen.getByRole('img', { name: en['desktop.update.retry'] }).getAttribute('data-error')).toBe('true')
    state = { failed: true, opening: false }
    view.rerender(<DesktopUpdateBadge {...props} />)
    expect(screen.getByRole('img', { name: en['desktop.update.retry'] }).getAttribute('data-error')).toBe('true')
    state = { failed: false, opening: false, presentation: { phase: 'error', failure: 'install' } }
    view.rerender(<DesktopUpdateBadge {...props} />)
    expect(screen.getByRole('img', { name: en['desktop.update.retry'] }).getAttribute('data-error')).toBe('true')
    for (const value of ['connecting', 'disconnected'] as const) {
      connection = value
      view.rerender(<DesktopUpdateBadge {...props} />)
      expect(screen.queryByRole('img')).toBeNull()
    }
  })
})

function connectionGeneration(home?: string): TriggerContentProps['useConnectionGeneration'] {
  return selector => selector(home === undefined ? undefined : { id: 1, host: { home } })
}

describe('chrome content', () => {
  it('TriggerContent shows the account chip, name, and settings glyph in the wide column', () => {
    const { container } = render(
      <TriggerContent {...kit} wide t={t} useConnectionGeneration={connectionGeneration('/Users/cat7street')} />,
    )
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.getByText('C')).toBeTruthy()
    expect(screen.getByText('cat7street')).toBeTruthy()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('TriggerContent paints only the account chip on the account part', () => {
    const { container } = render(
      <TriggerContent {...kit} wide part="account" t={t} useConnectionGeneration={connectionGeneration('/Users/cat7street')} />,
    )
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText('C')).toBeTruthy()
    expect(screen.getByText('cat7street')).toBeTruthy()
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('TriggerContent paints only the settings glyph on the settings part', () => {
    const { container } = render(
      <TriggerContent {...kit} wide part="settings" t={t} useConnectionGeneration={connectionGeneration('/Users/cat7street')} />,
    )
    expect(container.querySelector('svg')).toBeTruthy()
    expect(screen.queryByText('C')).toBeNull()
    expect(screen.queryByText('cat7street')).toBeNull()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('TriggerContent falls back to Local when Host home is absent and hides the name on the rail', () => {
    const { container } = render(
      <TriggerContent {...kit} wide={false} t={t} useConnectionGeneration={connectionGeneration()} />,
    )
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText('L')).toBeTruthy()
    expect(screen.queryByText('Local')).toBeNull()
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('HeaderContent and CloseLabel render their translated text', () => {
    render(<HeaderContent {...kit} t={t} />)
    render(<CloseLabel {...kit} t={t} />)
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Close')).toBeTruthy()
  })

  it('HostStartMeta stays empty until a ready start count exists', () => {
    const { rerender } = render(<HostStartMeta meta={{ status: 'loading', startCount: 0 }} t={t} />)
    expect(screen.queryByText(/launched/)).toBeNull()
    rerender(<HostStartMeta
      meta={{ status: 'ready', startCount: 2, startedAt: '2026-08-29T00:17:56.000Z' }}
      t={t}
    />)
    expect(screen.getByText(/launched 2 times/).textContent).toContain('Started')
  })
})

describe('GeneralSection', () => {
  function mount() {
    const renderSlot = vi.fn(
      ((key: string) => <div data-testid={`slot-${key}`} />) as GeneralSectionComponentProps['renderSlot'],
    )
    const props: GeneralSectionComponentProps = { ...kit, renderSlot, close: vi.fn() }
    const view = render(<GeneralSection {...props} />)
    return { view, renderSlot }
  }

  it('renders the item slot as the section body', () => {
    const { renderSlot } = mount()
    expect(renderSlot).toHaveBeenCalledWith('settings.general.item', {})
    expect(screen.getByTestId('slot-settings.general.item')).toBeTruthy()
  })
})

describe('SettingsDocumentAction', () => {
  it('appears only for a file-backed provider and requests its Host-owned document', async () => {
    const openDocument = vi.fn(() => Promise.resolve({
      ok: true as const, value: { opened: true as const },
    }))
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          ok: true as const,
          value: { writable: true, hasDocument: true, namespaces: [] },
        })),
        openSettingsDocument: openDocument,
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    const action = await screen.findByRole('button', { name: 'Open configuration file' })
    fireEvent.click(action)
    await waitFor(() => { expect(openDocument).toHaveBeenCalledWith() })
  })

  it('stays absent without a document and follows a mirror refresh to available', async () => {
    const describe = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } })
      .mockResolvedValueOnce({ ok: true as const, value: { writable: true, hasDocument: true, namespaces: [] } })
    const ctx = { remote: { settings: { describe, openSettingsDocument: vi.fn() } } } as never
    const mirror = new SettingsDescribeMirror(ctx)
    const controller = new SettingsDocumentStore(ctx, mirror)
    const first = render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(screen.queryByRole('button', { name: 'Open configuration file' })).toBeNull()
    first.unmount()
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    // A remount alone re-reads nothing; availability moves with the mirror's
    // own refresh (a document commit or reconnect in production).
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(describe).toHaveBeenCalledTimes(1)
    await mirror.load()
    expect(await screen.findByRole('button', { name: 'Open configuration file' })).toBeTruthy()
    expect(describe).toHaveBeenCalledTimes(2)
  })

  it('keeps the action available and reports a native-open failure', async () => {
    const controller = derivedDocumentStore({
      settings: {
        describe: vi.fn(() => Promise.resolve({
          ok: true as const,
          value: { writable: true, hasDocument: true, namespaces: [] },
        })),
        openSettingsDocument: vi.fn(() => Promise.resolve({
          ok: false as const,
          error: new RemoteError('gateway/internal', 'xdg-open missing', {}),
        })),
      },
    })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open configuration file')
    expect(screen.getByRole('button', { name: 'Open configuration file' })).toBeTruthy()
  })
})
