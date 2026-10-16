/** Product-wide default policy over the live volatile Config. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmDefaultPolicyConfig, {
  resolveProviderRetryPolicy,
  resolveStreamIdleTimeoutMs,
} from '../src/index.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

describe('LlmDefaultPolicyConfig', () => {
  it('resolves product defaults without a write', async () => {
    const ctx = new Context()
    await liveConfig(ctx, LlmDefaultPolicyConfig)
    expect(ctx.llmDefaultPolicy.current()).toEqual({
      maxRetries: 5,
      unlimited: false,
      streamIdleTimeoutMs: 300_000,
    })
    await ctx.fiber.dispose()
  })

  it('applies a written section over the composition base', async () => {
    const ctx = new Context()
    const config = await liveConfig(ctx, LlmDefaultPolicyConfig)
    await config.replace({
      maxRetries: 8,
      unlimited: true,
      streamIdleTimeoutMs: 60_000,
    })
    expect(ctx.llmDefaultPolicy.current()).toEqual({
      maxRetries: 8,
      unlimited: true,
      streamIdleTimeoutMs: 60_000,
    })
    await ctx.fiber.dispose()
  })

  it('keeps the composition base when the user layer resets to it', async () => {
    const ctx = new Context()
    const config = await liveConfig(ctx, LlmDefaultPolicyConfig, { maxRetries: 3 })
    await config.replace({ maxRetries: 9 })
    expect(ctx.llmDefaultPolicy.current().maxRetries).toBe(9)
    await config.replace({ maxRetries: 3 })
    expect(ctx.llmDefaultPolicy.current()).toEqual({
      maxRetries: 3,
      unlimited: false,
      streamIdleTimeoutMs: 300_000,
    })
    await ctx.fiber.dispose()
  })

  it('keeps the composition entry when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmDefaultPolicyConfig, { maxRetries: 4, streamIdleTimeoutMs: 10_000 })
    expect(ctx.llmDefaultPolicy.current()).toEqual({
      maxRetries: 4,
      unlimited: false,
      streamIdleTimeoutMs: 10_000,
    })
    await ctx.fiber.dispose()
  })

  it('rejects an out-of-range write', async () => {
    const ctx = new Context()
    const config = await liveConfig(ctx, LlmDefaultPolicyConfig)
    await expect(config.replace({ maxRetries: -1 })).rejects.toThrow(/maxRetries/)
    await ctx.fiber.dispose()
  })
})

describe('resolve helpers', () => {
  const defaults = { maxRetries: 5, unlimited: false, streamIdleTimeoutMs: 300_000 }

  it('uses the product-wide finite budget when the provider omitted a policy', () => {
    expect(resolveProviderRetryPolicy(undefined, defaults, 'test')).toMatchObject({
      mode: 'normal',
      maxRetries: 5,
    })
  })

  it('maps unlimited onto always mode', () => {
    expect(resolveProviderRetryPolicy(undefined, { ...defaults, unlimited: true }, 'test')).toMatchObject({
      mode: 'always',
    })
  })

  it('keeps an explicit provider policy', () => {
    expect(resolveProviderRetryPolicy({ mode: 'normal', maxRetries: 1 }, defaults, 'test')).toMatchObject({
      mode: 'normal',
      maxRetries: 1,
    })
  })

  it('uses the product-wide idle interval when the provider omitted one', () => {
    expect(resolveStreamIdleTimeoutMs(undefined, defaults)).toBe(300_000)
    expect(resolveStreamIdleTimeoutMs(12_000, defaults)).toBe(12_000)
  })
})
