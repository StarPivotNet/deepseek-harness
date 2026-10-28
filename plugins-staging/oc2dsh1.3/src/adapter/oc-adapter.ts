import { createProvider, type Context, type Model } from '@earendil-works/pi-ai'
import * as anthropicMessages from '@earendil-works/pi-ai/api/anthropic-messages'
import * as googleGenerativeAi from '@earendil-works/pi-ai/api/google-generative-ai'
import * as openaiCompletions from '@earendil-works/pi-ai/api/openai-completions'
import * as openaiResponses from '@earendil-works/pi-ai/api/openai-responses'

import { ZenFreeCatalog, type CatalogModelEntry, type ZenApi } from './catalog.ts'
import { toStreamChunks, type HarnessChunk, type PiEvent } from './events.ts'
import { deriveRequestIDs, disguiseHeaders } from './ids.ts'
import { nodeFetch } from './node-fetch.ts'
import { toPiContext, type HarnessGenerateOptions } from './messages.ts'

/**
 * Native DSH LlmAdapter for OpenCode Zen free (cost-0) models.
 *
 * Everything model-specific comes from ZenFreeCatalog (models.opencode.ai
 * records intersected with the live {zen}/v1/models list): the wire protocol
 * (entry.api), the reasoning levels (entry.reasoningEfforts), and the windows
 * (entry.contextWindow / entry.maxTokens). No model ids are hardcoded here.
 *
 * Auth: anonymous `public` works because requests carry OpenCode's wire identity
 * (ids.ts UA + x-opencode-*) plus the 12 official desktop tool **names** as unused
 * stubs when the host's tool list omits them (official-wire.ts). Host tools stay first.
 * The desktop developer prompt is not required.
 * A real Zen key (`apiKey` option or OPENCODE_API_KEY) still wins when set;
 * cost-0 models bill $0 either way.
 */
export const PROVIDER_ID = 'oc2dsh'
export const PROVIDER_NAME = 'OpenCode Zen'
export const ZEN_BASE_URL = 'https://opencode.ai/zen'
export const DEFAULT_REASONING_EFFORT = 'off'

/** Anonymous lane: works because ids.ts replicates OpenCode's identity. */
export const ANONYMOUS_KEY = 'public'

/** Generic fallbacks used only when the catalog record has no windows. */
const DEFAULT_CONTEXT_WINDOW = 262144
const DEFAULT_MAX_TOKENS = 32768

/** Synthetic level meaning "send no reasoning field at all" (see below). */
const EFFORT_OFF = 'off'

/** Instant-reject 403s worth one more dice roll: the lane flaps per request
 * (observed TRANSPORT -> RegionError -> FreeTierError -> success across
 * consecutive identical calls), and dsh-llm does not retry AUTH codes.
 * Transport errors stay the host's job (its policy already retries them). */
const RETRIABLE_AUTH_SIGNATURES = ['FreeTierError', 'RegionError']

