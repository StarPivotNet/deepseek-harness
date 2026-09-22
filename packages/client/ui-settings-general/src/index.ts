/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  consumeHostProcessStartCount,
  formatHostStartedAt,
  HOST_LIFETIME_SETTINGS_NAMESPACE,
  HOST_START_COUNT_FIELD,
  HOST_STARTED_AT_FIELD,
  hostProcessStartedAt,
  HostLifetimeSettingsSchema,
  nextHostStartCount,
  type HostLifetimeSettings,
} from './host-lifetime.ts'

export {
  consumeHostProcessStartCount,
  formatHostStartedAt,
  HOST_LIFETIME_SETTINGS_NAMESPACE,
  HOST_START_COUNT_FIELD,
  HOST_STARTED_AT_FIELD,
  hostProcessStartedAt,
  HostLifetimeSettingsSchema,
  internals as hostLifetimeInternals,
  nextHostStartCount,
  type HostLifetimeSettings,
} from './host-lifetime.ts'

/** Durable settings namespace for product-wide GUI onboarding facts. */
const ONBOARDING_SETTINGS_NAMESPACE = 'ui-onboarding'
const HOST_NAMESPACE = settingsNamespace(HOST_LIFETIME_SETTINGS_NAMESPACE)

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Last acknowledged welcome notice version. */
  welcomeNoticeVersion: Volatile<string | undefined>
}

/** Live welcome preference. */
export const Config = z.object({
  welcomeNoticeVersion: z.string().volatile(),
})

interface OnboardingSettings {
  /** Last version acknowledged by the current product welcome step. */
  welcomeNoticeVersion?: string
}

const OnboardingSettingsSchema: z<OnboardingSettings> = z.object({
  welcomeNoticeVersion: z.string(),
})

/**
 * Record this process start on the durable Host-lifetime section.
 * @param scope - owner of the Host-lifetime namespace.
 */
function recordHostProcessStart(scope: { get(): HostLifetimeSettings; update(patch: object): Promise<void> }): void {
  const startedAt = formatHostStartedAt(hostProcessStartedAt())
  if (consumeHostProcessStartCount()) {
    void scope.update({
      [HOST_START_COUNT_FIELD]: nextHostStartCount(scope.get().startCount),
      [HOST_STARTED_AT_FIELD]: startedAt,
    })
    return
  }
  void scope.update({ [HOST_STARTED_AT_FIELD]: startedAt })
}

/** Register onboarding, Host-lifetime, and welcome configuration projection. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      ONBOARDING_SETTINGS_NAMESPACE,
      OnboardingSettingsSchema,
    )
    const lifetime = settingsCtx.settings.register(HOST_NAMESPACE, HostLifetimeSettingsSchema)
    recordHostProcessStart(lifetime)
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
  })
}
