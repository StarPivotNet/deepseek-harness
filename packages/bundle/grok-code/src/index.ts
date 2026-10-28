/**
 * The built-in Grok Code preset bundle.
 *
 * The preset composition travels inside this package under `presets/grok-code`.
 * This entry reads that directory, hands the rows to the agent-preset registry,
 * and points the skill row at the copy that ships beside the composition.
 *
 * Why the registry and not a directory the roster scans: under 0.2.x the mode
 * dropdown reads registry declarations only. A directory under
 * `$DSH_HOME/.agent-presets` supplies files but never becomes a selectable mode
 * on its own.
 *
 * Why relative rows are absolutized: the registry mounts a declaration under
 * the DECLARING loader's base — the profile directory — so a row naming
 * `./enter-plan-mode.mjs` would resolve outside this package.
 * @module @deepseek-ai/dsh-grok-code
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'

/** Cordis plugin name. */
export const name = 'dsh-grok-code'

/** The registry may be composed after this plugin; look it up on demand. */
export const inject: string[] = []

/** Registry id and directory name of the shipped preset. */
const PRESET_ID = 'grok-code'

/** Milliseconds between registry lookups while the host composition settles. */
const LOOKUP_INTERVAL_MS = 400

/** Give up declaring after this long; the preset then stays absent with a logged reason. */
const LOOKUP_TIMEOUT_MS = 45_000

/** One composition row as the Loader's YAML dialect yields it. */
interface CompositionRow {
  readonly id?: string
  readonly name: string
  readonly group?: boolean
  readonly config?: unknown
  readonly disabled?: unknown
}

/** The registry slice this plugin uses; structural so no service type is imported. */
interface PresetRegistry {
  register(definition: {
    id: string
    name?: string
    description?: string
    order?: number
    plugins: CompositionRow[]
  }): Promise<() => Promise<void>>
  list(): Promise<readonly { id: string; broken?: string }[]>
}

/** Display metadata read from `preset.yml`. */
interface PresetMetadata {
  readonly name?: string
  readonly description?: string
  readonly order?: number
}

/**
 * Absolute paths this package owns.
 * @returns the package root, its preset directory, and the skills directory that ships beside it.
 */
export function packagePaths(): { root: string; presetDir: string; skills: string } {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const presetDir = join(root, 'presets', PRESET_ID)
  return { root, presetDir, skills: join(presetDir, 'skills') }
}

/**
 * Rewrite relative row names to file URLs, recurse into group rows, and point
 * the skill row at this package's own skills directory.
 * @param rows - parsed composition rows.
 * @param baseDir - directory a relative name resolves against.
 * @param skillsDir - absolute skills directory this package ships.
 * @returns the rows the registry can mount.
 */
export function prepareRows(rows: readonly CompositionRow[], baseDir: string, skillsDir: string): CompositionRow[] {
  return rows.map((row) => {
    if (typeof row.name !== 'string' || row.name === '') throw new Error('grok-code: composition row names no plugin')
    if (row.name.startsWith('./') || row.name.startsWith('../')) {
      return { ...row, name: pathToFileURL(resolve(baseDir, row.name)).href }
    }
    if (row.id === 'skill-filesystem') {
      const config = typeof row.config === 'object' && row.config !== null ? row.config : {}
      return { ...row, config: { ...config, customSkillDirs: [skillsDir] } }
    }
    if (row.group === true) {
      if (!Array.isArray(row.config)) throw new Error(`grok-code: group ${String(row.id)} holds no row list`)
      return { ...row, config: prepareRows(row.config as CompositionRow[], baseDir, skillsDir) }
    }
    return row
  })
}

/**
 * Read the shipped composition as a registry declaration.
 * @returns the definition the registry accepts.
 */
export function buildDefinition(): {
  id: string
  name?: string
  description?: string
  order?: number
  plugins: CompositionRow[]
} {
  const paths = packagePaths()
  const file = join(paths.presetDir, 'agent.cordis.yml')
  if (!existsSync(file)) throw new Error(`grok-code: composition missing at ${file}`)
  const parsed: unknown = load(readFileSync(file, 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error('grok-code: composition must be a top-level list of plugin rows')
  const metadataFile = join(paths.presetDir, 'preset.yml')
  const metadata = (existsSync(metadataFile) ? load(readFileSync(metadataFile, 'utf8')) : {}) as PresetMetadata
  return {
    id: PRESET_ID,
    ...typeof metadata.name === 'string' ? { name: metadata.name } : {},
    ...typeof metadata.description === 'string' ? { description: metadata.description } : {},
    order: typeof metadata.order === 'number' ? metadata.order : 5,
    plugins: prepareRows(parsed as CompositionRow[], paths.presetDir, paths.skills),
  }
}

/**
 * Resolve the agent-preset registry without declaring it as an injection, so a
 * composition without one keeps this plugin inert instead of failing to load.
 * @param ctx - Host plugin context.
 * @returns the registry service, or undefined while it is absent.
 */
function softRegistry(ctx: Context): PresetRegistry | undefined {
  const candidate = ctx.get('agentPresets') as PresetRegistry | undefined
  if (candidate !== undefined && typeof candidate.register === 'function') return candidate
  return undefined
}

/**
 * Declare the shipped preset once the registry is available.
 * @param ctx - Host plugin context.
 */
export function apply(ctx: Context): void {
  let release: (() => Promise<void>) | undefined
  let closed = false

  const undeclare = async (): Promise<void> => {
    const dispose = release
    release = undefined
    if (dispose === undefined) return
    try {
      await dispose()
    } catch (error) {
      ctx.logger.warn('grok-code: undeclare failed: %s', error instanceof Error ? error.message : String(error))
    }
  }

  const declare = (registry: PresetRegistry): void => {
    let definition: ReturnType<typeof buildDefinition>
    try {
      definition = buildDefinition()
    } catch (error) {
      ctx.logger.warn('grok-code: composition unreadable: %s', error instanceof Error ? error.message : String(error))
      return
    }
    void Promise.resolve()
      .then(async () => {
        await undeclare()
        release = await registry.register(definition)
        let broken: string | undefined
        try {
          broken = (await registry.list()).find((preset) => preset.id === PRESET_ID)?.broken
        } catch {
          // The registry refuses to list; the registration itself already succeeded.
        }
        if (broken !== undefined) ctx.logger.warn('grok-code: declared but broken: %s', broken)
        else ctx.logger.info('grok-code: declared for the mode dropdown')
      })
      .catch((error: unknown) => {
        ctx.logger.warn('grok-code: register failed: %s', error instanceof Error ? error.message : String(error))
      })
  }

  ctx.effect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let tries = 0
    const tick = (): boolean => {
      if (closed) return true
      tries += 1
      const registry = softRegistry(ctx)
      if (registry === undefined) return false
      declare(registry)
      return true
    }
    if (!tick()) {
      timer = setInterval(() => {
        if (!tick()) return
        if (timer !== undefined) clearInterval(timer)
        timer = undefined
        if (timeout !== undefined) clearTimeout(timeout)
      }, LOOKUP_INTERVAL_MS)
      timer.unref()
      timeout = setTimeout(() => {
        if (timer === undefined) return
        clearInterval(timer)
        timer = undefined
        ctx.logger.warn('grok-code: agent-preset registry absent after %d tries; preset not declared', tries)
      }, LOOKUP_TIMEOUT_MS)
      timeout.unref()
    }
    return () => {
      closed = true
      if (timer !== undefined) clearInterval(timer)
      if (timeout !== undefined) clearTimeout(timeout)
      void undeclare()
    }
  }, 'dsh-grok-code: declare agent preset')
}
