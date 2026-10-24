/**
 * Organization-built-in Purge plugin.
 * @module @deepseek-ai/dsh-purge
 */

import type { Context } from '@deepseek-ai/cordis'
import { apply as applyRuntime } from '@deepseek-ai/dsh-purge/runtime/index.js'

/** Cordis plugin name retained for existing settings and data. */
export const name = 'dsh-purge'
/** Required shared Host services. */
export const inject = ['systemPrompt', 'tools']

/** Deployment switches for the organization composition. */
export interface Config {
  /** Enables the plugin; the shipped composition enables it by default. */
  readonly enabled?: boolean
  /** Reapplies host compatibility patches after startup. */
  readonly autoApplyOnStart?: boolean
  /** Optional diagnostic logging. */
  readonly verbose?: boolean
}

/**
 * Mount Purge and its settings, command, and model-tool registrations.
 * @param ctx - Host plugin context.
 * @param config - Shipped or profile-supplied configuration.
 */
export function apply(ctx: Context, config: Config): void {
  applyRuntime(ctx, config)
}
