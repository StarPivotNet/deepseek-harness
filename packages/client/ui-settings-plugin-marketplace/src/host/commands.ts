/** Register /reload, /update, and /reboot on the Host command registry. */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import {
  readProfileManifest,
  reconcileProfilePlugins,
  runProfilePnpm,
} from '@deepseek-ai/dsh-app-boot'
import {
  formatReloadAccepted, formatReloadFinished, formatReloadOutcome, matchReloadTarget,
  partitionReloadEntries, reloadHostEntry, requestBrowserReload, selectClientReloadIds,
  selectReloadEntries, type ReloadableEntry, type ReloadMatchResult,
  type ReloadProgress,
} from './reload.ts'
import { resolveUpdateTarget } from './update.ts'
import { buildRebootSpec, desktopOwnsHost, rebootBlocked, startWatchdog, writeRebootSpec } from './reboot.ts'

export function registerMarketplaceCommands(ctx: Context, options: {
  requireProfile: () => { dir: string; installAnchor: string }
  webPort: () => number | undefined
  exitProcess: () => void
  settingsNs: unknown
  publishReload?: (progress: ReloadProgress, extra?: {
    nonce?: number
    clientIds?: readonly string[]
    names?: readonly string[]
    rebootNonce?: number
  }) => void
}): void {
  ctx.commands.register({
    name: 'reload',
    description: '重载插件。不写名字则重载除连接骨架外的全部插件。',
    input: { hint: '[插件名字]' },
    handler: invocation => handleReload(ctx, options, invocation.rawInput),
  })
  ctx.commands.register({
    name: 'update',
    description: '更新已安装的 profile 插件，不会热重载。',
    input: { hint: '[插件名字]' },
    handler: invocation => handleUpdate(options.requireProfile(), invocation.rawInput),
  })
  ctx.commands.register({
    name: 'reboot',
    description: '重启 dsh 进程，页面会自动刷新。',
    handler: async () => {
      const blocked = rebootBlocked()
      if (blocked !== undefined) return { kind: 'error', text: blocked }
      if (!desktopOwnsHost()) {
        const port = options.webPort()
        const spec = buildRebootSpec(port === undefined ? {} : { port })
        const specPath = writeRebootSpec(spec)
        const watchdogPath = resolveWatchdogPath()
        const started = await startWatchdog(watchdogPath, specPath)
        if (!started.ok) return { kind: 'error', text: started.message }
      }
      scheduleRebootExit(ctx)
      return { kind: 'success', text: '正在重启，页面即将刷新' }
    },
  })
}

/** Persist command/done, then exit. ctx.appExit does not kill the web process. */
function scheduleRebootExit(ctx: Context): void {
  // command/done is appended after this handler returns. Exiting on the
  // next microtask drops that line and leaves the card looking finished
  // from a leftover reboot flag instead of still pending.
  setTimeout(() => {
    void (async () => {
      const sessions = ctx.get('sessions') as {
        list?: () => Iterable<{ id?: string }>
        flush?: (session: { id?: string }) => Promise<unknown>
      } | undefined
      if (sessions?.list !== undefined && sessions.flush !== undefined) {
        for (const session of sessions.list()) {
          try { await sessions.flush(session) }
          catch { /* still exit so the watchdog can start the next process */ }
        }
      }
      process.exit(0)
    })()
  }, 400)
}

async function handleReload(
  ctx: Context,
  options: {
    settingsNs: unknown
    publishReload?: (progress: ReloadProgress, extra?: {
      nonce?: number
      clientIds?: readonly string[]
      names?: readonly string[]
      rebootNonce?: number
    }) => void
  },
  rawInput: string,
): Promise<{ kind: 'success' | 'error'; text: string }> {
  const planned = planReload(ctx, rawInput)
  if (planned.kind !== 'ok') return planned
  try {
    return await runReloadQueue(ctx, options, planned.ordered, planned.clientIds)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: `重载失败：${message}` }
  }
}

