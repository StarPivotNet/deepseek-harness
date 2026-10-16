# @deepseek-ai/dsh-llm-default-policy

English | [中文](README.zh.md)

Product-wide default retry budget and stream-idle timeout used when a provider route omits its own values. `LlmDefaultPolicyConfig` provides `ctx.llmDefaultPolicy`. DeepSeek and pi-ai adapters read the same service instead of each inventing a second default.

The plugin config defaults to five finite retries, unlimited off, and a five-minute stream-idle interval. The live volatile Config is the `llm-default-policy` settings section; the Web General settings row writes it and changes are visible on the next `current()` read.

- `ctx.llmDefaultPolicy.current()` returns a detached `{ maxRetries, unlimited, streamIdleTimeoutMs }` record.
- `resolveProviderRetryPolicy(config, defaults, path)` resolves a provider-owned `retryPolicy`, or the product-wide default when the provider omitted one. Unlimited maps to always mode; otherwise normal mode uses `maxRetries`.
- `resolveStreamIdleTimeoutMs(configured, defaults)` returns the provider interval, or the product-wide default when the provider omitted one.

A provider that sets `retryPolicy` or `streamIdleTimeoutMs` keeps that exact value. The default service never rewrites an explicit provider field.

## Model Experience

Indirectly, through the retry budget and idle interval adapters apply to omitted provider fields. Each retry is a new provider request; the idle interval bounds one outstanding provider read.

#### KV Cache effect

Changing the default affects only later adapter registrations that still omit their own policy or idle interval. An in-flight request keeps the serving policy captured when it started.

## Known Limitations and Deferred Work

- The service owns one process-wide default; per-provider overrides remain on each adapter's own configuration.
