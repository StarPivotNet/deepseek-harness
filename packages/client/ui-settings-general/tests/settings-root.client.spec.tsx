// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SettingsRootComponentProps } from '../src/client/shell-contract.ts'
import { SettingsRoot } from '../src/client/SettingsRoot.tsx'
import { en } from '../src/client/locales.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

type Row = { id: string; order: number; label: string }
type Step = { id: string; order: number }

/** Slot-content stand-ins: the shell renders whatever the seats contribute. */
const SEAT_CONTENT: Record<string, string> = {
  'settings.trigger': 'Settings',
  'settings.header': 'Settings Title',
  'settings.action': 'Open configuration file',
  'settings.close': 'Close',
}

type AttentionSnapshot = Parameters<Parameters<SettingsRootComponentProps['useSessionPendingInteraction']>[0]>[0]
type ConnectionSnapshot = Parameters<Parameters<SettingsRootComponentProps['useConnectionState']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: SettingsRootComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount({
  wide = true,
  connectionState = 'connected',
  onboardingActive = true,
  themePreference = 'system',
  fontSize = 14,
  localePreference = 'en' as string | undefined,
  extraLocales = [] as Array<{ id: string; label: string }>,
  rows = [
    { id: 'general', order: 0, label: 'General' },
    { id: 'models', order: 10, label: 'Models' },
    { id: 'agent-presets', order: 20, label: 'Agent presets' },
  ],
  steps = [
    { id: 'welcome', order: -100 },
    { id: 'credential', order: 0 },
  ],
}: {
  wide?: boolean
  connectionState?: ConnectionSnapshot
  onboardingActive?: boolean
  themePreference?: 'light' | 'dark' | 'system'
  fontSize?: number
  localePreference?: string | undefined
  extraLocales?: Array<{ id: string; label: string }>
  rows?: Row[]
  steps?: Step[]
} = {}) {
  // Mutable row source standing in for the bound useSections hook; bump()
  // plays a ledger change through the same observable contract.
  let current = rows
  let currentConnectionState = connectionState
  const listeners = new Set<() => void>()
  const connectionListeners = new Set<() => void>()
  const reconnect = vi.fn()
  const setLocale = vi.fn()
  const clearLocale = vi.fn()
  const setTheme = vi.fn()
  const setFontSize = vi.fn()
  const renderSlot = vi.fn(
    ((key: string, owner?: { part?: 'account' | 'settings' }, opts?: { only?: string }) => {
      if (key === 'settings.section') return <div data-testid={`section-${opts?.only ?? 'all'}`} />
      if (key === 'settings.trigger' && owner?.part === 'account') return null
      return SEAT_CONTENT[key]
    }) as SettingsRootComponentProps['renderSlot'],
  )
  const useSessions = ((select: (state: unknown) => unknown) => select(onboardingActive
    ? { phase: 'ready', current: undefined, byId: {} }
    : {
      phase: 'ready',
      current: 'active-session',
      byId: { 'active-session': { blank: false } },
    })) as never
  const unusedHook = (() => { throw new Error('unused by SettingsRoot') }) as never
  const props: SettingsRootComponentProps = {
    useSessions,
    useSessionPendingInteraction,
    usePanelInfo, useResource,
    useWorkspaces: unusedHook,
    wide,
    reconnect,
    setLocale,
    clearLocale,
    setTheme,
    setFontSize,
    useLocale: select => select({
      active: localePreference === undefined ? 'en' : localePreference,
      preference: localePreference,
      locales: [{ id: 'en', label: 'English' }, { id: 'zh', label: '中文' }, ...extraLocales],
      revision: 1,
    }),
    useTheme: select => select({
      preference: themePreference,
      fontSize,
      active: { id: 'light', colorScheme: 'light', tokens: {} },
      themes: [],
      revision: 1,
    }),
    t: (key, params) => {
      if (key === 'hostStart.meta') return `Started ${String(params?.['time'])} · launched ${String(params?.['count'])} times`
      const translated = makeTranslate(en)(key, params)
      return translated
    },
    useHostStart: select => select({
      status: 'ready',
      startCount: 3,
      startedAt: '2026-08-29T00:17:56.000Z',
    }),
    useConnectionState: (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => { force(n => n + 1) }
        connectionListeners.add(listener)
        return () => { connectionListeners.delete(listener) }
      }, [])
      return select(currentConnectionState)
    },
    useOnboardingSteps: select => select(steps),
    useSections: (select) => {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => { force(n => n + 1) }
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }, [])
      return select(current)
    },
    renderSlot,
  }
  const view = render(<SettingsRoot {...props} />)
  const bump = (next: Row[]) => {
    act(() => {
      current = next
      for (const fn of [...listeners]) fn()
    })
  }
  const setConnectionState = (next: typeof currentConnectionState) => {
    act(() => {
      currentConnectionState = next
      for (const fn of [...connectionListeners]) fn()
    })
  }
  return { view, renderSlot, bump, listeners, reconnect, setLocale, clearLocale, setTheme, setFontSize, setConnectionState }
}

