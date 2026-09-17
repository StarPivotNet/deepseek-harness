/**
 * Settings shell contract — the types of the `sidebar.settings` occupant this
 * package renders. They live here rather than in ui-settings because they
 * reference the sidebar's own slot type: ui-settings is the settings domain's
 * base layer and must not depend on any `ui-*` presentation package, or the
 * reference graph closes a cycle through ui-sidebar → ui-layout → ui-theme.
 * The settings SLOT types (what registrants contribute) stay in ui-settings.
 */
import type { ConnectionGenerationState, ConnectionState } from '@deepseek-ai/dsh-client-connection/client'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.settings' entry)
// into every program that sees this contract.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the settings slot declarations the shell renders into.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { HostStartMetaView } from './host-start-meta.ts'
import type { DesktopUpdateView } from './desktop-update-bridge.ts'

/** One nav row projected from a settings.section registration's options. */
export interface SettingsSectionRow {
  id: string
  order: number
  label: string
}

/** One ordered onboarding step projected from a slot registration. */
export interface SettingsOnboardingStep {
  id: string
  order: number
}

/**
 * Registrant-private injected share of the settings shell (assembled in
 * apply): connection state and ledger projections arrive as hook-compartment
 * sources, while the reconnect command remains a plain callback.
 */
export type SettingsRootInjected = {
  /** Request the current shell-owned update action. */
  openDesktopUpdate: () => void
  /** Request a fresh logical generation and physical WebSocket immediately. */
  reconnect: () => void
  /** Switch the active locale from the account menu. */
  setLocale: (id: string) => void
  /** Clear the explicit locale so the browser-derived locale is used. */
  clearLocale: () => void
  /** Switch the theme preference from the account menu. */
  setTheme: (id: string) => void
  /** Change the conversation content font size from the account menu. */
  setFontSize: (px: number) => void
  hooks: {
    /** Shared Electron status for both sidebar locations. */
    desktopUpdate: HostObservable<DesktopUpdateView>
    /** Connection-owned state for the current Host connection. */
    connectionState: HostObservable<ConnectionState | undefined>
    /** settings.section ledger projected into ordered nav rows. */
    sections: HostObservable<readonly SettingsSectionRow[]>
    /** settings.onboarding ledger projected into coordinator order. */
    onboardingSteps: HostObservable<readonly SettingsOnboardingStep[]>
    /** Host-process start time and start count. */
    hostStart: HostObservable<HostStartMetaView>
    /** Active locale and selectable language catalog. */
    locale: HostObservable<LocaleSnapshot>
    /** Active appearance preference and content font size. */
    theme: HostObservable<ThemeSnapshot>
  }
}

/**
 * Trigger-private injected share: the current connection generation, used
 * only to derive the visual account name from the Host home path.
 */
export type SettingsTriggerInjected = {
  hooks: {
    /** Current generation and Host facts, bound by the slot renderer. */
    connectionGeneration: ConnectionGenerationState
  }
}

/**
 * Full component props of the settings shell root: the sidebar owner share
 * (wide/rail state) plus the declared render shares and the injected face
 * (hooks compartment bound to useSections). No store is registered — modal
 * open state and active section id are component-local viewing state.
 */
export type SettingsRootComponentProps =
  PropsRuntime<'sidebar.settings'>
  & PropsLocale<'settings'>
  & PropsRenderSlots<
    | 'settings.trigger'
    | 'settings.header'
    | 'settings.action'
    | 'settings.close'
    | 'settings.section'
    | 'settings.onboarding'
  >
  & InjectFace<SettingsRootInjected>