function planReload(
  ctx: Context,
  rawInput: string,
):
  | { kind: 'success' | 'error'; text: string }
  | { kind: 'ok'; ordered: ReloadableEntry[]; clientIds: readonly string[]; matched: Extract<ReloadMatchResult, { kind: 'all' } | { kind: 'one' }> } {
  const entries = [...ctx.loader.entries()]
    .filter(entry => !entry.options.group)
    .map((entry): ReloadableEntry => ({
      id: entry.id,
      moduleName: String(entry.options.name ?? ''),
      enabled: !entry.disabled,
      get fiber() { return entry.fiber as ReloadableEntry['fiber'] },
      set fiber(value) {
        (entry as { fiber?: Fiber | undefined }).fiber = value as Fiber | undefined
      },
      refresh: () => entry.refresh(),
      reload: async () => {
        const fiber = entry.fiber
        if (fiber !== undefined) {
          delete (entry as { fiber?: typeof fiber }).fiber
          await fiber.dispose()
          while (fiber.inertia !== undefined) await fiber.inertia
        }
        await entry.refresh()
      },
    }))
  const matched = matchReloadTarget(entries, rawInput)
  if (matched.kind === 'none') {
    const hint = matched.suggestions.length > 0 ? ` 是不是指：${matched.suggestions.join('、')}` : ''
    return { kind: 'error', text: `没有匹配 ${JSON.stringify(matched.query)} 的插件。${hint}` }
  }
  if (matched.kind === 'ambiguous') {
    return {
      kind: 'error',
      text: `有多个插件匹配 ${JSON.stringify(matched.query)}：${matched.matches.map(entry => entry.id).join('、')}`,
    }
  }
  const picked = selectReloadEntries(entries, matched)
  const clientIds = listClientReloadIds(ctx, matched)
  if (!picked.ok) {
    if (clientIds.length > 0) return { kind: 'ok', ordered: [], clientIds, matched }
    return { kind: 'error', text: picked.message }
  }
  const ordered = orderReloadQueue(picked.selected)
  if (ordered.length === 0 && clientIds.length === 0) {
    return { kind: 'success', text: '没有可热重载的插件。连接骨架请用 /reboot。' }
  }
  return { kind: 'ok', ordered, clientIds, matched }
}

