/**
 * Workspace picker plugin, node half. The browser half ships via
 * exports["./client"], discovered through the package.json dsh.client
 * declaration. The Host behavior is this plugin's configuration: its volatile
 * fields are the live values the browser receives through its synced Config.
 * This fork also owns the durable Settings section behind the sidebar
 * Session-overflow row, registered when a settings provider exists.
 */
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { WorkspaceNavigationConfig } from './types.ts'
import { WORKSPACE_SETTINGS_NAMESPACE, WorkspaceSettingsSchema } from './workspace-settings.ts'

export {
  DEFAULT_SESSION_OVERFLOW_LIMIT, SESSION_OVERFLOW_ALL, SESSION_OVERFLOW_FIELD,
  SESSION_OVERFLOW_LIMITS, WORKSPACE_SETTINGS_NAMESPACE, WorkspaceSettingsSchema,
  isSessionOverflowLimit, type SessionOverflowLimit, type WorkspaceSettings,
} from './workspace-settings.ts'

/** Live Workspace navigation preferences; the browser receives them through its synced Config. */
export type Config = WorkspaceNavigationConfig

/** Live Workspace navigation preferences projected to the browser. */
export const Config = z.object({
  recentViewLimit: z.natural().default(10).volatile(),
})

/**
 * Register the durable Session-overflow section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx?: Context): void {
  if (ctx === undefined) return
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(WORKSPACE_SETTINGS_NAMESPACE),
      WorkspaceSettingsSchema,
    )
  })
}
