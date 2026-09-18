/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel (figma 501:29947, 1080x700) with the section nav rail. The shell is
 * a pure composition face — slot-owned text (trigger label, panel title,
 * close label, sections) arrives from registrants through slots; accessible
 * names resolve to that content (settings trigger: its own text; dialog:
 * aria-labelledby the title node; close: visually-hidden slot text). The wide
 * foot splits the account chip (menu) from the trailing settings glyph. Modal
 * open state, the account menu, and the active section id are component-local viewing state;
 * the onboarding coordinator mounts exactly one ordered registrant while the
 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs
 * to the step, so a mounted-but-deciding step paints nothing here.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ConnectionIndicator,
  IconAgentPresetOutline16, IconArchiveOutline20, IconBranchOutline16, IconCloseOutline16, IconDataOutline16,
  IconDarkOutline16, IconFollowsystemOutline16, IconGlobeOutline14, IconLightOutline16,
  IconClockOutline16, IconListPenOutline16, IconPersonalizationOutline16, IconRefreshOutline16, IconSearchOutline16,
  IconSettingsOutline16, IconSkillOutline16,
  Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionIndicatorState, MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import { HostStartMeta } from './HostStartMeta.tsx'
import type { HostStartMetaView } from './host-start-meta.ts'
import css from './SettingsRoot.module.css'
import { DesktopUpdateIndicator } from './DesktopUpdateIndicator.tsx'

const RECOVERY_CONFIRMATION_MS = 2_000

/** Same integer px range as the Appearance font-size row. */
const CONTENT_FONT_SIZE_MIN = 12
const CONTENT_FONT_SIZE_MAX = 17
const CONTENT_FONT_SIZE_DEFAULT = 14
/** Minimum visible time for the connecting pill; shorter attempts read as flicker. */
const CONNECTING_MIN_VISIBLE_MS = 800

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string) {
  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'subagents') return <IconBranchOutline16 className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  if (id === 'skills') return <IconSkillOutline16 className={css.navIcon} size={16} />
  if (id === 'system-prompts') return <IconListPenOutline16 className={css.navIcon} size={16} />
  if (id === 'usage') return <IconClockOutline16 className={css.navIcon} size={16} />
  // 20-native glyph in the rail's 16px icon slot, as on the Session row menu.
  if (id === 'archived-sessions') return <IconArchiveOutline20 className={css.navIcon} size={16} />
  return <IconSettingsOutline16 className={css.navIcon} size={16} />
}

type PanelProps = {
  rows: readonly SettingsSectionRow[]
  renderSlot: SettingsRootComponentProps['renderSlot']
  activeId: string | undefined
  onSelect: (id: string) => void
  onClose: () => void
  t: SettingsRootComponentProps['t']
  hostStartView: HostStartMetaView
}

/**
 * The modal layer: full-viewport mask + centered panel. Close paths: the
 * header button, a mask click, and document-level Escape (mounted only while
 * open, so the listener lifetime is the panel's).
 */
function SettingsPanel({ rows, renderSlot, activeId, onSelect, onClose, t, hostStartView }: PanelProps) {
  // Entries can unmount underneath the requested id, so the render-time
  // projection falls back to the first row when the id is gone.
  const active = rows.find(r => r.id === activeId)?.id ?? rows[0]?.id
  const titleId = useId()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  // Entering the dialog focuses the close button; the root restores its trigger on close.
  const closeButton = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { closeButton.current?.focus() }, [])

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <nav className={css.nav}>
          <div className={css.navTitle} id={titleId}>{renderSlot('settings.header', {})}</div>
          <div className={css.navList}>
            {rows.map(row => (
              <button
                key={row.id}
                type="button"
                className={clsx(css.navCell, row.id === active && css.active)}
                aria-current={row.id === active ? 'true' : undefined}
                onClick={() => { onSelect(row.id) }}
              >
                {navIcon(row.id)}
                <span className={css.navLabel}>{row.label}</span>
              </button>
            ))}
          </div>
        </nav>
        <div className={css.content}>
          <div className={css.header}>
            <HostStartMeta meta={hostStartView} t={t} />
            <div className={css.actions}>{renderSlot('settings.action', {})}</div>
            <button ref={closeButton} type="button" className={css.close} onClick={onClose}>
              <IconCloseOutline16 size={14} />
              <span className={css.hiddenLabel}>{renderSlot('settings.close', {})}</span>
            </button>
          </div>
          <div className={css.options}>
            {active !== undefined && renderSlot('settings.section', { close: onClose }, { only: active })}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element tree.
 */
