/** In-box marketplace page. Mounts over the shipped Plugins settings section. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CommandUiContract } from '@deepseek-ai/dsh-client-ui-commands/client'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  MarketplaceSettingsSection,
  type MarketplaceMutationResult,
  type MarketplaceSettingsSectionInjected,
} from './MarketplaceSettingsSection.tsx'
import { commandLine, reloadPickOptions, updatePickOptions, type CommandTargets } from './command-picker.ts'
import { ReloadCommandCard } from './ReloadCommandCard.tsx'
import { ReloadProgressToast } from './ReloadProgressToast.tsx'
import { reloadMarketplacePage, type MarketplacePageReloadHost } from './reload-page.ts'
import {
  asReloadStatus, progressFromStatus, sameReloadStatus,
  statusFromMarketplaceSettings, storedRebootNonce, type ReloadStatus,
} from './reload-status.ts'
import { en, zh } from './locales.ts'

export const NS = 'settings.pluginMarketplace'
export { MARKETPLACE_CLIENT_PACKAGE } from './reload-page.ts'
export const inject = ['slots', 'locale', 'settingsScope', 'connection', 'loader', 'modules', 'commandUi', 'sessions']

type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

function marketplaceCaller(ctx: ClientContext): <T>(method: string, body?: unknown) => Promise<T> {
  const rpc = (ctx.get('connection') as {
    rpc: { call: (channel: string, endpoint: string, payload: unknown) => Promise<RpcResult<unknown>> }
  }).rpc
  return async <T>(method: string, body?: unknown): Promise<T> => {
    const payload = await rpc.call('/plugin-marketplace', method, body ?? {})
    if (!payload.ok) {
      throw new Error('pluginMarketplace.' + method + ' failed: ' + payload.error.message)
    }
    return payload.value as T
  }
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-marketplace: dictionaries')
  const t = ctx.locale.bind(NS)
  const catalogScope = ctx.settingsScope.bind<{
    catalogUrls: string[]
    reloadNonce?: number
    rebootNonce?: number
    reloadClientIds?: string[]
    reloadNames?: string[]
    reloadProgress?: {
      phase?: 'idle' | 'running' | 'done'
      current?: string
      index?: number
      total?: number
      ok?: number
      failed?: number
      message?: string
    }
  }>({
    namespace: 'plugin-marketplace',
  })
  const callMarketplace = marketplaceCaller(ctx)
  const host = document.createElement('div')
  host.dataset.pluginMarketplaceReload = 'true'
  document.body.append(host)
  const root: Root = createRoot(host)
  let reloadStatus: ReloadStatus | undefined
  let lastNonce: number | undefined
  let lastRebootNonce: number | undefined
  let pendingRebootNonce: number | undefined
  let toastLive = false
  const rebootSettled = storedRebootNonce() !== undefined
  let pageReload = Promise.resolve()
  const listeners = new Set<() => void>()
  const connection = ctx.get('connection') as {
    hostDescription?: {
      getSnapshot(): unknown
      subscribe(listener: () => void): () => void
    }
  }
  const hostIsUp = (): boolean => connection.hostDescription?.getSnapshot() !== undefined
  const reloadForReboot = (rebootNonce: number, nonce: number): void => {
    lastRebootNonce = rebootNonce
    lastNonce = nonce
    pendingRebootNonce = undefined
    sessionStorage.setItem('dsh-marketplace-rebooted', String(rebootNonce))
    window.location.reload()
  }
  const renderToast = (): void => {
    root.render(createElement(ReloadProgressToast, {
      progress: progressFromStatus(reloadStatus),
      live: toastLive,
      t,
    }))
  }
  const adoptStatus = (next: ReloadStatus | undefined, triggerPageReload: boolean): void => {
    if (sameReloadStatus(reloadStatus, next)) return
    const previous = reloadStatus
    reloadStatus = next
    if (lastNonce !== undefined && next !== undefined && (
      next.phase === 'running' || (next.phase === 'done' && previous?.phase === 'running')
    )) {
      toastLive = true
    }
    for (const listener of listeners) listener()
    renderToast()
    const nonce = next?.nonce ?? 0
    const rebootNonce = next?.rebootNonce ?? 0
    if (lastNonce === undefined) lastNonce = nonce
    if (lastRebootNonce === undefined) lastRebootNonce = rebootNonce
    // Only a new Host process bumps rebootNonce. A websocket reconnect is
    // not a reboot: reloading then races the still-composing plugin graph
    // and blanks the window on a missing /plugins bundle.
    if (triggerPageReload && rebootNonce > lastRebootNonce) {
      if (hostIsUp()) {
        reloadForReboot(rebootNonce, nonce)
        return
      }
      lastRebootNonce = rebootNonce
      lastNonce = nonce
      pendingRebootNonce = rebootNonce
    }
    if (!triggerPageReload || nonce <= lastNonce || next === undefined) return
    lastNonce = nonce
    const loader = ctx.get('loader') as MarketplacePageReloadHost['loader']
    const modules = ctx.get('modules') as MarketplacePageReloadHost['modules']
    if (loader === undefined || modules === undefined) return
    pageReload = pageReload.then(async () => {
      await reloadMarketplacePage({ loader, modules }, next.clientIds)
    }).catch((error: unknown) => {
      console.error('plugin-marketplace: page reload failed', error)
    })
  }
  const adoptFromSettings = (): void => {
    adoptStatus(statusFromMarketplaceSettings(catalogScope.getSnapshot().value), true)
  }
  const pollReload = async (): Promise<void> => {
    try { adoptStatus(asReloadStatus(await callMarketplace('reloadStatus')), true) }
    catch { /* keep last known status */ }
  }
  try { sessionStorage.removeItem('dsh-marketplace-rebooted') }
  catch { /* private mode */ }
  const hostDescription = connection.hostDescription
  if (hostDescription !== undefined) {
    const offHost = hostDescription.subscribe(() => {
      if (pendingRebootNonce === undefined || !hostIsUp()) return
      reloadForReboot(pendingRebootNonce, lastNonce ?? 0)
    })
    ctx.effect(() => () => { offHost() }, 'plugin-marketplace: reboot page refresh')
  }
  renderToast()
  adoptFromSettings()
  const offReload = catalogScope.subscribe(adoptFromSettings)
  // Catch a reboot/reload that landed before this fiber subscribed.
  void pollReload()
  ctx.effect(() => () => {
    offReload()
    root.unmount()
    host.remove()
  }, 'plugin-marketplace: reload toast')

  const mutation = (value: { ok: true; restartRequired?: true } | { ok: false; message: string }): MarketplaceMutationResult => {
    if (!value.ok) return { ok: false, message: value.message }
    return value.restartRequired === true ? { ok: true, restartRequired: true } : { ok: true }
  }

  const injected = (): MarketplaceSettingsSectionInjected => ({
    listInstalled: () => callMarketplace('listInstalled'),
    listCatalog: () => callMarketplace('listCatalog'),
    refreshCatalog: url => callMarketplace('refreshCatalog', url === undefined ? {} : { url }),
    install: async (name, version) => mutation(await callMarketplace(
      'install',
      version === undefined ? { name } : { name, version },
    )),
    uninstall: async name => mutation(await callMarketplace('uninstall', { name })),
    setEnabled: async (entryId, enabled) => mutation(await callMarketplace('setEnabled', { entryId, enabled })),
    setPluginNote: async (name, note, tags) => mutation(await callMarketplace('setPluginNote', { name, note, tags })),
    catalogUrls: catalogScope.getSnapshot().value?.catalogUrls ?? [],
    setCatalogUrls: async (value) => { await catalogScope.set('catalogUrls', value) },
  })

  const commandCard = (props: {
    node: { name: string | null; outcome: { kind: 'success' | 'error'; text?: string } | null }
  }) => createElement(ReloadCommandCard, {
    node: props.node,
    progress: progressFromStatus(reloadStatus),
    names: reloadStatus?.names ?? [],
    rebootSettled,
    progressSource: {
      get: () => progressFromStatus(reloadStatus),
      names: () => reloadStatus?.names ?? [],
      rebootSettled: () => rebootSettled,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  })
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'reload',
    locale: NS,
  }, commandCard))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'reboot',
    locale: NS,
  }, commandCard))

  const command = ctx.get('commandUi') as CommandUiContract | undefined
  const sessions = ctx.get('sessions') as { get(id: string): SessionFace } | undefined
  if (command !== undefined && sessions !== undefined) {
    const decorateNamed = (name: 'reload' | 'update'): void => {
      ctx.effect(() => command.decorate({
        name,
        available: () => true,
        ui: {
          kind: 'popupSelect',
          options: async () => {
            const targets = await callMarketplace<CommandTargets>('listCommandTargets')
            return name === 'reload'
              ? reloadPickOptions(targets.reload, t('reloadAll'), t('reloadAllDetail'))
              : updatePickOptions(targets.update, t('updateAll'), t('updateAllDetail'))
          },
          onSelect: async (option, session) => {
            const live = sessions.get(session.sessionId)
            const result = await live.command(commandLine(name, option.id))
            if (!result.ok) throw new Error(`pluginMarketplace.${name} failed: ${result.error.message}`)
            if (!result.value.matched) throw new Error(`the host offers no /${name} command`)
          },
        },
      }), `plugin-marketplace: /${name} picker`)
    }
    decorateNamed('reload')
    decorateNamed('update')
  }

  // The Plugins settings page composes feature-owned tabs under
  // `settings.plugins.tab`; registering a competing `settings.section` with
  // the shell's own id would be dropped by the first-wins section dedupe.
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'discover',
    order: 5,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, MarketplaceSettingsSection))
}
