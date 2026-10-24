/** Red-team model tools. @module @deepseek-ai/dsh-redteam/tools */
import { apply as applyRuntime, inject as runtimeInject, name as runtimeName } from '@deepseek-ai/dsh-redteam/runtime/tools.js'
/** Cordis plugin name. */
export const name = runtimeName
/** Requires the shared tool registry. */
export const inject = runtimeInject
/** Register engagement tools on the calling tool registry. */
export const apply = applyRuntime
