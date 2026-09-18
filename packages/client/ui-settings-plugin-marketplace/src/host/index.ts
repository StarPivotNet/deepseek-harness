/**
 * In-box Host marketplace. Registers a loopback Connection RPC channel
 * at /plugin-marketplace so the browser half does not need api-remotes.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  packageExportsBundle,
  readProfileManifest,
  readProfilePatches,
  reconcileProfilePlugins,
  runProfilePnpm,
  writeProfilePatches,
  type ProfileHandle,
} from '@deepseek-ai/dsh-app-boot'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import {
  BUILTIN_CATALOG_PATH, emptyCatalog, isCatalogUrl, MAX_CATALOG_BYTES, normalizeCatalogUrls,
  parseCatalogDocument, sourceTitleFromUrl,
} from './catalog.ts'
import {
  cachedSourceFromFetch, emptyCache, isCatalogCache, mergeCachedSource,
  pruneCacheToUrls, snapshotFromCache, type CatalogCache,
} from './catalog-cache.ts'
import { listReloadTargets, listUpdateTargets } from './command-targets.ts'
import { isPluginNotes, noteOf, writeNote, type PluginNotes } from './plugin-notes.ts'
import { registerMarketplaceCommands } from './commands.ts'
import { DEFAULT_CATALOG_URL } from './defaults.ts'
import { CLIENT_HMR_NAMESPACE, pinAutoReloadOff } from './hmr-pin.ts'
import { requestBrowserReboot, snapshotFromSettings } from './reload.ts'
import { installSpec, isInstallVersion, isRegistryPackageName } from './names.ts'
import type {
  CatalogPlugin,
  CatalogSnapshot,
  CatalogSource,
  InstalledPlugin,
  InstalledPluginKind,
  InstalledPluginSnapshot,
  PluginEnableResult,
  PluginFiberPhase,
  PluginMarketplaceErrorCode,
  PluginMarketplaceFailure,
  PluginMutationResult,
  ReloadProgressSnapshot,
  SetEnabledRequest,
} from './types.ts'
import {
  MARKETPLACE_BUNDLE_PACKAGE,
  MARKETPLACE_CLIENT_ENTRY_ID,
  MARKETPLACE_HOST_ENTRY_ID,
  MARKETPLACE_SETTINGS_NAMESPACE,
} from '../ids.ts'

export const name = 'plugin-marketplace'
export const inject = ['loader', 'profile', 'connection']
export {
  MARKETPLACE_BUNDLE_PACKAGE,
  MARKETPLACE_CLIENT_ENTRY_ID,
  MARKETPLACE_HOST_ENTRY_ID,
  MARKETPLACE_SETTINGS_NAMESPACE,
}
export { DEFAULT_CATALOG_URL } from './defaults.ts'

const SETTINGS_NS = settingsNamespace(MARKETPLACE_SETTINGS_NAMESPACE)
const CHANNEL = '/plugin-marketplace'

const FIBER_PHASE: Record<number, Exclude<PluginFiberPhase, 'mixed'>> = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
}

export interface Config {
  catalogUrl?: string
  catalogUrls?: string[]
  catalogTimeoutMs?: number
}

function fail(code: PluginMarketplaceErrorCode, message: string): PluginMarketplaceFailure {
  return { ok: false, code, message }
}

let hostApplied = false

export function apply(ctx: Context, config: Config = {}): void {
  // Source/tsx loads the host face for both marketplace entry IDs.
  // The second apply would re-register /plugin-marketplace and crash boot.
  if (hostApplied) return
  hostApplied = true
  const resolved = {
    catalogUrls: normalizeCatalogUrls(config.catalogUrls, config.catalogUrl ?? DEFAULT_CATALOG_URL),
    catalogTimeoutMs: config.catalogTimeoutMs ?? 10_000,
  }
  for (const url of resolved.catalogUrls) {
    if (!isCatalogUrl(url) || url.length === 0) {
      throw new Error(`plugin-marketplace: catalog URL must be http(s) or the shipped catalog path: ${url}`)
    }
  }
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.get('settings') as {
      register: (ns: unknown, schema: unknown, options?: { base?: unknown }) => unknown
    }
    settings.register(SETTINGS_NS, z.object({
      catalogUrls: z.array(z.string()).default([]),
      catalogCache: z.any().default(emptyCache()),
      pluginNotes: z.any().default({}),
      reloadNonce: z.number().default(0),
      rebootNonce: z.number().default(0),
      reloadClientIds: z.array(z.string()).default([]),
      reloadNames: z.array(z.string()).default([]),
      reloadProgress: z.object({
        phase: z.union([z.const('idle'), z.const('running'), z.const('done')]).default('idle'),
        current: z.string().default(''),
        index: z.number().default(0),
        total: z.number().default(0),
        ok: z.number().default(0),
        failed: z.number().default(0),
        message: z.string().default(''),
      }).default({ phase: 'idle', current: '', index: 0, total: 0, ok: 0, failed: 0, message: '' }),
    }), {
      base: {
        catalogUrls: resolved.catalogUrls,
        catalogCache: emptyCache(),
        pluginNotes: {},
        reloadNonce: 0,
        rebootNonce: 0,
        reloadClientIds: [],
        reloadNames: [],
        reloadProgress: { phase: 'idle', current: '', index: 0, total: 0, ok: 0, failed: 0, message: '' },
      },
    })
  })
  pinClientAutoReloadOff(ctx)
  let inflight: Promise<unknown> | undefined
  let reloadLive: ReloadProgressSnapshot = snapshotFromSettings(
    (ctx.get('settings') as { get?: (ns: unknown) => {
      reloadNonce?: number
      rebootNonce?: number
      reloadClientIds?: readonly string[]
      reloadNames?: readonly string[]
      reloadProgress?: ReloadProgressSnapshot
    } } | undefined)?.get?.(SETTINGS_NS),
  )
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.get('settings') as {
      get?: (ns: unknown) => {
        reloadNonce?: number
        rebootNonce?: number
        reloadClientIds?: readonly string[]
        reloadNames?: readonly string[]
        reloadProgress?: ReloadProgressSnapshot
      }
      update?: (ns: unknown, patch: object) => Promise<unknown>
    } | undefined
    reloadLive = snapshotFromSettings(settings?.get?.(SETTINGS_NS))
  })
  // Bump only after the web server can serve /plugins bundles. Doing this
  // at settings registration races the still-composing client graph and
  // the page reloads into "Failed to load plugins".
  ctx.inject(['settings', 'webServer'], (readyCtx) => {
    if (process.env.DSH_MARKETPLACE_REBOOT === undefined) return
    const settings = readyCtx.get('settings') as {
      get?: (ns: unknown) => { rebootNonce?: number }
      update?: (ns: unknown, patch: object) => Promise<unknown>
    } | undefined
    void requestBrowserReboot(settings, SETTINGS_NS).then((rebootNonce) => {
      reloadLive = { ...reloadLive, rebootNonce }
    }).catch((error: unknown) => {
      console.error('plugin-marketplace: reboot nonce failed', error)
    })
  })
  ctx.inject(['commands'], (commandCtx) => {
    registerMarketplaceCommands(commandCtx, {
      requireProfile: () => requireProfile(commandCtx),
      webPort: () => (commandCtx.get('webServer') as { port?: number } | undefined)?.port,
      settingsNs: SETTINGS_NS,
      publishReload: (progress, extra) => {
        reloadLive = {
          ...progress,
          nonce: extra?.nonce ?? reloadLive.nonce,
          clientIds: extra?.clientIds ?? reloadLive.clientIds,
          names: extra?.names ?? reloadLive.names,
          rebootNonce: extra?.rebootNonce ?? reloadLive.rebootNonce,
        }
      },
      exitProcess: () => {
        const exit = commandCtx.get('appExit') as ((code: number) => void) | undefined
        if (exit !== undefined) exit(0)
        else process.exit(0)
      },
    })
  })
  const marketplace = {
    listInstalled(): InstalledPluginSnapshot {
      const profile = requireProfile(ctx)
      const manifest = readProfileManifest('plugin-marketplace', profile.dir)
      const dependencies = manifest.dependencies ?? {}
      const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
      const byPackage = new Map<string, InstalledPlugin>()
      for (const [packageName, spec] of Object.entries(dependencies)) {
        const isBundle = packageExportsBundle(
          'plugin-marketplace', packageName, profile.installAnchor, profile.dir,
        )
        const kind: InstalledPluginKind = isBundle || bundles.has(packageName) ? 'bundle' : 'dependency'
        byPackage.set(packageName, {
          packageName,
          spec,
          kind,
          installed: true,
          entryIds: [],
          enabled: true,
          fiberPhase: null,
          canUninstall: packageName !== MARKETPLACE_BUNDLE_PACKAGE,
          canToggle: false,
          note: '',
          tags: [],
        })
      }
      for (const entry of ctx.loader.entries()) {
        if (entry.options.group) continue
        const packageName = entry.options.name
        const existing = byPackage.get(packageName)
        const fiberPhase = entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state] ?? null
        const enabled = !entry.disabled
        if (existing !== undefined) {
          const entryIds = [...existing.entryIds, entry.id]
          byPackage.set(packageName, {
            ...existing,
            entryIds,
            enabled: existing.enabled && enabled,
            fiberPhase: mergePhase(existing.fiberPhase, fiberPhase),
            canToggle: entryIds.length === 1 && packageName !== MARKETPLACE_BUNDLE_PACKAGE
              && entry.id !== MARKETPLACE_HOST_ENTRY_ID
              && entry.id !== MARKETPLACE_CLIENT_ENTRY_ID,
          })
          continue
        }
        byPackage.set(packageName, {
          packageName,
          spec: '',
          kind: 'inbox',
          installed: true,
          entryIds: [entry.id],
          enabled,
          fiberPhase,
          canUninstall: false,
          canToggle: entry.id !== MARKETPLACE_HOST_ENTRY_ID && entry.id !== MARKETPLACE_CLIENT_ENTRY_ID,
          note: '',
          tags: [],
        })
      }
      const notes = readPluginNotes(ctx)
      return {
        profileName: profile.name,
        entries: [...byPackage.values()].map((entry) => {
          const annotated = noteOf(notes, entry.packageName)
          return { ...entry, note: annotated.note, tags: annotated.tags }
        }),
      }
    },
    listCommandTargets(): { reload: ReturnType<typeof listReloadTargets>; update: ReturnType<typeof listUpdateTargets> } {
      const reload = listReloadTargets([...ctx.loader.entries()]
        .filter(entry => !entry.options.group)
        .map(entry => ({
          id: entry.id,
          moduleName: String(entry.options.name ?? ''),
          enabled: !entry.disabled,
        })))
      const profile = requireProfile(ctx)
      const manifest = readProfileManifest('plugin-marketplace', profile.dir)
      return { reload, update: listUpdateTargets(Object.keys(manifest.dependencies ?? {})) }
    },
    listCatalog(): CatalogSnapshot {
      const urls = effectiveCatalogUrls(ctx, resolved.catalogUrls)
      if (urls.length === 0) return emptyCatalog()
      const cached = snapshotFromCache(urls, readCatalogCache(ctx))
      if (cached !== undefined) return { ...cached, refreshing: false }
      return {
        configured: true,
        sources: urls.map(url => ({ url, title: sourceTitleFromUrl(url), ok: true, count: 0 })),
        entries: [],
        fetchedAt: 0,
        stale: true,
        refreshing: false,
      }
    },
    async refreshCatalog(request: { url?: string } = {}): Promise<CatalogSnapshot> {
      const urls = effectiveCatalogUrls(ctx, resolved.catalogUrls)
      if (urls.length === 0) {
        writeCatalogCache(ctx, emptyCache())
        return emptyCatalog()
      }
      const target = request.url !== undefined && request.url.length > 0 ? request.url : undefined
      if (target !== undefined && !urls.includes(target)) {
        return {
          configured: true,
          sources: [{ url: target, title: sourceTitleFromUrl(target), ok: false, error: 'market is not configured', count: 0 }],
          entries: snapshotFromCache(urls, readCatalogCache(ctx))?.entries ?? [],
          fetchedAt: readCatalogCache(ctx)?.fetchedAt ?? 0,
          stale: true,
        }
      }
      const refreshUrls = target === undefined ? urls : [target]
      const fetchedAt = Date.now()
      let cache = pruneCacheToUrls(readCatalogCache(ctx) ?? emptyCache(), urls)
      const fetched = await Promise.all(refreshUrls.map(url => fetchCatalog(ctx, url, resolved.catalogTimeoutMs)))
      for (const item of fetched) {
        const entries = item.ok ? item.entries : cache.sources.find(source => source.url === item.source.url)?.entries ?? []
        cache = mergeCachedSource(cache, cachedSourceFromFetch(item.source, entries), fetchedAt)
      }
      writeCatalogCache(ctx, cache)
      const snapshot = snapshotFromCache(urls, cache)
      return snapshot === undefined
        ? { configured: true, sources: [], entries: [], fetchedAt, stale: false }
        : { ...snapshot, fetchedAt, stale: false, refreshing: false }
    },
    install(request: { name: string; version?: string }): Promise<PluginMutationResult> {
      return serialize(async () => {
        if (!isRegistryPackageName(request.name)) {
          return fail('package-invalid', 'install accepts one npm registry package name')
        }
        if (request.version !== undefined && request.version.length > 0 && !isInstallVersion(request.version)) {
          return fail('version-invalid', 'install version must be a semver or tag fragment')
        }
        return runPnpm(ctx, ['add', installSpec(request.name, request.version)])
      })
    },
    uninstall(request: { name: string }): Promise<PluginMutationResult> {
      return serialize(async () => {
        if (!isRegistryPackageName(request.name)) {
          return fail('package-invalid', 'uninstall accepts one npm registry package name')
        }
        if (request.name === MARKETPLACE_BUNDLE_PACKAGE) {
          return fail('protected', 'the marketplace bundle cannot uninstall itself')
        }
        const profile = requireProfile(ctx)
        const manifest = readProfileManifest('plugin-marketplace', profile.dir)
        if (manifest.dependencies?.[request.name] === undefined) {
          return fail('not-installed', `${request.name} is not a profile dependency`)
        }
        return runPnpm(ctx, ['remove', request.name])
      })
    },
    setEnabled(request: SetEnabledRequest): Promise<PluginEnableResult> {
      return serialize(async () => {
        if (request.entryId === MARKETPLACE_HOST_ENTRY_ID || request.entryId === MARKETPLACE_CLIENT_ENTRY_ID) {
          return fail('protected', 'the marketplace entries cannot be disabled from the marketplace')
        }
        const listed = marketplace.listInstalled().entries.find(entry => entry.entryIds.includes(request.entryId))
        if (listed === undefined) {
          return fail('entry-missing', `no installed plugin owns entry ${request.entryId}`)
        }
        if (!listed.canToggle) {
          return fail('not-toggleable', `${listed.packageName} cannot be enabled or disabled as a single entry`)
        }
        const profile = requireProfile(ctx)
        const patches = readProfilePatches('plugin-marketplace', {
          name: profile.name,
          dir: profile.dir,
          patchPath: join(profile.dir, 'cordis.patch.yml'),
          installAnchor: profile.installAnchor,
          cwd: profile.dir,
          home: profile.dir,
          startedBundles: [],
          overlays: [],
          telemetryDisabledEnv: undefined,
        })
        writeProfilePatches(profile.dir, applyEnablement(patches, request.entryId, request.enabled))
        return { ok: true }
      })
    },
    async setPluginNote(request: { name: string; note: string; tags: readonly string[] }): Promise<PluginEnableResult> {
      if (request.name.trim().length === 0) return fail('package-invalid', 'note requires a package name')
      await writePluginNotes(ctx, writeNote(readPluginNotes(ctx), request.name, request))
      return { ok: true }
    },
  }

  async function serialize<T extends PluginMutationResult | PluginEnableResult>(work: () => Promise<T>): Promise<T> {
    if (inflight !== undefined) return fail('busy', 'another marketplace mutation is still running') as T
    const run = work()
    inflight = run
    try { return await run }
    finally { inflight = undefined }
  }

  const connection = ctx.get('connection') as {
    rpc: { handle: (channel: string, handler: (endpoint: string, payload: unknown) => unknown, options: { authority: 'loopback' }) => void }
  }
  connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
    try {
      switch (endpoint) {
        case 'listInstalled':
          return { ok: true, value: marketplace.listInstalled() }
        case 'listCommandTargets':
          return { ok: true, value: marketplace.listCommandTargets() }
        case 'listCatalog':
          return { ok: true, value: marketplace.listCatalog() }
        case 'refreshCatalog':
          return { ok: true, value: await marketplace.refreshCatalog(payload as { url?: string }) }
        case 'install':
          return { ok: true, value: await marketplace.install(payload as { name: string; version?: string }) }
        case 'uninstall':
          return { ok: true, value: await marketplace.uninstall(payload as { name: string }) }
        case 'setEnabled':
          return { ok: true, value: await marketplace.setEnabled(payload as SetEnabledRequest) }
        case 'setPluginNote':
          return { ok: true, value: await marketplace.setPluginNote(payload as { name: string; note: string; tags: readonly string[] }) }
        case 'reloadStatus':
          return { ok: true, value: reloadLive }
        default:
          return { ok: false, error: { code: 'NOT_FOUND', message: 'unknown marketplace endpoint' } }
      }
    } catch (error) {
      return {
        ok: false,
        error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) },
      }
    }
  }, { authority: 'loopback' })
}

const CLIENT_HMR_NS = settingsNamespace(CLIENT_HMR_NAMESPACE)

function pinClientAutoReloadOff(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx.get('settings') as {
      get?: (ns: unknown) => { autoReload?: boolean }
      update?: (ns: unknown, patch: object) => Promise<unknown>
    } | undefined
    if (settings === undefined) return
    let pinning = false
    const pin = (): void => {
      if (pinning) return
      const write = pinAutoReloadOff(settings, CLIENT_HMR_NS)
      if (write === undefined) return
      pinning = true
      void Promise.resolve(write).finally(() => {
        pinning = false
      })
    }
    pin()
    const off = settingsCtx.on('settings/updated', (ns: unknown) => {
      if (String(ns) === CLIENT_HMR_NAMESPACE) pin()
    })
    settingsCtx.effect(() => () => {
      off()
    }, 'plugin-marketplace: pin client-hmr.autoReload off')
  })
}

function requireProfile(ctx: Context): ProfileHandle {
  const profile = ctx.get('profile') as ProfileHandle | undefined
  if (profile === undefined) throw new Error('plugin-marketplace: ctx.profile is required')
  return profile
}

function settingsSection(ctx: Context): {
  catalogUrls?: unknown
  catalogUrl?: unknown
  catalogCache?: unknown
  pluginNotes?: unknown
} | undefined {
  return (ctx.get('settings') as {
    get?: (ns: unknown) => {
      catalogUrls?: unknown
      catalogUrl?: unknown
      catalogCache?: unknown
      pluginNotes?: unknown
    }
  } | undefined)?.get?.(SETTINGS_NS)
}

function readPluginNotes(ctx: Context): PluginNotes {
  const raw = settingsSection(ctx)?.pluginNotes
  return isPluginNotes(raw) ? raw : {}
}

async function writePluginNotes(ctx: Context, notes: PluginNotes): Promise<void> {
  const settings = ctx.get('settings') as {
    update?: (ns: unknown, patch: object) => Promise<unknown>
  } | undefined
  if (settings?.update === undefined) return
  try {
    await Promise.resolve(settings.update(SETTINGS_NS, { pluginNotes: notes }))
  } catch (error: unknown) {
    console.error('plugin-marketplace: plugin notes write failed', error)
    throw error
  }
}

function readCatalogCache(ctx: Context): CatalogCache | undefined {
  const raw = settingsSection(ctx)?.catalogCache
  return isCatalogCache(raw) ? raw : undefined
}

function writeCatalogCache(ctx: Context, cache: CatalogCache): void {
  const settings = ctx.get('settings') as {
    update?: (ns: unknown, patch: object) => Promise<unknown>
  } | undefined
  if (settings?.update === undefined) return
  void Promise.resolve(settings.update(SETTINGS_NS, { catalogCache: cache })).catch((error: unknown) => {
    console.error('plugin-marketplace: catalog cache write failed', error)
  })
}

function effectiveCatalogUrls(ctx: Context, fallback: readonly string[]): string[] {
  const section = settingsSection(ctx)
  const fromSettings = normalizeCatalogUrls(section?.catalogUrls ?? section?.catalogUrl)
  return fromSettings.length > 0 ? fromSettings : [...fallback]
}

function resolveCatalogFetchUrl(ctx: Context, url: string): string {
  if (url !== '/plugin-catalog/catalog.json') return url
  const server = ctx.get('webServer') as { host?: string; port?: number } | undefined
  if (typeof server?.port !== 'number') {
    throw new Error('plugin-marketplace: shipped catalog needs the web server port')
  }
  const host = server.host === '0.0.0.0' ? '127.0.0.1' : (server.host ?? '127.0.0.1')
  return `http://${host}:${String(server.port)}${url}`
}

/**
 * Read the shipped catalog straight from the profile's installed
 * `dsh-host-plugin-catalog` package. Desktop Hosts run without a web server,
 * so the in-box path has no HTTP route to self-fetch; the file ships inside
 * the same profile the route would serve from.
 * @param ctx - plugin context carrying the `profile` service.
 * @param url - the in-box catalog path.
 * @returns the parsed catalog, or the structured fetch failure.
 */