export function SettingsRoot(props: SettingsRootComponentProps) {
  const {
    wide, reconnect, setLocale, clearLocale, setTheme, setFontSize, useConnectionState, useSections, useOnboardingSteps,
    useSessions, useHostStart, useLocale, useTheme, renderSlot, t,
    useDesktopUpdate, openDesktopUpdate,
  } = props
  const hostStartView = useHostStart === undefined
    ? { status: 'unavailable' as const, startCount: 0 }
    : useHostStart(s => s)
  const localeView = useLocale === undefined
    ? { preference: undefined as string | undefined, locales: [] as { id: string; label: string }[] }
    : useLocale(s => s)
  const themeView = useTheme === undefined
    ? { preference: 'system' as string, fontSize: 14 }
    : useTheme(s => s)
  const desktopUpdateView = useDesktopUpdate === undefined
    ? { failed: false, opening: false }
    : useDesktopUpdate(state => state)
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const [completedOnboarding, setCompletedOnboarding] = useState<ReadonlySet<string>>(() => new Set())
  const [showRecovery, setShowRecovery] = useState(false)
  const [holdConnecting, setHoldConnecting] = useState(false)
  const connectingShownAt = useRef<number | undefined>(undefined)
  const triggerButton = useRef<HTMLButtonElement | null>(null)
  const wasOpen = useRef(open)
  const close = useCallback(() => {
    setOpen(false)
    setActiveId(undefined)
  }, [])
  const openSettings = useCallback(() => {
    setMenuOpen(false)
    setOpen(true)
  }, [])
  // Restore after the close commit, when the dialog can no longer own focus.
  useEffect(() => {
    if (wasOpen.current && !open) triggerButton.current?.focus()
    wasOpen.current = open
  }, [open])
  const openSection = useCallback((id: string) => {
    setActiveId(id)
    setOpen(true)
  }, [])

  // The ledger tick keeps the nav rows fresh: registrants re-register with
  // freshly localized text on locale change, and the trigger/header/close
  // seats re-render through their own outlets' subscriptions.
  const rows = useSections(s => s)
  const connectionState = useConnectionState(state => state)
  const previousConnectionState = useRef(connectionState)
  const onboardingSteps = useOnboardingSteps(s => s)
  const onboardingActive = useSessions((state) => {
    const main = Object.values(state.byId)
      .find(session => (session.retainedBy.mainView ?? 0) > 0)
    return state.phase === 'ready' && (main === undefined || main.blank)
  })
  const onboardingStep = onboardingActive
    ? onboardingSteps.find((step: { id: string }) => !completedOnboarding.has(step.id))
    : undefined

  useEffect(() => {
    if (onboardingActive) return
    setCompletedOnboarding(new Set())
  }, [onboardingActive])

  useLayoutEffect(() => {
    const previous = previousConnectionState.current
    previousConnectionState.current = connectionState
    if (connectionState !== 'connected') {
      setShowRecovery(false)
      return
    }
    if (previous !== 'disconnected' && previous !== 'connecting') return
    setShowRecovery(true)
  }, [connectionState])

  // The confirmation window starts when the recovered pill becomes visible,
  // which the connecting minimum-visible hold can delay past the transition.
  useLayoutEffect(() => {
    if (!showRecovery || holdConnecting) return
    const timeout = window.setTimeout(() => { setShowRecovery(false) }, RECOVERY_CONFIRMATION_MS)
    return () => { window.clearTimeout(timeout) }
  }, [showRecovery, holdConnecting])

  useLayoutEffect(() => {
    if (connectionState === 'connecting') {
      connectingShownAt.current = Date.now()
      return
    }
    const shownAt = connectingShownAt.current
    if (shownAt === undefined) return
    connectingShownAt.current = undefined
    const remaining = CONNECTING_MIN_VISIBLE_MS - (Date.now() - shownAt)
    if (remaining <= 0) return
    setHoldConnecting(true)
    const timeout = window.setTimeout(() => { setHoldConnecting(false) }, remaining)
    return () => {
      window.clearTimeout(timeout)
      setHoldConnecting(false)
    }
  }, [connectionState])

  const completeOnboardingStep = useCallback((id: string) => {
    setCompletedOnboarding((previous) => {
      if (previous.has(id)) return previous
      return new Set([...previous, id])
    })
  }, [])

  let connectionIndicator: ConnectionIndicatorState | undefined
  if (connectionState === 'connecting' || holdConnecting) {
    connectionIndicator = 'connecting'
  } else if (connectionState === 'disconnected') {
    connectionIndicator = 'disconnected'
  } else if (showRecovery) {
    connectionIndicator = 'recovered'
  }

  const languageLabels: Record<string, string> = {
    en: t('menu.language.en'),
    zh: t('menu.language.zh'),
  }
  const menuItems: MenuItem[] = [
    {
      id: 'language',
      label: t('menu.language'),
      icon: <IconGlobeOutline14 size={16} />,
      submenu: [
        { id: 'locale:system', label: t('menu.language.system') },
        ...localeView.locales.map((option: { id: string; label: string }) => ({
          id: `locale:${option.id}`,
          label: languageLabels[option.id] ?? option.label,
        })),
      ],
    },
    {
      id: 'theme',
      label: t('menu.theme'),
      icon: themeView.preference === 'dark'
        ? <IconDarkOutline16 />
        : themeView.preference === 'light'
          ? <IconLightOutline16 />
          : <IconFollowsystemOutline16 />,
      submenu: [
        { id: 'theme:system', label: t('menu.theme.system') },
        { id: 'theme:dark', label: t('menu.theme.dark') },
        { id: 'theme:light', label: t('menu.theme.light') },
      ],
    },
    {
      id: 'fontSize',
      label: t('menu.fontSize'),
      icon: <IconSearchOutline16 />,
      submenu: [
        {
          id: 'font:increase',
          label: t('menu.fontSize.increase'),
          icon: <IconSearchOutline16 />,
          shortcut: t('menu.fontSize.increaseShortcut'),
          disabled: themeView.fontSize >= CONTENT_FONT_SIZE_MAX,
        },
        {
          id: 'font:decrease',
          label: t('menu.fontSize.decrease'),
          icon: <IconSearchOutline16 />,
          shortcut: t('menu.fontSize.decreaseShortcut'),
          disabled: themeView.fontSize <= CONTENT_FONT_SIZE_MIN,
        },
        {
          id: 'font:reset',
          label: t('menu.fontSize.reset'),
          icon: <IconRefreshOutline16 />,
          shortcut: t('menu.fontSize.resetShortcut'),
          disabled: themeView.fontSize === CONTENT_FONT_SIZE_DEFAULT,
        },
      ],
    },
  ]
  const selectedIds = [
    `locale:${localeView.preference === undefined ? 'system' : localeView.preference}`,
    `theme:${themeView.preference}`,
  ]
  const settingsTrigger = (
    <button
      ref={triggerButton}
      type="button"
      className={clsx(css.trigger, !wide && css.rail, wide && css.settingsTrigger)}
      aria-label={t('trigger')}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={openSettings}
    >
      {renderSlot('settings.trigger', wide ? { wide, part: 'settings' } : { wide })}
    </button>
  )

  return (
    <>
      <div className={clsx(css.triggerRow, !wide && css.railRow)}>
        {wide ? (
          <div className={css.splitTrigger}>
            <div className={css.accountMenu}>
              <Menu
                className={css.accountMenuAnchor as string}
                open={menuOpen}
                onClose={() => { setMenuOpen(false) }}
                items={menuItems}
                selectedIds={selectedIds}
                onSelect={(id: string) => {
                  if (id === 'locale:system') {
                    clearLocale()
                    setMenuOpen(false)
                    return
                  }
                  if (id.startsWith('locale:')) {
                    setLocale(id.slice('locale:'.length))
                    setMenuOpen(false)
                    return
                  }
                  if (id.startsWith('theme:')) {
                    setTheme(id.slice('theme:'.length))
                    setMenuOpen(false)
                    return
                  }
                  if (id === 'font:increase') {
                    setFontSize(themeView.fontSize + 1)
                    return
                  }
                  if (id === 'font:decrease') {
                    setFontSize(themeView.fontSize - 1)
                    return
                  }
                  setFontSize(CONTENT_FONT_SIZE_DEFAULT)
                }}
                side="top"
                portal
                anchor={(
                  <button
                    type="button"
                    className={css.accountTrigger}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => { setMenuOpen(value => !value) }}
                  >
                    {renderSlot('settings.trigger', { wide, part: 'account' })}
                    <span className={css.hiddenLabel}>{t('account.menu')}</span>
                  </button>
                )}
              />
            </div>
            {settingsTrigger}
          </div>
        ) : settingsTrigger}
        <ConnectionIndicator
          state={wide && desktopUpdateView.presentation?.phase !== 'installing' ? connectionIndicator : undefined}
          disconnectedLabel={t('connection.error')}
          connectingLabel={t('connection.connecting')}
          recoveredLabel={t('connection.connected')}
          reconnectActionLabel={t('connection.reconnect')}
          restartActionLabel={t('connection.restart')}
          onReconnect={reconnect}
        />
        <DesktopUpdateIndicator wide={wide} hidden={connectionIndicator !== undefined && desktopUpdateView.presentation?.phase !== 'installing'}
          t={t} view={desktopUpdateView} onOpen={openDesktopUpdate} />
      </div>
      {open && (
        <SettingsPanel
          rows={rows}
          renderSlot={renderSlot}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={close}
          t={t}
          hostStartView={hostStartView}
        />
      )}
      {/* Dialog chrome and `#root` inert ownership live inside each step's
          visible branch. A step still deciding (private facts loading)
          renders null, so nothing paints or blocks while it decides. */}
      {onboardingStep !== undefined && renderSlot('settings.onboarding', {
        stepId: onboardingStep.id,
        complete: () => { completeOnboardingStep(onboardingStep.id) },
        openSection,
      }, { only: onboardingStep.id })}
    </>
  )
}
