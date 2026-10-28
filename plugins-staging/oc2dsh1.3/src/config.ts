/**
 * Plugin configuration (cordis config object, injected via cordis.patch.yml).
 */
export interface Oc2dshConfig {
  /** Provider route name registered into dsh-llm. */
  providerId?: string
  /** OpenCode Zen origin (without /v1). Default https://opencode.ai/zen */
  zenBaseUrl?: string
  /**
   * Zen API key. Falls back to OPENCODE_API_KEY, then the anonymous key
   * `public` (works: requests carry OpenCode's exact request identity).
   * Cost-0 models bill $0 either way.
   */
  apiKey?: string
  /**
   * Default reasoning effort advertised to DSH and sent when the call does
   * not set one. Clamped per model to its catalog levels; unknown values
   * fall back to `off`.
   */
  defaultReasoningEffort?: string
  /**
   * Total attempts per stream on instant-reject 403s (FreeTier/Region with
   * zero content emitted). 1 disables the retry. Default 3.
   */
  maxAttempts?: number
  /** Delays between attempts in ms. Default [2000, 6000]. */
  retryDelaysMs?: number[]
}

export const defaults = {
  providerId: 'oc2dsh',
  zenBaseUrl: 'https://opencode.ai/zen',
  defaultReasoningEffort: 'off',
} as const

export type ResolvedConfig = {
  providerId: string
  zenBaseUrl: string
  apiKey?: string
  defaultReasoningEffort: string
  maxAttempts?: number
  retryDelaysMs?: number[]
}

export function resolveConfig(config: Oc2dshConfig = {}): ResolvedConfig {
  const defaultReasoningEffort = config.defaultReasoningEffort?.trim() || defaults.defaultReasoningEffort
  const zenBaseUrl = config.zenBaseUrl?.replace(/\/+$/, '') || defaults.zenBaseUrl
  const apiKey = config.apiKey?.trim() || undefined
  return {
    providerId: config.providerId?.trim() || defaults.providerId,
    zenBaseUrl,
    ...(apiKey ? { apiKey } : {}),
    defaultReasoningEffort,
    ...(config.maxAttempts !== undefined ? { maxAttempts: config.maxAttempts } : {}),
    ...(config.retryDelaysMs !== undefined ? { retryDelaysMs: config.retryDelaysMs } : {}),
  }
}
