/**
 * Shared path resolution and regular-file validation for model-facing read tools.
 * @module @deepseek-ai/dsh-tool-fs/src/read-target
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { sessionResolveOptions } from './session-cwd.ts'

/**
 * Enforce a strict media-modality gate for the calling route. Resolves the
 * session's latest routed provider/model (request header config, then agent
 * options) and requires the exact resolved route to declare the modality
 * explicitly. An unknown capability refuses instead of relying on an adapter
 * failure after filesystem and attachment work.
 * @param ctx - the plugin context used to resolve the optional `llm` service.
 * @param exec - the tool-execution context supplying the calling agent.
 * @param requestedPath - the raw, not-yet-resolved path rendered in refusal messages.
 * @param modality - the input modality the exact route must declare.
 * @throws when the route cannot be resolved or does not declare the modality.
 */
export async function assertMediaCapableRoute(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
  modality: 'image' | 'video',
): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error(`cannot read "${requestedPath}" as ${modality === 'image' ? 'an image' : 'a video'}: the current model route could not be resolved`)
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes(modality)) {
    throw new Error(`cannot read "${requestedPath}" as ${modality === 'image' ? 'an image' : 'a video'}: model "${model}" does not declare ${modality} input; switch to ${modality === 'image' ? 'an image' : 'a video'}-capable model to read ${modality === 'image' ? 'images' : 'videos'}`)
  }
}

/**
 * Resolve a model-supplied path, observe absence, and require a regular file.
 * @param ctx - the plugin context providing filesystem resolution and observation events.
 * @param exec - the current tool execution, including session cwd and cancellation.
 * @param requestedPath - the raw path supplied to the tool.
 * @returns the resolved target and its single stat result.
 */
export async function resolveRegularReadTarget(
  ctx: Context,
  exec: ToolExecution,
  requestedPath: string,
): Promise<{ target: FsTarget; info: FsInfo }> {
  const target = await ctx.fs.resolve(requestedPath, sessionResolveOptions(exec))
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new FsError(`cannot read "${target.displayPath}": not found`, 'FS_NOT_FOUND')
  }
  if (info.type !== 'file') {
    throw new FsError(`cannot read "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
  }
  return { target, info }
}
