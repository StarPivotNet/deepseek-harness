/** Remote-stream transport for page-owned client entry reconciliation, rebuilt code replacement, and synced configuration. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteSnapshotStream, RemoteStreamCarrierError, type RemoteStreamCarrierFailure } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
import type {} from '@deepseek-ai/dsh-client-modules/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// This package mounts its own namespace, so the channel does not depend on the api-remotes assembly being replaceable.
import pluginEventsRemote from '@deepseek-ai/dsh-client-hmr/remote'
import type { PluginsEventBaseline, PluginsEventFrame, PluginsEventIncrement } from '../types.ts'
import { RELOAD_ENDPOINT } from '../reload-endpoint.ts'
import { ReloadRow, type ReloadRowInjected } from './ReloadRow.tsx'
import { en, zh, type HmrSettingsKey } from './locales.ts'
import { ClientHmrReloadPolicy } from './reload-policy.ts'
import { CLIENT_HMR_SETTINGS_NAMESPACE, DEFAULT_AUTO_RELOAD, type ClientHmrSettings } from '../hmr-settings.ts'

export type * from '../types.ts'
export { RELOAD_ENDPOINT } from '../reload-endpoint.ts'
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

/** Required services: the module system whose entry controller handles frames, the Remote carrier, and Remote access. */
export const inject = ['modules', 'remote', 'remoteAccess']

const CARRIER_LOST: RemoteStreamCarrierFailure['code'] = 'gateway/carrier-lost'
/** Remote failures a Host reload produces while it withdraws `pluginEvents` with the socket still open. */
const RELOADING: ReadonlySet<string> = new Set(['gateway/invocation-unavailable', 'gateway/service-unavailable'])

/**
 * Open one generation, reporting an endpoint the Host has withdrawn while it reloads as a carrier loss, so the stream
 * reconnects instead of ending.
 * @param open - opens the generation's frames.
 * @yields the generation's frames.
 */
async function *reconnectWhileReloading(open: () => AsyncIterable<PluginsEventFrame>): AsyncIterable<PluginsEventFrame> {
  try {
    yield * open()
  } catch (error) {
    if (error instanceof Error && 'code' in error && RELOADING.has(String(error.code))) {
      throw new RemoteStreamCarrierError('Plugin events are unavailable while the Host reloads', { cause: error })
    }
    throw error
  }
}

/** The generated `pluginEvents` client method this plugin calls. */
interface PluginEventsNamespace {
  follow(signal: AbortSignal): AsyncIterable<PluginsEventFrame>
}

/** Receivers of one followed stream. */
interface PluginEventSinks {
  /** A generation's complete graph. */
  readonly baseline: (frame: PluginsEventBaseline) => void
  /** One increment after the baseline. */
  readonly increment: (frame: PluginsEventIncrement) => void
  /** A terminal stream failure; graph changes stop until the page reloads. */
  readonly failed: (error: unknown) => void
}

/**
 * Follow `pluginEvents/follow` as a reconnecting baseline-and-increment stream.
 * @param ctx - context carrying the Remote carrier and the mounted `pluginEvents` namespace.
 * @param sinks - frame receivers.
 * @returns the disposer that stops the stream and waits until no frame can arrive.
 */
function followPluginEvents(ctx: Context, sinks: PluginEventSinks): () => Promise<void> {
  // `$mount` registered the namespace as its own service; only this plugin mounts it, so it is read by name rather
  // than through a declared injection.
  const namespace = ctx.get('remote.pluginEvents') as PluginEventsNamespace | undefined
  if (namespace === undefined) throw new Error('client-hmr: the mounted pluginEvents namespace is not registered')
  const stream = ctx.remote.$stream<PluginsEventFrame>({
    name: 'Plugin events',
    open: signal => reconnectWhileReloading(() => namespace.follow(signal)),
    // A Host-side end (the service restarting) reconnects rather than ending the logical stream.
    ended: (): RemoteStreamCarrierFailure => Object.assign(new Error('Plugin events stream ended'), { code: CARRIER_LOST }),
  })
  const control = new RemoteSnapshotStream<PluginsEventBaseline, PluginsEventIncrement>(stream, {
    name: 'Plugin events',
    isSnapshot: (frame): frame is PluginsEventBaseline => frame.type === 'baseline',
    replace: sinks.baseline,
    update: sinks.increment,
    failed: sinks.failed,
  })
  control.start()
  return () => control.dispose()
}

/**
 * Register the plugin-reload Settings row where the settings surface exists, then forward each stream generation's
 * graph and rebuilds to the page's serial entry controller, which also applies each row's synced configuration, while
 * Remote access allows the stream.
 * @param ctx - Plugin context with the client module system and Remote carrier.
 * @returns the disposer of this plugin's `pluginEvents` namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  // The row needs the slots, locale, and settings services of the settings page; a page without them keeps the
  // default preference and reloads rebuilt code, exactly as a Host that publishes rebuilds does.
  const preference: { autoReload?: ObservableSnapshot<boolean> } = {}
  ctx.inject(['slots', 'locale', 'settingsScope'], (scope: Context) => {
    const policy = new ClientHmrReloadPolicy(
      scope.settingsScope.bind<ClientHmrSettings>({ namespace: CLIENT_HMR_SETTINGS_NAMESPACE }),
    )
    preference.autoReload = policy.autoReload
    scope.effect(() => scope.locale.register(SETTINGS_NS, { zh, en }), 'client-hmr: settings row dictionaries')
    scope.slots.inject('settings.general.item', () => scope.slots.register({
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
  })

  const unmount = await ctx.remote.$mount(pluginEventsRemote)
  const entries = ctx.modules.entries
  // A malformed graph throws synchronously from sync(); both paths report through the same rejection.
  const run = (task: () => Promise<void>): void => {
    void Promise.resolve().then(task).catch((error: unknown) => { ctx.logger.error(error) })
  }
  const sinks: PluginEventSinks = {
    baseline: (frame) => { run(() => entries.sync(frame.graph)) },
    increment: (frame) => {
      switch (frame.type) {
        case 'graph':
          run(() => entries.sync(frame.graph))
          break
        case 'rebuilt':
          // The durable preference decides whether a rebuild replaces running code without a refresh.
          if (preference.autoReload?.getSnapshot() ?? DEFAULT_AUTO_RELOAD) run(() => entries.reload(frame.id, frame.rev))
          break
        case 'reload':
          run(() => entries.reload(frame.id, frame.rev))
          break
        default:
          // Forward compatibility: a newer Host's increment type is ignored.
          break
      }
    },
    failed: (error) => { ctx.logger.error('client-hmr: plugin events stopped; client graph changes stop until the page reloads', error) },
  }
  ctx.remoteAccess.whenAccess('pluginEvents/follow', () => followPluginEvents(ctx, sinks))
  return unmount
}
