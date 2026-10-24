/** Red-team HTTP bridge. @module @deepseek-ai/dsh-redteam/ui */
import { apply as applyRuntime, inject as runtimeInject, name as runtimeName } from '@deepseek-ai/dsh-redteam/runtime/ui.js'
/** Cordis plugin name. */
export const name = runtimeName
/** Requires the engagement store and HTTP carrier. */
export const inject = runtimeInject
/** Register the engagement API and environment guard. */
export const apply = applyRuntime
