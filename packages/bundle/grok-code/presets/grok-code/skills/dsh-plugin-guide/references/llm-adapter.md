# LLM Adapter

This machine's `@deepseek-ai/dsh-llm`: `LlmAdapter` is a provider-protocol adapter. Register routes with `ctx.llm.registerAdapter(providers, adapter)`. The service itself has no provider-protocol code; each stream attempts the provider once.

## Shape

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'

export const name = 'llm-myprovider'
export const inject = ['llm']

export interface Config {
  apiKey?: string
}

export const Config = Schema.object({
  apiKey: Schema.string(),
})

class MyAdapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Send attributionHeaders(); honor options.signal
    yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.llm.registerAdapter(['my-provider'], new MyAdapter(config))
}
```

`stream()` is abstract on the base class and must be implemented. Recommended overrides:

- `providerInfo(provider)`: returned `id` must equal that route name
- `listModels(provider)`: advisory catalog; absence must not become a request refusal
- `resolveModel(provider, model, signal?)`: exact model metadata (window, reasoning efforts)
- `prepareCall(provider, model, signal)`: bind this call's `resolveModel` to `stream` so settings cannot drift between prepare and dispatch
- `providerRetryPolicy` / `imageRequestPricing`: may return `undefined` to use host defaults; the methods themselves must exist because the host calls them directly

## Registration

- At least one non-empty provider name; an empty array on first register → `INVALID_ADAPTER`
- Any route already taken → `DUPLICATE_ADAPTER` (all succeed or all fail)
- Registration is an effect and disposes with the fiber; the handle also has `replace(providers)` for atomic route swap
- `ctx.llm.stream()` naming an unregistered provider → `NO_ADAPTER`

`llm/stream` is an interceptable waterfall. Adapters must not wrap another private retry loop: one adapter call = one provider attempt. Transient failures belong to `@deepseek-ai/dsh-llm-retry` or host policy.

## Stream vocabulary and failure

Chunks end with a terminating `finish`. Failure is `{ kind: 'error', failure }`; cancel is `{ kind: 'aborted', failure }`. `failure.code` uses stable classes (`AUTH`, `RATE_LIMIT`, `CONTEXT_WINDOW_EXCEEDED`, `INVALID_CREDENTIAL`, `EMPTY_RESPONSE`, …). Consumers route on the code, not by parsing the message text.

Two allowed error paths:

1. `stream()` throws `LlmError` (transport / protocol)
2. In-band terminating `finish { kind: 'error' | 'aborted', failure }`

An empty completion is a retryable error, not silent success. Every provider HTTP request must carry `attributionHeaders()` (User-Agent baseline + package `{ product, version, url }`).

Credentials: put them in Schemastery fields, inject from the environment with `!!js process.env.MY_KEY`, or use the host credential service. Do not read arbitrary key files in code. Blank keys or keys with illegal header characters normalize on this machine to `INVALID_CREDENTIAL`, not a mysterious fetch.

## Do not isolate by default

LLM adapters hang on shared `ctx.llm`; every session of that profile must be able to select the route. Do not add `isolate` to the adapter row. isolate belongs only to a published service that is visible only inside a preset group (see host-plugin).

OC2DSH is the comparison implementation: `inject = ['llm']`, `registerAdapter([providerId], adapter)`, no `dsh.client`, no isolate on the patch. It duck-types `LlmAdapter` methods (`stream` / `resolveModel` / `prepareCall` …). New plugins should **`extends LlmAdapter`**; missing `extends` is not the contract.

## Counterexample: Zen fingerprint stub

`OFFICIAL_ZEN_TOOLS` is not a model tool. OC2DSH stuffs unused stubs of 12 official desktop tool **names** into the provider request, only for wire-level identity of the anonymous `public` lane. The host's own `defineTool` still follows host tools. Copying that stub set into `ctx.tools.register(defineTool(...))` is the wrong form; do not treat a Zen stub as defineTool.
