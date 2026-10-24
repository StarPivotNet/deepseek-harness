/** Shared red-team store plugin. @module @deepseek-ai/dsh-redteam/store */
import { apply as applyRuntime, inject as runtimeInject, name as runtimeName } from '@deepseek-ai/dsh-redteam/runtime/store.js'
/** Cordis plugin name. */
export const name = runtimeName
/** The store has no required Host services. */
export const inject = runtimeInject
/** Open the store and publish it as `ctx.redteam`. */
export const apply = applyRuntime
