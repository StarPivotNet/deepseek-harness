/** Web SSE transport for page-owned client entry reconciliation and rebuilt code replacement. */
import type { Context } from '@deepseek-ai/cordis'
import type { PluginsEventParseResult } from '../events.ts'
import { EVENTS_ENDPOINT, RELOAD_ENDPOINT, parsePluginsEventFrame } from '../events.ts'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ReloadRow, type ReloadRowInjected } from './ReloadRow.tsx'
import { en, zh, type HmrSettingsKey } from './locales.ts'
import { ClientHmrReloadPolicy } from './reload-policy.ts'
import { CLIENT_HMR_SETTINGS_NAMESPACE, type ClientHmrSettings } from '../hmr-settings.ts'

export type { PluginsEventFrame } from '../events.ts'
export { EVENTS_ENDPOINT, RELOAD_ENDPOINT } from '../events.ts'
export type { ReloadRowInjected, ReloadRowProps } from './ReloadRow.tsx'
export type { HmrSettingsKey } from './locales.ts'
export {
  AUTO_RELOAD_FIELD, CLIENT_HMR_SETTINGS_NAMESPACE, DEFAULT_AUTO_RELOAD,
  type ClientHmrSettings,
} from '../hmr-settings.ts'

/** Namespace owning this feature's settings-row copy. */
export const SETTINGS_NS = 'settings.hmr'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The plugin-reload settings row's copy. */
    'settings.hmr': HmrSettingsKey
  }
}

/** Cordis plugin name. */
export const name = 'client-hmr'

/** Required service: the client module system whose entry controller handles received frames. */
export const inject = ['modules', 'slots', 'locale', 'settingsScope']

/**
 * Forward graph snapshots and rebuilds to the page's shared serial controller.
 * @param ctx - Plugin context with the client module system.
 */
export function apply(ctx: Context): void {
  const policy = new ClientHmrReloadPolicy(
    ctx.settingsScope.bind<ClientHmrSettings>({ namespace: CLIENT_HMR_SETTINGS_NAMESPACE }),
  )
  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'client-hmr: settings row dictionaries')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'plugin-reload',
    order: 30,
    locale: SETTINGS_NS,
    inject: (): ReloadRowInjected => ({
      hooks: { autoReload: policy.autoReload },
      setAutoReload: (enabled) => { policy.setAutoReload(enabled) },
      reloadPlugins: async () => {
        const response = await fetch(RELOAD_ENDPOINT, { method: 'POST' })
        if (!response.ok) throw new Error(`client-hmr: manual reload failed with HTTP ${String(response.status)}`)
        const body = await response.json() as { ok?: boolean; reloaded?: number }
        if (body.ok !== true || typeof body.reloaded !== 'number') {
          throw new Error('client-hmr: manual reload returned an invalid body')
        }
        return body.reloaded
      },
    }),
  }, ReloadRow))
  const entries = ctx.modules.entries
  const handle = (frame: Extract<PluginsEventParseResult, { kind: 'frame' }>['frame']): void => {
    const run = frame.type === 'graph'
      ? Promise.resolve().then(() => entries.sync(frame.graph))
      : entries.reload(frame.id, frame.rev)
    void run.catch((error: unknown) => { ctx.logger.error(error) })
  }

  ctx.effect(() => {
    const source = new EventSource(EVENTS_ENDPOINT)
    source.addEventListener('message', (event: MessageEvent<string>) => {
      let value: unknown
      try {
        value = JSON.parse(event.data) as unknown
      } catch {
        // Wire boundary: a malformed transport frame is dropped loudly.
        ctx.logger.warn(`client-hmr: unparseable event frame: ${event.data}`)
        return
      }
      const parsed = parsePluginsEventFrame(value)
      if (parsed.kind === 'invalid') {
        ctx.logger.warn(`client-hmr: invalid event frame: ${event.data}`)
      } else if (parsed.kind === 'frame') {
        handle(parsed.frame)
      }
    })
    return () => { source.close() }
  }, 'client-hmr: event source')
}
