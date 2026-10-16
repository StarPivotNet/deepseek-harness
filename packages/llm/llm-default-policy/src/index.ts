/**
 * Product-wide default retry budget and stream-idle timeout for provider
 * routes that do not set their own values.
 *
 * @module @deepseek-ai/dsh-llm-default-policy
 */

import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { ResolvedRetryPolicy, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { DEFAULT_MAX_RETRIES, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_UNLIMITED } from './settings.ts'
import type { LlmDefaultPolicySettings } from './defaults.ts'

export {
  DEFAULT_MAX_RETRIES,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_UNLIMITED,
  LLM_DEFAULT_POLICY_ENTRY,
  LLM_DEFAULT_POLICY_SETTINGS_NAMESPACE,
  LlmDefaultPolicySettingsSchema,
  MAX_RETRIES_FIELD,
  STREAM_IDLE_TIMEOUT_MS_FIELD,
  UNLIMITED_FIELD,
} from './settings.ts'
export type { LlmDefaultPolicySettings } from './settings.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Product-wide default retry budget and stream-idle timeout. */
    llmDefaultPolicy: LlmDefaultPolicyConfig
  }
}

/** Composition config: the live product-wide defaults held by the settings document. */
export interface Config {
  /** Finite retries after the first request when unlimited is off (default 5). */
  maxRetries: Volatile<number>
  /** Unbounded retry of every model-request failure (default false). */
  unlimited: Volatile<boolean>
  /** Outstanding-read idle interval in milliseconds (default 300000). */
  streamIdleTimeoutMs: Volatile<number>
}

/**
 * Project the stored section onto a provider-owned retry policy. Unlimited
 * maps to always mode; otherwise normal mode uses the finite budget.
 * @param settings - resolved product-wide defaults.
 * @returns a detached retry-policy configuration.
 */
export function retryPolicyFromDefaults(settings: LlmDefaultPolicySettings): RetryPolicyConfig {
  return settings.unlimited
    ? { mode: 'always' }
    : { mode: 'normal', maxRetries: settings.maxRetries }
}

/**
 * Resolve one provider retry policy, falling back to the product-wide default
 * when the provider omitted its own.
 * @param config - optional provider-owned policy.
 * @param defaults - current product-wide defaults.
 * @param path - diagnostic path naming the provider config that owns the value.
 * @returns an immutable policy safe to capture in provider registration state.
 */
export function resolveProviderRetryPolicy(
  config: RetryPolicyConfig | undefined,
  defaults: LlmDefaultPolicySettings,
  path: string,
): ResolvedRetryPolicy {
  return resolveRetryPolicy(config ?? retryPolicyFromDefaults(defaults), path)
}

/**
 * Resolve one stream-idle interval, falling back to the product-wide default
 * when the provider omitted its own.
 * @param configured - optional provider-owned interval.
 * @param defaults - current product-wide defaults.
 * @returns the interval that should bound an outstanding provider read.
 */
export function resolveStreamIdleTimeoutMs(
  configured: number | undefined,
  defaults: LlmDefaultPolicySettings,
): number {
  return configured ?? defaults.streamIdleTimeoutMs
}

/**
 * Owns the product-wide default retry budget and stream-idle timeout.
 * The live volatile Config holds the values; the Settings page edits them
 * through this entry's settings namespace.
 */
export class LlmDefaultPolicyConfig extends Service {
  static Config = z.object({
    maxRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES).volatile(),
    unlimited: z.boolean().default(DEFAULT_UNLIMITED).volatile(),
    streamIdleTimeoutMs: z.number()
      .min(Number.MIN_VALUE)
      .max(MAX_TIMER_DELAY_MS)
      .default(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
      .volatile(),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'llmDefaultPolicy')
  }

  /**
   * Read the current product-wide defaults.
   * @returns a detached retry budget and stream-idle interval.
   */
  current(): LlmDefaultPolicySettings {
    return {
      maxRetries: this.config.maxRetries.get(),
      unlimited: this.config.unlimited.get(),
      streamIdleTimeoutMs: this.config.streamIdleTimeoutMs.get(),
    }
  }
}

export default LlmDefaultPolicyConfig