function openPanel() {
  const trigger = screen.getByRole('button', { name: 'Settings' })
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}

describe('SettingsRoot trigger', () => {
  it('renders the trigger seat content as the accessible name (no aria-label of its own)', () => {
    const { renderSlot } = mount()
    const trigger = screen.getByRole('button', { name: 'Settings' })
    expect(trigger.hasAttribute('aria-label')).toBe(false)
    expect(renderSlot).toHaveBeenCalledWith('settings.trigger', { wide: true, part: 'settings' })
    expect(renderSlot).toHaveBeenCalledWith('settings.trigger', { wide: true, part: 'account' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    trigger.focus()
    fireEvent.click(trigger, { detail: 0 })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settings', expanded: true })).toBeTruthy()
  })

  it('shows outage, retry progress, and a two-second recovery confirmation', () => {
    vi.useFakeTimers()
    const mounted = mount()
    expect(screen.queryByRole('button', { name: 'Disconnected, reconnect now' })).toBeNull()

    mounted.setConnectionState('disconnected')
    const indicator = screen.getByRole('button', { name: 'Disconnected, reconnect now' })
    expect(indicator.textContent).toContain('Disconnected')
    expect(indicator.hasAttribute('title')).toBe(false)
    expect(indicator.querySelector('svg')).toBeTruthy()
    fireEvent.click(indicator)
    expect(mounted.reconnect).toHaveBeenCalledOnce()

    mounted.setConnectionState('connecting')
    expect(screen.getByRole('button', { name: 'Reconnecting, reconnect now' }).textContent)
      .toContain('Reconnecting...')

    // An attempt that resolves instantly still shows the connecting pill for
    // its 800ms minimum before the confirmation replaces it.
    mounted.setConnectionState('connected')
    expect(screen.queryByRole('status')).toBeNull()
    act(() => { vi.advanceTimersByTime(800) })
    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy()
    // The confirmation window is measured from visibility, not the transition.
    act(() => { vi.advanceTimersByTime(1_999) })
    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy()
    // The confirmation window closes at 2s, then the pill fades for 150ms.
    act(() => { vi.advanceTimersByTime(1) })
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the attempt label steady through the hold and confirms for the full window', () => {
    vi.useFakeTimers()
    const mounted = mount()
    mounted.setConnectionState('connecting')
    const attempt = screen.getByRole('button', { name: 'Reconnecting, reconnect now' })
    expect(attempt.textContent).toContain('Reconnecting...')
    fireEvent.click(attempt)
    expect(mounted.reconnect).toHaveBeenCalledOnce()
    expect(attempt.textContent).toContain('Reconnecting...')
    // An attempt that resolves mid-hold keeps its label until the hold ends.
    act(() => { vi.advanceTimersByTime(100) })
    mounted.setConnectionState('connected')
    expect(screen.getByRole('button', { name: 'Reconnecting, reconnect now' }).textContent)
      .toContain('Reconnecting...')
    act(() => { vi.advanceTimersByTime(700) })
    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy()
    // The full two-second confirmation follows the delayed appearance.
    act(() => { vi.advanceTimersByTime(1_999) })
    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(1) })
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('skips the hold when the attempt already stayed visible long enough', () => {
    vi.useFakeTimers()
    const mounted = mount()
    mounted.setConnectionState('connecting')
    act(() => { vi.advanceTimersByTime(800) })
    mounted.setConnectionState('connected')
    expect(screen.getByRole('status', { name: 'Connected' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(2_000) })
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the reconnect indicator out of the collapsed rail', () => {
    mount({ wide: false, connectionState: 'disconnected' })
    expect(screen.queryByRole('button', { name: 'Disconnected, reconnect now' })).toBeNull()
  })

  it('opens the account menu from the chip without opening settings, then applies submenu choices', () => {
    const mounted = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Interface language' }).parentElement as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: 'System default' }))
    expect(mounted.clearLocale).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Interface language' }).parentElement as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Simplified Chinese' }))
    expect(mounted.setLocale).toHaveBeenCalledWith('zh')

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Appearance' }).parentElement as HTMLElement)
    expect(screen.getByRole('menuitem', { name: 'System default' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Dark theme' }))
    expect(mounted.setTheme).toHaveBeenCalledWith('dark')

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Interface scale' }).parentElement as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zoom in⌘ +' }))
    expect(mounted.setFontSize).toHaveBeenCalledWith(15)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zoom out⌘ -' }))
    expect(mounted.setFontSize).toHaveBeenCalledWith(13)
    expect(screen.getByRole('menuitem', { name: 'Actual size⌘ 0' })).toHaveProperty('disabled', true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('checks System default when no explicit locale preference is stored', () => {
    mount({ localePreference: undefined })
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Interface language' }).parentElement as HTMLElement)
    expect(screen.getByRole('menuitem', { name: 'System default' })).toBeTruthy()
  })

  it('keeps the account menu off the collapsed rail', () => {
    mount({ wide: false })
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
  })

  it('closes the account menu on outside pointerdown and renders theme icons for each preference', () => {
    mount({ themePreference: 'dark' })
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()

    cleanup()
    const mounted = mount({ themePreference: 'light', fontSize: 16 })
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('menuitem', { name: 'Appearance' })).toBeTruthy()
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Interface scale' }).parentElement as HTMLElement)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Actual size⌘ 0' }))
    expect(mounted.setFontSize).toHaveBeenCalledWith(14)
    expect(screen.queryByRole('dialog')).toBeNull()

    cleanup()
    mount({ localePreference: undefined, extraLocales: [{ id: 'ja', label: '日本語' }], fontSize: 12 })
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Interface language' }).parentElement as HTMLElement)
    expect(screen.getByRole('menuitem', { name: '日本語' })).toBeTruthy()
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Interface scale' }).parentElement as HTMLElement)
    expect(screen.getByRole('menuitem', { name: 'Zoom out⌘ -' })).toHaveProperty('disabled', true)
  })
})

