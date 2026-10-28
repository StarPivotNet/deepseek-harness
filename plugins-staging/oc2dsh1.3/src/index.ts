import { OcAdapter } from './adapter/oc-adapter.ts'
import { resolveConfig, type Oc2dshConfig } from './config.ts'

/**
 * OC2DSH DSH cordis plugin entry.
 *
 * Registers a native dsh-llm LlmAdapter for OpenCode Zen free (cost-0)
 * models. Wire protocol, reasoning levels, and windows all come from the
 * live Zen catalog (no hardcoded models). Requests carry OpenCode's exact
 * request identity, so the anonymous `public` lane works. Default
 * reasoning effort is off. No child process.
 *
 * dispose is owned by registerAdapter (ctx.effect internally).
 */

export interface PluginContext {
  logger: { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void }
  llm?: { registerAdapter(providers: string[], adapter: unknown): unknown }
  inject?(services: string[], callback: (ctx: PluginContext) => void | Promise<void>): unknown
  effect?(fn: () => () => void): unknown
}

export const name = 'OC2DSH'
export const inject = ['llm'] as const

export function apply(ctx: PluginContext, config: Oc2dshConfig = {}): { ready: Promise<{ port: number; version: string }> } {
  const logger = ctx.logger
  const cfg = resolveConfig(config)

  if (!ctx.llm || typeof ctx.llm.registerAdapter !== 'function') {
    logger.error('OC2DSH: llm service unavailable; cannot register adapter')
    return { ready: Promise.resolve({ port: 0, version: 'adapter' }) }
  }

  const adapter = new OcAdapter({
    zenBaseUrl: cfg.zenBaseUrl,
    apiKey: cfg.apiKey,
    defaultReasoningEffort: cfg.defaultReasoningEffort,
    ...(cfg.maxAttempts !== undefined ? { maxAttempts: cfg.maxAttempts } : {}),
    ...(cfg.retryDelaysMs !== undefined ? { retryDelaysMs: cfg.retryDelaysMs } : {}),
  })
  ctx.llm.registerAdapter([cfg.providerId], adapter)
  const ready = adapter.refreshCatalog().then(() => {
    logger.info(
      `OC2DSH: adapter registered for "${cfg.providerId}" (Zen free catalog at load, default ${cfg.defaultReasoningEffort})`,
    )
    return { port: 0, version: 'adapter' }
  })
  return { ready }
}

export { OcAdapter, PROVIDER_ID, PROVIDER_NAME, createOcAdapter, DEFAULT_REASONING_EFFORT, ZEN_BASE_URL, ANONYMOUS_KEY, pickDefaultModelId, resolveApiKey, isRetriableZenAuth } from './adapter/oc-adapter.ts'
export { catalogUserAgent, deriveRequestIDs, disguiseHeaders, opencodeUserAgent } from './adapter/ids.ts'
export { nodeFetch } from './adapter/node-fetch.ts'
export { ZenFreeCatalog, MODELS_API } from './adapter/catalog.ts'
export type { CatalogModelEntry, ZenApi } from './adapter/catalog.ts'
export { resolveConfig, type Oc2dshConfig } from './config.ts'
export { OFFICIAL_ZEN_TOOLS } from './adapter/official-wire.ts'
