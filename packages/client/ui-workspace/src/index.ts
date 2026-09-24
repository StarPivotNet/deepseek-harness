/**
 * Workspace picker plugin, node half. Registers the durable sidebar overflow
 * preference when a settings provider exists; the browser half ships via the
 * package ./client export, discovered through the package.json dsh.client
 * declaration.
 */
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { WORKSPACE_SETTINGS_NAMESPACE, WorkspaceSettingsSchema } from './workspace-settings.ts'

export {
  DEFAULT_SESSION_OVERFLOW_LIMIT, SESSION_OVERFLOW_ALL, SESSION_OVERFLOW_FIELD,
  SESSION_OVERFLOW_LIMITS, WORKSPACE_SETTINGS_NAMESPACE, WorkspaceSettingsSchema,
  isSessionOverflowLimit, type SessionOverflowLimit, type WorkspaceSettings,
} from './workspace-settings.ts'

/**
 * Register the durable workspace section when a settings provider exists.
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
