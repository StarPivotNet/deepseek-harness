/**
 * Function plugin registering the `sessionStats` and `sessionUsage` projection
 * units: whole-log turn/step counts and LLM/tool/first-token/decode wall times,
 * plus tokens, duration, and UTC calendar/model rows, served through the
 * session-projection seam (registry snapshot, change feed, and every
 * projection carrier), so clients render full-session figures that paging and
 * compaction cannot change. The plugin owns only the folds; delivery is the
 * seam's.
 *
 * @module @deepseek-ai/dsh-session-stats
 */

import type { Context } from '@deepseek-ai/cordis'
import { sessionStatsProjectionDefinition } from './projection.ts'
import { sessionUsageProjectionDefinition } from './usage.ts'

export type * from './types.ts'
export { aggregateUsage, EMPTY_SESSION_USAGE, rebaseUsageDay, zonedDayKey } from './aggregate.ts'
export type { UsageOverview } from './aggregate.ts'

/** Cordis plugin name. */
export const name = 'session-stats'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `sessionStats` and `sessionUsage` units; the registrations are
 * effects on this plugin's fiber, so unloading removes the keys.
 * @param ctx - registrant context carrying the projection registry.
 * @returns when the plugin is ready.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.sessionProjections.register(sessionStatsProjectionDefinition)
  await ctx.sessionProjections.register(sessionUsageProjectionDefinition)
}