describe('SettingsPanel chrome seats', () => {
  it('names the dialog via aria-labelledby pointing at the header seat node', () => {
    mount()
    openPanel()
    const dialog = screen.getByRole('dialog')
    const titleId = dialog.getAttribute('aria-labelledby')!
    expect(titleId).toBeTruthy()
    const title = document.getElementById(titleId)!
    expect(title.textContent).toBe('Settings Title')
    expect(screen.getByRole('dialog', { name: 'Settings Title' })).toBeTruthy()
  })

  it('names the close button through the visually-hidden close seat text', () => {
    mount()
    openPanel()
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close.hasAttribute('aria-label')).toBe(false)
    expect(close.textContent).toContain('Close')
  })

  it('renders header actions before the shell-owned close control', () => {
    const { renderSlot } = mount()
    openPanel()
    expect(screen.getByText('Open configuration file')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('settings.action', {})
  })

  it('renders Host start time and start count in the content header', () => {
    mount()
    openPanel()
    expect(screen.getByText(/Started /).textContent).toMatch(/launched 3 times/)
  })
})

describe('SettingsPanel close paths', () => {
  it('closes via the header button and restores trigger focus', async () => {
    mount()
    const trigger = openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('closes via a mask click and restores trigger focus', async () => {
    mount()
    const trigger = openPanel()
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog.parentElement!.firstElementChild!)
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => { expect(document.activeElement).toBe(trigger) })
  })

  it('closes via document-level Escape, restores trigger focus, and unhooks the listener', async () => {
    mount()
    const trigger = openPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => { expect(document.activeElement).toBe(trigger) })
    // Ignored while closed (listener removed with the panel) and non-Escape
    // keys are ignored while open.
    fireEvent.keyDown(document, { key: 'Escape' })
    openPanel()
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('lands focus on the close button when the dialog opens', () => {
    mount()
    openPanel()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })
})

describe('SettingsPanel navigation', () => {
  it('projects rows, marks the first active, and renders only that section', () => {
    mount()
    openPanel()
    expect(screen.getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
  })

  it('gives every section a nav glyph, distinct for the ids the shell knows', () => {
    mount({
      rows: [
        { id: 'general', order: 0, label: 'General' },
        { id: 'models', order: 10, label: 'Models' },
        { id: 'subagents', order: 12, label: 'Subagents' },
        { id: 'agent-presets', order: 20, label: 'Agent presets' },
        { id: 'plugins', order: 15, label: 'Plugins' },
        { id: 'skills', order: 17, label: 'Skills' },
        { id: 'usage', order: 35, label: 'Usage' },
        { id: 'system-prompts', order: 40, label: 'System prompts' },
        { id: 'archived-sessions', order: 45, label: 'Archived sessions' },
        { id: 'contributed', order: 50, label: 'Contributed' },
      ],
    })
    openPanel()
    // Glyphs carry no id of their own, so the drawn paths are what tells them apart.
    const glyphs = ['General', 'Models', 'Subagents', 'Agent presets', 'Plugins', 'Skills', 'Usage', 'System prompts', 'Archived sessions', 'Contributed']
      .map(name => screen.getByRole('button', { name }).querySelector('svg')?.innerHTML)

    expect(glyphs.every(glyph => glyph !== undefined && glyph !== '')).toBe(true)
    // The ids the shell names get their own glyph; every other section —
    // including one this package never heard of — shares the gear.
    expect(new Set(glyphs.slice(0, 9)).size).toBe(9)
    expect(glyphs[9]).toBe(glyphs[0])
  })

  it('switches the rendered section on nav click', () => {
    mount()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    expect(screen.getByRole('button', { name: 'Models' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId('section-models')).toBeTruthy()
    expect(screen.queryByTestId('section-general')).toBeNull()
  })

  it('mounts onboarding steps in order and transfers ownership only on completion', () => {
    const { renderSlot } = mount()
    const first = renderSlot.mock.calls.find(call => call[0] === 'settings.onboarding')
    expect(first?.[1]).toMatchObject({ stepId: 'welcome' })
    expect(first?.[2]).toEqual({ only: 'welcome' })
    act(() => {
      (first?.[1] as { complete: () => void }).complete()
      ;(first?.[1] as { complete: () => void }).complete()
    })
    const onboardingCalls = renderSlot.mock.calls.filter(call => call[0] === 'settings.onboarding')
    const second = onboardingCalls.at(-1)
    expect(second?.[1]).toMatchObject({ stepId: 'credential' })
    expect(second?.[2]).toEqual({ only: 'credential' })

    act(() => {
      (second?.[1] as { openSection: (id: string) => void }).openSection('models')
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByTestId('section-models')).toBeTruthy()

    cleanup()
    const inactive = mount({ onboardingActive: false }).renderSlot.mock.calls
      .filter(call => call[0] === 'settings.onboarding')
    expect(inactive).toHaveLength(0)
  })

  it('paints no takeover chrome of its own around the mounted step', () => {
    // The chrome (mask, opaque stage, #root inert) belongs to the step via
    // the step-owned dialog surface — a mounted-but-deciding step that
    // renders null must show and block nothing (the reload white-flash fix;
    // onboarding-surface.spec.tsx pins the primitive's half).
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    const { view } = mount()
    expect(view.container.querySelector('[class*="onboarding"]')).toBeNull()
    expect(document.body.querySelector('[class*="onboarding"]')).toBeNull()
    expect(appRoot.inert).not.toBe(true)
    view.unmount()
    appRoot.remove()
  })

  it('falls back to the first row when the active entry unregisters', () => {
    const { bump } = mount()
    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Models' }))
    bump([{ id: 'general', order: 0, label: 'General' }])
    expect(screen.queryByRole('button', { name: 'Models' })).toBeNull()
    expect(screen.getByTestId('section-general')).toBeTruthy()
  })

  it('renders an empty content column when the ledger is empty', () => {
    const { renderSlot } = mount({ rows: [] })
    openPanel()
    expect(screen.getByRole('dialog')).toBeTruthy()
    const sectionCalls = renderSlot.mock.calls.filter(c => c[0] === 'settings.section')
    expect(sectionCalls).toHaveLength(0)
  })

  it('drops the ledger subscription on unmount', () => {
    const { view, listeners } = mount()
    expect(listeners.size).toBe(1)
    view.unmount()
    expect(listeners.size).toBe(0)
  })
})