function listClientReloadIds(
  ctx: Context,
  matched: Extract<ReloadMatchResult, { kind: 'all' } | { kind: 'one' }>,
): readonly string[] {
  const modules = ctx.get('clientModules') as {
    graph?: () => { entries?: readonly { id?: string }[] }
  } | undefined
  const ids = (modules?.graph?.().entries ?? [])
    .map(entry => entry.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  return selectClientReloadIds(ids, matched)
}

async function publishProgress(
  ctx: Context,
  options: {
    settingsNs: unknown
    publishReload?: (progress: ReloadProgress, extra?: {
      nonce?: number
      clientIds?: readonly string[]
      names?: readonly string[]
      rebootNonce?: number
    }) => void
  },
  progress: ReloadProgress,
  extra?: { nonce?: number; clientIds?: readonly string[]; names?: readonly string[] },
): Promise<void> {
  const settings = ctx.get('settings') as {
    update?: (ns: unknown, patch: object) => Promise<unknown>
  } | undefined
  options.publishReload?.(progress, extra)
  await settings?.update?.(options.settingsNs, {
    reloadProgress: progress,
    ...extra?.names === undefined ? {} : { reloadNames: [...extra.names] },
    ...extra?.clientIds === undefined ? {} : { reloadClientIds: [...extra.clientIds] },
  })
}

async function runReloadQueue(
  ctx: Context,
  options: {
    settingsNs: unknown
    publishReload?: (progress: ReloadProgress, extra?: {
      nonce?: number
      clientIds?: readonly string[]
      names?: readonly string[]
      rebootNonce?: number
    }) => void
  },
  ordered: readonly ReloadableEntry[],
  clientIds: readonly string[],
): Promise<{ kind: 'success' | 'error'; text: string }> {
  const settings = ctx.get('settings') as {
    get?: (ns: unknown) => { reloadNonce?: number }
    update?: (ns: unknown, patch: object) => Promise<unknown>
  } | undefined
  const { others, marketplace } = partitionReloadEntries(ordered)
  const names = [...others, ...marketplace].map(entry => entry.id)
  for (const id of clientIds) {
    if (!names.includes(id)) names.push(id)
  }
  const accepted = formatReloadAccepted(
    [...others, ...marketplace],
    clientIds,
  )
  await publishProgress(ctx, options, {
    phase: 'running',
    current: others[0]?.id ?? clientIds[0] ?? '',
    index: 0,
    total: names.length,
    ok: 0,
    failed: 0,
    message: accepted,
  }, { clientIds, names })
  const failures: string[] = []
  let ok = 0
  let index = 0
  for (const entry of others) {
    index += 1
    await publishProgress(ctx, options, {
      phase: 'running',
      current: entry.id,
      index,
      total: names.length,
      ok,
      failed: failures.length,
      message: `正在重载 ${entry.id}（${String(index)}/${String(names.length)}）`,
    }, { clientIds, names })
    const result = await reloadHostEntry(entry)
    if (result.ok) ok += 1
    else failures.push(`${entry.id}: ${result.message}`)
  }
  const finished = ok + marketplace.length
  const summary = formatReloadFinished(finished, failures.length)
  const text = formatReloadOutcome(summary, names)
  await publishProgress(ctx, options, {
    phase: 'done',
    current: '',
    index: others.length,
    total: names.length,
    ok: finished,
    failed: failures.length,
    message: summary,
  }, { clientIds, names })
  // command/done is appended after this handler returns. A microtask would
  // dispose the marketplace first and drop the settlement, leaving a
  // non-expandable running row. Wait for the next macrotask instead.
  setTimeout(() => {
    void (async () => {
      for (const entry of marketplace) {
        await reloadHostEntry(entry)
      }
      await requestBrowserReload(settings, options.settingsNs, clientIds, names)
      const nonce = settings?.get?.(options.settingsNs)?.reloadNonce ?? 0
      options.publishReload?.({
        phase: 'done',
        current: '',
        index: others.length + marketplace.length,
        total: names.length,
        ok: finished,
        failed: failures.length,
        message: summary,
      }, { nonce, clientIds, names })
    })().catch((error: unknown) => {
      console.error('plugin-marketplace: trailing reload failed', error)
    })
  }, 50)
  return {
    kind: failures.length === 0 ? 'success' : 'error',
    text,
  }
}

function orderReloadQueue(entries: readonly ReloadableEntry[]): ReloadableEntry[] {
  const { others, marketplace } = partitionReloadEntries(entries)
  return [...others, ...marketplace]
}

function handleUpdate(
  profile: { dir: string; installAnchor: string },
  rawInput: string,
): { kind: 'success' | 'error'; text: string } {
  const manifest = readProfileManifest('plugin-marketplace', profile.dir)
  const dependencies = Object.keys(manifest.dependencies ?? {})
  const matched = resolveUpdateTarget(dependencies, rawInput)
  if (matched.kind === 'none') {
    return { kind: 'error', text: `${JSON.stringify(matched.query)} 不是 profile 依赖，不能更新。` }
  }
  if (matched.kind === 'ambiguous') {
    return { kind: 'error', text: `有多个依赖匹配：${matched.matches.join('、')}` }
  }
  const args = matched.kind === 'all' ? ['update'] : ['update', matched.name]
  const before = readProfileManifest('plugin-marketplace', profile.dir)
  const result = runProfilePnpm({ profileDir: profile.dir, args, stdio: 'pipe' })
  if (result.missingPnpm) return { kind: 'error', text: '找不到 pnpm，请先安装 pnpm 再更新插件。' }
  if (result.exitCode !== 0) {
    return { kind: 'error', text: result.stderr.trim() || result.stdout.trim() || `pnpm 退出码 ${String(result.exitCode)}` }
  }
  reconcileProfilePlugins({
    binName: 'plugin-marketplace',
    installAnchor: profile.installAnchor,
    profileDir: profile.dir,
    before: { manifest: before, dependencies: [] },
    preserveDisabled: true,
  })
  return {
    kind: 'success',
    text: '已更新。要加载新代码请运行 /reload；要重启进程请运行 /reboot。',
  }
}

/** Built watchdog first; source path keeps `/reboot` working under tsx. */
function resolveWatchdogPath(): string {
  const here = fileURLToPath(import.meta.url)
  const built = here.replace(/[/\\]src[/\\]host[/\\]commands\.ts$/, '/lib/reboot-watchdog.js')
    .replace(/[/\\]lib[/\\]types[/\\]host[/\\]commands\.js$/, '/lib/reboot-watchdog.js')
    .replace(/[/\\]host[/\\]commands\.js$/, '/reboot-watchdog.js')
  if (built !== here && existsSync(built)) return built
  return here.replace(/commands\.[cm]?js$/, 'reboot-watchdog.ts').replace(/commands\.ts$/, 'reboot-watchdog.ts')
}
