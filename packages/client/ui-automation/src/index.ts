/**
 * Host Automation sidebar plugin, node half: registers the durable
 * keep-awake preference and holds an OS sleep assertion while it is on.
 * The browser half ships via exports["./client"].
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  AUTOMATION_SETTINGS_NAMESPACE, AutomationSettingsSchema,
  type AutomationSettings,
} from './automation-settings.ts'
import { KeepAwakeHold } from './keep-awake.ts'

export {
  AUTOMATION_SETTINGS_NAMESPACE, AutomationSettingsSchema, DEFAULT_KEEP_AWAKE, KEEP_AWAKE_FIELD,
  type AutomationSettings,
} from './automation-settings.ts'
export { KeepAwakeHold, internals as keepAwakeInternals } from './keep-awake.ts'

const AUTOMATION_NAMESPACE = settingsNamespace(AUTOMATION_SETTINGS_NAMESPACE)

/**
 * Register the keep-awake section and hold or release the OS assertion.
 * @param ctx - Host context that may acquire a settings provider.
 */
export function apply(ctx: Context): void {
  const hold = new KeepAwakeHold()
  const adopt = (): void => {
    const settings = ctx.get('settings')
    const section = settings?.get(AUTOMATION_NAMESPACE) as AutomationSettings | undefined
    void hold.setEnabled(section?.keepAwake === true)
  }
  adopt()
  ctx.effect(() => () => { hold.dispose() }, 'ui-automation: keep-awake hold')
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(AUTOMATION_NAMESPACE, AutomationSettingsSchema)
    adopt()
    settingsCtx.on('settings/document-updated', (ns) => {
      if (ns === AUTOMATION_NAMESPACE) adopt()
    })
  })
}