function readShippedCatalog(
  ctx: Context,
  url: string,
): Promise<
  | { readonly ok: true; readonly source: CatalogSource; readonly entries: readonly CatalogPlugin[] }
  | { readonly ok: false; readonly source: CatalogSource }
> {
  const source: CatalogSource = { url, title: sourceTitleFromUrl(url), ok: false, count: 0 }
  try {
    const file = join(requireProfile(ctx).dir, 'node_modules', '@deepseek-ai', 'dsh-host-plugin-catalog', 'catalog.json')
    const buffer = readFileSync(file)
    if (buffer.byteLength > MAX_CATALOG_BYTES) {
      return Promise.resolve({ ok: false, source: { ...source, error: 'catalog too large' } })
    }
    const document = parseCatalogDocument(JSON.parse(buffer.toString('utf8')), url)
    if (!document.ok) return Promise.resolve({ ok: false, source: { ...source, error: document.message } })
    return Promise.resolve({
      ok: true,
      source: { url, title: document.title, ok: true, count: document.entries.length },
      entries: document.entries.map(entry => ({ ...entry, sourceUrl: url, sourceTitle: document.title })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Promise.resolve({ ok: false, source: { ...source, error: `shipped catalog unreadable: ${message}` } })
  }
}

async function fetchCatalog(
  ctx: Context,
  url: string,
  timeoutMs: number,
): Promise<
  | { readonly ok: true; readonly source: CatalogSource; readonly entries: readonly CatalogPlugin[] }
  | { readonly ok: false; readonly source: CatalogSource }
> {
  if (!isCatalogUrl(url) || url.length === 0) {
    return {
      ok: false,
      source: { url, title: sourceTitleFromUrl(url), ok: false, error: 'URL must be http(s) or the shipped catalog path', count: 0 },
    }
  }
  if (url === BUILTIN_CATALOG_PATH) {
    const server = ctx.get('webServer') as { port?: number } | undefined
    if (typeof server?.port !== 'number') return readShippedCatalog(ctx, url)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetch(resolveCatalogFetchUrl(ctx, url), { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) {
      return {
        ok: false,
        source: { url, title: sourceTitleFromUrl(url), ok: false, error: `HTTP ${String(response.status)}`, count: 0 },
      }
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength > MAX_CATALOG_BYTES) {
      return {
        ok: false,
        source: { url, title: sourceTitleFromUrl(url), ok: false, error: 'catalog too large', count: 0 },
      }
    }
    let parsed: unknown
    try { parsed = JSON.parse(buffer.toString('utf8')) }
    catch {
      return {
        ok: false,
        source: { url, title: sourceTitleFromUrl(url), ok: false, error: 'catalog is not JSON', count: 0 },
      }
    }
    const document = parseCatalogDocument(parsed, url)
    if (!document.ok) {
      return { ok: false, source: { url, title: sourceTitleFromUrl(url), ok: false, error: document.message, count: 0 } }
    }
    return {
      ok: true,
      source: { url, title: document.title, ok: true, count: document.entries.length },
      entries: document.entries.map(entry => ({ ...entry, sourceUrl: url, sourceTitle: document.title })),
    }
  } catch (error) {
    return {
      ok: false,
      source: {
        url,
        title: sourceTitleFromUrl(url),
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        count: 0,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

function runPnpm(ctx: Context, args: readonly string[]): PluginMutationResult {
  const profile = requireProfile(ctx)
  const before = readProfileManifest('plugin-marketplace', profile.dir)
  const result = runProfilePnpm({ profileDir: profile.dir, args, stdio: 'pipe' })
  if (result.missingPnpm) {
    return fail('pnpm-missing', 'pnpm is not on PATH; install pnpm to manage profile plugins')
  }
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `pnpm exited ${String(result.exitCode)}`
    return fail('pnpm-failed', detail)
  }
  reconcileProfilePlugins({
    binName: 'plugin-marketplace',
    installAnchor: profile.installAnchor,
    profileDir: profile.dir,
    before: { manifest: before, dependencies: [] },
    preserveDisabled: true,
  })
  return { ok: true, restartRequired: true }
}

function mergePhase(left: PluginFiberPhase, right: PluginFiberPhase): PluginFiberPhase {
  if (left === right) return left
  if (left === null) return right
  if (right === null) return left
  return 'mixed'
}

function applyEnablement(patches: readonly PatchOptions[], entryId: string, enabled: boolean): PatchOptions[] {
  const next = patches.map(patch => ({ ...patch }))
  const index = next.findIndex(patch => patch.id === entryId && patch.insert === undefined)
  if (enabled) {
    if (index === -1) return next
    const row = next[index]
    if (row === undefined) return next
    const current = { ...row }
    delete current.disabled
    if (Object.keys(current).filter(key => key !== 'id').length === 0) {
      next.splice(index, 1)
      return next
    }
    next[index] = current
    return next
  }
  if (index === -1) {
    next.push({ id: entryId, disabled: true })
    return next
  }
  next[index] = { ...next[index], disabled: true }
  return next
}
