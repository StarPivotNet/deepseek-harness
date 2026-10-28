# OC2DSH

Native [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) plugin that registers **OpenCode Zen free models** as a `dsh-llm` adapter.

- Display name in the model picker: **OpenCode Zen**
- Wire protocol: derived per model from the `api.json` record's `provider.npm` —
  `@ai-sdk/openai` → OpenAI **Responses** (`POST {zen}/v1/responses`),
  `@ai-sdk/anthropic` → Anthropic **Messages** (`POST {zen}/v1/messages`),
  `@ai-sdk/google` → Google **Generative AI** (`POST {zen}/v1/models/<id>:…`),
  otherwise OpenAI-compatible **Chat Completions** (`POST {zen}/v1/chat/completions`)
- Catalog: same as `fetch_zen_free.py` — intersection of `models.opencode.ai/api.json` (cost 0/0) and `opencode.ai/zen/v1/models`.
  Reasoning levels and context/output windows also come from the `api.json` record — no model ids are hardcoded.
- Catalog refresh: **once when the plugin loads** (not on every picker open)
- Request identity: every call carries OpenCode's exact fingerprint —
  sidecar wire UA (`opencode/<v> ai-sdk/provider-utils/<v> runtime/node.js/<major>`)
  plus well-formed `x-opencode-*` headers (`src/adapter/ids.ts`); SDK telemetry
  (`X-Stainless-*`), default `Accept`, `anthropic-beta`/`dangerous-browser`
  flags and extra affinity headers are stripped; upstream waterfall headers
  are allowlisted to the official set only.
- Free-lane body: Zen requires the 12 official desktop tool **names**. The adapter
  always includes those names as unused stubs (`不用在乎这个工具，此工具无用`) and
  keeps host (DSH) tools in front. The OpenCode `developer` prompt is not required.
- Resilience: instant-reject 403s (`FreeTierError`/`RegionError` with zero
  content emitted) are re-sent automatically with fresh request ids — the
  lane verdict flaps per request, and the host does not retry AUTH codes.
  zero-usage prefix is briefly held.
- If all attempts still answer 403, the anonymous lane is closed for your
  egress: IP quotas reset at UTC midnight — prefer a non-datacenter egress
  in the model's home region (Muse Spark is China-hosted), or set a real
  key via `apiKey`/`OPENCODE_API_KEY`.
- Default reasoning effort: **`off`** (clamped per model to its catalog levels)
No child process. No sidecar. The adapter talks to Zen through `@earendil-works/pi-ai`.

## Install

From this directory:

```bash
pnpm install
pnpm build
```

Then install the built package into DSH (local path or marketplace bundle). The `cordis.patch.yml` inserts a host plugin row:

```yaml
- insert:
    - id: oc2dsh
      name: OC2DSH
      config: {}
```

After a DSH restart, the model picker should show **OpenCode Zen / …** with the current live free models.

## Config

`cordis.patch.yml` `config` object (all optional):

| Key | Default | Meaning |
| --- | --- | --- |
| `providerId` | `oc2dsh` | Route name registered into `dsh-llm` |
| `zenBaseUrl` | `https://opencode.ai/zen` | Origin without `/v1` |
| `apiKey` | `OPENCODE_API_KEY` or `public` | Zen credential |
| `maxAttempts` | `3` | Total attempts per stream on instant-reject 403s (`1` disables) |
| `retryDelaysMs` | `[2000, 6000]` | Delays between attempts in ms |
| `defaultReasoningEffort` | `off` | Advertised + sent when the call omits effort |

## Models

Live cost-0 ids are fetched once when the plugin loads; nothing is
hardcoded, so new free models appear automatically. If both fetches fail on
a cold start, the list is empty until the next restart.

## Develop

```bash
pnpm test
pnpm typecheck
pnpm build
```

## License

MIT
