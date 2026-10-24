/** Built-in red-team bootstrap. @module @deepseek-ai/dsh-redteam */
import { apply as applyRuntime, inject as runtimeInject, name as runtimeName } from '@deepseek-ai/dsh-redteam/runtime/index.js'
/** Cordis plugin name. */
export const name = runtimeName
/** The bootstrap uses optional service lookup. */
export const inject = runtimeInject
/** Install the preset and skills and expose its package paths. */
export const apply = applyRuntime