export function isRetriableZenAuth(message: unknown): boolean {
  return typeof message === 'string' && RETRIABLE_AUTH_SIGNATURES.some((s) => message.includes(s))
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_RETRY_DELAYS_MS = [2000, 6000]

function clampAttempts(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(5, Math.max(1, Math.floor(value)))
    : DEFAULT_MAX_ATTEMPTS
}

function delayFor(delays: number[] | undefined, attempt: number): number {
  const list = Array.isArray(delays) && delays.length > 0 ? delays : DEFAULT_RETRY_DELAYS_MS
  const raw = list[Math.min(attempt - 1, list.length - 1)]!
  return Number.isFinite(raw) && raw > 0 ? raw : 0
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export type OcModelEntry = CatalogModelEntry

export type ResolvedModel = {
  provider: string
  id: string
  name: string
  description?: string
  inputModalities: string[]
  context: { contextWindow: number }
  defaultMaxTokens: number
  reasoning: { efforts: Array<{ id: string; name: string }>; defaultEffort: string }
}

/**
 * Wire values for pi-ai thinking. `off: null` means "unsupported": pi-ai
 * then OMITS the whole reasoning object when reasoning is off/disabled,
 * instead of sending `"none"` (which some Zen providers reject with 400).
 *
 * Background: pi-ai's buildParams always emits `params.reasoning` for
 * reasoning models. Without an explicit level it falls back to
 * `thinkingLevelMap.off ?? "none"`. With `off: null` the branch is
 * skipped and no reasoning field is sent at all.
 */
function thinkingMapFor(efforts: readonly string[]): Record<string, string | null> {
  const map: Record<string, string | null> = { [EFFORT_OFF]: null }
  for (const effort of efforts) {
    if (effort !== EFFORT_OFF) map[effort] = effort
  }
  return map
}

function displayName(effort: string): string {
  return effort.length > 0 ? effort[0]!.toUpperCase() + effort.slice(1) : effort
}

/** First catalog entry id, for callers that need a default model hint. */
export function pickDefaultModelId(entries: readonly Pick<CatalogModelEntry, 'id'>[]): string | undefined {
  return entries[0]?.id
}

export interface OcAdapterOptions {
  zenBaseUrl?: string
  apiKey?: string
  models?: OcModelEntry[]
  extraModels?: OcModelEntry[]
  defaultReasoningEffort?: string
  fetch?: typeof globalThis.fetch
  catalog?: ZenFreeCatalog
  liveCatalog?: boolean
  /**
   * Total attempts per stream on instant-reject 403s (FreeTier/Region with
   * zero content emitted). 1 disables the retry. Default 3, capped at 5.
   */
  maxAttempts?: number
  /** Delays between attempts in ms. Default [2000, 6000] (last reused). */
  retryDelaysMs?: number[]
}

/**
 * Explicit override wins, then OPENCODE_API_KEY, then the anonymous key.
 */
export function resolveApiKey(override?: string): string {
  const fromOverride = typeof override === 'string' ? override.trim() : ''
  if (fromOverride) return fromOverride
  const fromEnv = typeof process.env.OPENCODE_API_KEY === 'string' ? process.env.OPENCODE_API_KEY.trim() : ''
  return fromEnv || ANONYMOUS_KEY
}

function normalizeDefaultEffort(value?: string): string {
  const id = (value ?? DEFAULT_REASONING_EFFORT).trim()
  return id.length > 0 ? id : DEFAULT_REASONING_EFFORT
}

export function resolveStreamReasoning(requested: string | undefined, defaultEffort: string): string | undefined {
  const reasoning = requested ?? defaultEffort
  return reasoning === EFFORT_OFF ? undefined : reasoning
}

/**
 * Upstream waterfall plugins (e.g. the dsh-grok-agi preset stamping
 * `x-grok-conv-id` on every llm/stream) ride `GenerateOptions.headers`.
 * Zen's free lane heuristics decide "within OpenCode" from the request
 * shape, so ANY foreign header can only hurt: forward strictly the header
 * set official OpenCode sends for opencode providers (see ids.ts), drop
 * everything else. pi-ai merges `options.headers` last, so the allowlist
 * below is the complete upstream header closure (plus SDK-managed
 * Authorization / Content-Type).
 */
const ALLOWED_INBOUND_HEADERS = new Set([
  'user-agent',
  'x-opencode-project',
  'x-opencode-session',
  'x-opencode-request',
  'x-opencode-client',
  'x-parent-session-id',
])

function inboundHeaders(options: HarnessGenerateOptions): Record<string, string> | undefined {
  const raw = options.headers
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string' || value.length === 0) continue
    if (!ALLOWED_INBOUND_HEADERS.has(key.toLowerCase())) continue
    out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function effortsForEntry(entry: Pick<CatalogModelEntry, 'reasoningEfforts'>): Array<{ id: string; name: string }> {
  return [EFFORT_OFF, ...entry.reasoningEfforts.filter((effort) => effort !== EFFORT_OFF)].map((id) => ({
    id,
    name: displayName(id),
  }))
}

function clampDefaultEffort(entry: Pick<CatalogModelEntry, 'reasoningEfforts'>, configured: string): string {
  if (configured !== EFFORT_OFF && entry.reasoningEfforts.includes(configured)) return configured
  return EFFORT_OFF
}

type ZenPiApi = ZenApi

/**
 * pi-ai hands Model.baseUrl to each vendor SDK untouched: the OpenAI and
 * Google SDKs append only the resource path, but the Anthropic SDK appends
 * `/v1/messages` itself. Zen's messages route lives at `{zen}/v1/messages`,
 * so anthropic-messages models must carry the bare origin.
 */
function apiBaseUrl(entry: Pick<CatalogModelEntry, 'api'>, origin: string, versioned: string): string {
  return entry.api === 'anthropic-messages' ? origin : versioned
}

function toPiModel(entry: CatalogModelEntry, origin: string, versioned: string): Model<ZenPiApi> {
  return {
    id: entry.id,
    name: entry.name,
    api: entry.api,
    provider: PROVIDER_ID,
    baseUrl: apiBaseUrl(entry, origin, versioned),
    reasoning: true,
    thinkingLevelMap: thinkingMapFor(entry.reasoningEfforts),
    // The message pipeline below is text-only; dsh-llm strips images before
    // dispatch while the model declares text-only input.
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: entry.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: entry.maxTokens ?? DEFAULT_MAX_TOKENS,
  }
}

export class OcAdapter {
  readonly #origin: string
  readonly #baseUrl: string
  readonly #apiKey: string
  readonly #fallbackModels: OcModelEntry[]
  readonly #extraModels: OcModelEntry[]
  readonly #catalog: ZenFreeCatalog | undefined
  readonly #defaultReasoningEffort: string
  readonly #maxAttempts: number
  readonly #retryDelaysMs: number[] | undefined
  readonly #fetch?: typeof globalThis.fetch
  readonly #provider

  constructor(options: OcAdapterOptions = {}) {
    this.#origin = (options.zenBaseUrl ?? ZEN_BASE_URL).replace(/\/+$/, '')
    this.#baseUrl = `${this.#origin}/v1`
    this.#apiKey = resolveApiKey(options.apiKey)
    this.#fallbackModels = options.models ?? []
    this.#extraModels = options.extraModels ?? []
    this.#defaultReasoningEffort = normalizeDefaultEffort(options.defaultReasoningEffort)
    this.#maxAttempts = clampAttempts(options.maxAttempts)
    this.#retryDelaysMs = options.retryDelaysMs
    this.#fetch = options.fetch ?? nodeFetch
    this.#catalog = options.catalog ?? (options.liveCatalog === false ? undefined : new ZenFreeCatalog({
      zenBaseUrl: options.zenBaseUrl,
      fetch: this.#fetch,
    }))
    this.#provider = createProvider<ZenPiApi>({
      id: PROVIDER_ID,
      name: PROVIDER_NAME,
      baseUrl: this.#baseUrl,
      auth: {
        apiKey: {
          name: 'OpenCode Zen',
          resolve: async () => ({ auth: { apiKey: this.#apiKey } }),
        },
      },
      models: [],
      api: {
        'openai-responses': openaiResponses,
        'openai-completions': openaiCompletions,
        'anthropic-messages': anthropicMessages,
        'google-generative-ai': googleGenerativeAi,
      },
    })
  }

  providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: PROVIDER_NAME }
  }

  /**
   * dsh-llm calls this unconditionally at registration.
   * undefined = the host default retry policy.
   */
  providerRetryPolicy(_provider: string): undefined {
    return undefined
  }

  /**
   * dsh-llm resolves this per measurement; undefined = neutral fallback.
   * Must exist: the host calls it without optional chaining on the method.
   */
  imageRequestPricing(_provider: string, _model: string): undefined {
    return undefined
  }

  async listModels(provider: string): Promise<Array<{ provider: string; id: string; name: string; description?: string; inputModalities: string[] }>> {
    const models = await this.#resolvedModels()
    return models.map((model) => ({
      provider,
      id: model.id,
      name: model.name,
      ...(model.description ? { description: model.description } : {}),
      inputModalities: ['text'],
    }))
  }

  async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<ResolvedModel> {
    const models = await this.#resolvedModels()
    const entry = models.find((item) => item.id === model)
    return {
      provider,
      id: model,
      name: entry?.name ?? model,
      ...(entry?.description ? { description: entry.description } : {}),
      inputModalities: ['text'],
      context: { contextWindow: entry?.contextWindow ?? DEFAULT_CONTEXT_WINDOW },
      defaultMaxTokens: entry?.maxTokens ?? DEFAULT_MAX_TOKENS,
      reasoning: {
        efforts: entry ? effortsForEntry(entry) : [{ id: EFFORT_OFF, name: displayName(EFFORT_OFF) }],
        defaultEffort: entry ? clampDefaultEffort(entry, this.#defaultReasoningEffort) : EFFORT_OFF,
      },
    }
  }

  /** Fetch the free catalog once (plugin load). Later listModels uses the snapshot. */
  async refreshCatalog(): Promise<void> {
    if (this.#catalog) await this.#catalog.refreshOnce()
  }

  async #resolvedModels(): Promise<OcModelEntry[]> {
    const live = this.#catalog ? await this.#catalog.list() : this.#fallbackModels
    const byId = new Map<string, OcModelEntry>()
    for (const entry of live) byId.set(entry.id, entry)
    for (const entry of this.#extraModels) byId.set(entry.id, entry)
    return [...byId.values()]
  }

  async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<{
    model: ResolvedModel
    stream: (options: HarnessGenerateOptions) => AsyncGenerator<HarnessChunk>
  }> {
    return {
      // Await even when this method is sync: dsh-thinking-levels (and similar
      // plugins) replace resolveModel with an async wrapper. dsh-llm then
      // validates adapterCall.model; a leftover Promise is INVALID_MODEL_INFO.
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options),
    }
  }

  async *stream(options: HarnessGenerateOptions): AsyncGenerator<HarnessChunk> {
    const context = toPiContext(options)
    const ids = deriveRequestIDs(options.messages)
    const streamEntry = (await this.#resolvedModels()).find((item) => item.id === options.model)
    if (!streamEntry) {
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } }
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: `OC2DSH: unknown model "${options.model}" (not in the live Zen free catalog)`, code: 'INVALID_MODEL_INFO' },
        },
      }
      return
    }
    const model = toPiModel(streamEntry, this.#origin, this.#baseUrl)
    const reasoning = resolveStreamReasoning(options.reasoningEffort, clampDefaultEffort(streamEntry, this.#defaultReasoningEffort))
    // Retry loop for instant-reject 403s only. Usage-only chunks are held
    // back until the first content chunk or finish: a retriable error with
    // zero content is swallowed and re-sent (fresh request id each attempt),
    // anything else flushes and streams live, so TTFT is unaffected.
    for (let attempt = 1; ; attempt++) {
      const ids = deriveRequestIDs(options.messages)
      const events = this.#provider.streamSimple(model, context as unknown as Context, {
        apiKey: this.#apiKey,
        // Deliberately no sessionId: pi-ai would then force-send
        // x-client-request-id / x-session-affinity (/ session_id), which
        // official OpenCode never emits for opencode providers. The
        // x-opencode-session correlation already rides disguiseHeaders.
        headers: disguiseHeaders(ids, streamEntry.api, inboundHeaders(options)),
        signal: options.signal,
        maxRetries: 0,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        ...(this.#fetch ? { fetch: this.#fetch } : {}),
        ...(reasoning === undefined ? {} : { reasoning: reasoning as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' }),
      })
      const held: HarnessChunk[] = []
      let live = false
      let retry = false
      for await (const chunk of toStreamChunks(events as unknown as AsyncIterable<PiEvent>, model.contextWindow)) {
        if (!live && chunk.type === 'usage') {
          held.push(chunk)
          continue
        }
        if (!live && chunk.type === 'finish') {
          const failure = chunk.reason.kind === 'error' ? chunk.reason.failure : undefined
          if (failure && isRetriableZenAuth(failure.message) && attempt < this.#maxAttempts) {
            retry = true
            break
          }
        }
        live = true
        for (const pending of held.splice(0)) yield pending
        yield chunk
      }
      if (!retry) {
        for (const pending of held.splice(0)) yield pending
        return
      }
      if (options.signal?.aborted) return
      await sleep(delayFor(this.#retryDelaysMs, attempt))
    }
  }
}

export function createOcAdapter(options: OcAdapterOptions = {}): OcAdapter {
  return new OcAdapter(options)
}
