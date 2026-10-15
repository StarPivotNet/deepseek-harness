/** Web SSE transport for page-owned client entry reconciliation and rebuilt code replacement. */
import type { Context } from '@deepseek-ai/cordis'
import { EventSourceParserStream } from 'eventsource-parser/stream'
import type { PluginsEventParseResult } from '../events.ts'
import { EVENTS_ROUTE, RELOAD_ENDPOINT, parsePluginsEventFrame } from '../events.ts'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ReloadRow, type ReloadRowInjected } from './ReloadRow.tsx'
import { en, zh, type HmrSettingsKey } from './locales.ts'
import { ClientHmrReloadPolicy } from './reload-policy.ts'
import { CLIENT_HMR_SETTINGS_NAMESPACE, type ClientHmrSettings } from '../hmr-settings.ts'

export type { PluginsEventFrame } from '../events.ts'
export { EVENTS_ENDPOINT, EVENTS_ROUTE, RELOAD_ENDPOINT } from '../events.ts'
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
export const inject = ['loader', 'modules', 'slots', 'locale', 'connection', 'remote', 'settingsScope']

/** Request carrier a shell installs when it owns the page transport, such as the worker preview's tunnel. */
type PageTransportFetch = (input: string, init: RequestInit) => Promise<Response>

/** Page global carrying the shell transport; absent in the served web app. */
interface PageTransportGlobal {
  __DSH_TRANSPORT__?: { fetch?: PageTransportFetch }
}

/**
 * Read the document-relative events route through a shell-owned transport until it closes or `signal` aborts.
 * @param fetch - The shell's request carrier.
 * @param signal - Aborts the stream when the plugin disposes.
 * @param receive - Handles one SSE `data` payload.
 * @throws Error when the Host refuses the stream or the stream ends while the plugin is active.
 */
async function readPageTransportEvents(fetch: PageTransportFetch, signal: AbortSignal, receive: (data: string) => void): Promise<void> {
  const response = await fetch(EVENTS_ROUTE, { method: 'GET', headers: { accept: 'text/event-stream' }, signal })
  if (!response.ok || response.body === null) {
    throw new Error(`client-hmr: ${EVENTS_ROUTE} answered ${String(response.status)}`)
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream()).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    receive(value.data)
  }
  if (!signal.aborted) throw new Error(`client-hmr: ${EVENTS_ROUTE} closed; client graph changes stop until the page reloads`)
}

/**
 * Forward graph snapshots and rebuilds to the page's shared serial controller. The event stream arrives through the
 * shell transport when the page has one, otherwise through the browser `EventSource`.
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
  const receive = (data: string): void => {
    let value: unknown
    try {
      value = JSON.parse(data)
    } catch {
      // Wire boundary: a malformed transport frame is dropped loudly.
      ctx.logger.warn(`client-hmr: unparseable event frame: ${data}`)
      return
    }
    const parsed = parsePluginsEventFrame(value)
    if (parsed.kind === 'invalid') {
      ctx.logger.warn(`client-hmr: invalid event frame: ${data}`)
    } else if (parsed.kind === 'frame') {
      handle(parsed.frame)
    }
  }

  ctx.effect(() => {
    const transport = (globalThis as PageTransportGlobal).__DSH_TRANSPORT__
    if (transport?.fetch !== undefined) {
      const controller = new AbortController()
      void readPageTransportEvents(transport.fetch, controller.signal, receive).catch((error: unknown) => {
        if (!controller.signal.aborted) ctx.logger.error(error)
      })
      return () => { controller.abort() }
    }
    const source = new EventSource(EVENTS_ROUTE)
    source.addEventListener('message', (event: MessageEvent<string>) => { receive(event.data) })
    return () => { source.close() }
  }, 'client-hmr: event source')
}
