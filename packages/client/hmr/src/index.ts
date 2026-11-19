/**
 * Host transport for Web client graph changes and rebuilt bundles. One interval
 * stat-polls every graph row's client bundle (polling by design: network mounts
 * deliver no inotify events) and reports changes through
 * `clientModules.rebuilt(id)`; the `pluginEvents` Remote stream delivers graph,
 * rebuild, and synced configuration changes to the browser half (src/client/).
 * The Web composition mounts this transport for live graph updates;
 * a development rebuild watcher also supplies bundle changes.
 *
 * This fork adds the durable automatic-hot-reload preference and the
 * `POST /plugins/reload` route the Settings row uses to reload every watched
 * bundle while that preference is off.
 */
import { statSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type imports carry the clientModules and webServer Context merges.
import type { ClientArtifactBaseline } from '@deepseek-ai/dsh-client-modules'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings/types'
import { PluginEvents } from './plugin-events.ts'
import {
  CLIENT_HMR_SETTINGS_NAMESPACE, ClientHmrSettingsSchema, DEFAULT_AUTO_RELOAD,
  type ClientHmrSettings,
} from './hmr-settings.ts'
import { RELOAD_ENDPOINT } from './reload-endpoint.ts'

export type * from './types.ts'
export { RELOAD_ENDPOINT } from './reload-endpoint.ts'
export {
  AUTO_RELOAD_FIELD, CLIENT_HMR_SETTINGS_NAMESPACE, ClientHmrSettingsSchema,
  DEFAULT_AUTO_RELOAD, type ClientHmrSettings,
} from './hmr-settings.ts'

/** Cordis plugin name. */
export const name = 'client-hmr'

/** Required services: the client graph and the Web route registry the manual reload route registers into. */
export const inject = ['clientModules', 'webServer']

const HMR_NAMESPACE = settingsNamespace(CLIENT_HMR_SETTINGS_NAMESPACE)

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Bundle stat-poll interval in milliseconds (default 500, the build-side watcher's polling default). */
  pollIntervalMs?: number
}

export const Config: z<Config> = z.object({
  pollIntervalMs: z.number().step(1).min(1).default(500),
})

type WatchedBundleStat = Omit<ClientArtifactBaseline, 'path'>

type WatchedBundle = {
  -readonly [K in keyof ClientArtifactBaseline]: ClientArtifactBaseline[K]
} & { dirty: boolean }

/** Snapshot the executable bundle metadata that drives reloads. */
function bundleStat(path: string): WatchedBundleStat {
  const bundle = statSync(path)
  return { mtimeMs: bundle.mtimeMs, ctimeMs: bundle.ctimeMs, size: bundle.size }
}

/** Whether the executable bundle metadata is unchanged since its last publication. */
function sameBundleStat(left: WatchedBundleStat, right: WatchedBundleStat): boolean {
  return left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
    && left.size === right.size
}

/**
 * Mount bundle watches, the plugin-events Remote service, and the manual reload route.
 * @param ctx - host plugin context carrying clientModules and webServer.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the field is set after validation.
  const pollIntervalMs = config.pollIntervalMs as number

  // --- durable automatic-hot-reload preference ---------------------------
  let autoReload = DEFAULT_AUTO_RELOAD
  const adoptAutoReload = (): void => {
    const section = ctx.get('settings')?.get(HMR_NAMESPACE) as ClientHmrSettings | undefined
    autoReload = section?.autoReload ?? DEFAULT_AUTO_RELOAD
  }
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(HMR_NAMESPACE, ClientHmrSettingsSchema)
    adoptAutoReload()
    settingsCtx.on('settings/document-updated', (namespace) => {
      if (namespace === HMR_NAMESPACE) adoptAutoReload()
    })
  })

  // --- bundle watch: one HMR-owned stat poll ------------------------------
  const watched = new Map<string, WatchedBundle>()

  const publish = (id: string, watch: WatchedBundle, current: WatchedBundleStat): void => {
    try {
      ctx.clientModules.rebuilt(id)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        watch.dirty = true
        return
      }
      ctx.logger.warn(error)
    }
    watch.mtimeMs = current.mtimeMs
    watch.ctimeMs = current.ctimeMs
    watch.size = current.size
    watch.dirty = false
  }

  const watchRow = (id: string, baseline: ClientArtifactBaseline): void => {
    const watch: WatchedBundle = { ...baseline, dirty: false }
    watched.set(id, watch)
    let current: WatchedBundleStat
    try {
      current = bundleStat(baseline.path)
    } catch (error) {
      watch.dirty = true
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') ctx.logger.warn(error)
      return
    }
    // The module host captured its baseline before reading the bytes in the
    // startup batch. Only a mismatch crosses into generation publication.
    if (!sameBundleStat(current, watch)) publish(id, watch, current)
  }

  const pollWatches = (): void => {
    for (const [id, watch] of watched) {
      let current: WatchedBundleStat
      try {
        current = bundleStat(watch.path)
      } catch (error) {
        watch.dirty = true
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') ctx.logger.warn(error)
        continue
      }
      if (!watch.dirty && sameBundleStat(current, watch)) continue
      // Stat-before-publication preserves a detectable older baseline for
      // writes that land during the read. The preset stamps the entry after
      // sibling chunks, so a completed build supplies the final stat change.
      publish(id, watch, current)
    }
  }

  // Diff the watch set against the current graph: drop watches for removed
  // rows (or rows whose bundle path moved), add watches for new rows.
  const syncWatches = (): void => {
    const rows = new Map<string, ClientArtifactBaseline>()
    for (const row of ctx.clientModules.graph().entries) {
      const watch = ctx.clientModules.artifactBaseline(row.id)
      if (watch !== undefined) rows.set(row.id, watch)
    }
    for (const [id, watch] of watched) {
      if (rows.get(id)?.path === watch.path) continue
      watched.delete(id)
    }
    for (const [id, watch] of rows) {
      if (!watched.has(id)) watchRow(id, watch)
    }
  }

  ctx.effect(() => {
    // Initial sync covers rows already in the graph; the subscription covers
    // rows arriving later (boot-window activations, including this plugin's
    // own row; bootstrap revisions also reach page diagnostics).
    syncWatches()
    const unsubscribe = ctx.clientModules.onGraphChanged(syncWatches)
    const timer = setInterval(pollWatches, pollIntervalMs)
    timer.unref()
    return () => {
      unsubscribe()
      clearInterval(timer)
      watched.clear()
    }
  }, 'client-hmr: bundle watches')

  // --- POST /plugins/reload: on-demand reload for every watched bundle ----
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: RELOAD_ENDPOINT,
    handler: (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      const revs: { id: string; rev: string }[] = []
      for (const [id, watch] of watched) {
        let current: WatchedBundleStat
        try {
          current = bundleStat(watch.path)
        } catch (error) {
          watch.dirty = true
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') ctx.logger.warn(error)
          continue
        }
        publish(id, watch, current)
        const rev = ctx.clientModules.graph().entries.find(entry => entry.id === id)?.rev
        if (rev === undefined) continue
        revs.push({ id, rev })
      }
      // With automatic reload on, the rebuilt increments above already reach
      // the page; the forced increments only serve the preference being off.
      if (!autoReload) {
        const events = ctx.get('pluginEvents') as PluginEvents | undefined
        events?.reload(revs)
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, reloaded: revs.length }))
    },
  }), 'client-hmr: /plugins/reload route')

  ctx.plugin(PluginEvents)
}
