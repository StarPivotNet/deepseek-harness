/**
 * Dynamic Zen free-model catalog: no hardcoded model ids, limits, or wire
 * protocols.
 *
 * 1. GET https://models.opencode.ai/api.json -> opencode.models
 *    cost.input == 0 && cost.output == 0 => free candidate.
 *    Per-model details are read from the same record:
 *    - wire protocol from `provider.npm`
 *        @ai-sdk/openai      -> openai-responses      (POST {zen}/v1/responses)
 *        @ai-sdk/anthropic   -> anthropic-messages    (POST {zen}/v1/messages)
 *        @ai-sdk/google      -> google-generative-ai  (POST {zen}/v1/models/<id>:...)
 *        (absent / openai-compatible) -> openai-completions
 *                                          (POST {zen}/v1/chat/completions)
 *      Anything else is skipped: the adapter cannot speak that protocol.
 *    - reasoning levels from `reasoning_options` ({ type: 'effort', values }).
 *    - windows from `limit` ({ context, output }).
 * 2. GET {zen}/v1/models -> live enabled ids; intersected when available.
 */
import { catalogUserAgent } from './ids.ts'
import { nodeFetch } from './node-fetch.ts'
export const MODELS_API = 'https://models.opencode.ai/api.json'
export const ZEN_BASE_URL = 'https://opencode.ai/zen'
export type ZenApi = 'openai-responses' | 'openai-completions' | 'anthropic-messages' | 'google-generative-ai'

export interface CatalogModelEntry {
  id: string
  name: string
  description?: string
  api: ZenApi
  /** Wire reasoning efforts advertised by models.dev (without the synthetic 'off'). */
  reasoningEfforts: string[]
  contextWindow?: number
  maxTokens?: number
}

export interface ZenFreeCatalogOptions {
  zenBaseUrl?: string
  modelsApi?: string
  fetch?: typeof globalThis.fetch
}

interface ModelsDevProvider {
  npm?: string
  api?: string
}

interface ReasoningOption {
  type?: string
  values?: unknown
}

interface ModelsDevModel {
  name?: string
  description?: string
  cost?: { input?: number; output?: number }
  limit?: { context?: number; output?: number }
  modalities?: { input?: unknown }
  reasoning_options?: ReasoningOption[]
  provider?: ModelsDevProvider | string
}

interface ModelsDevPayload {
  opencode?: { models?: Record<string, ModelsDevModel> }
}

interface ZenModelsPayload {
  data?: Array<{ id?: string }>
}

function zenApiForProvider(provider: ModelsDevModel['provider']): ZenApi | undefined {
  if (provider === undefined || typeof provider === 'string') return 'openai-completions'
  switch (provider.npm) {
    case undefined:
    case '@ai-sdk/openai-compatible':
      return 'openai-completions'
    case '@ai-sdk/openai':
      return 'openai-responses'
    case '@ai-sdk/anthropic':
      return 'anthropic-messages'
    case '@ai-sdk/google':
      return 'google-generative-ai'
    default:
      return undefined
  }
}

function effortsFor(info: ModelsDevModel): string[] {
  const out: string[] = []
  for (const option of info.reasoning_options ?? []) {
    if (option?.type !== 'effort' || !Array.isArray(option.values)) continue
    for (const value of option.values) {
      if (typeof value !== 'string' || value.length === 0 || out.includes(value)) continue
      out.push(value)
    }
  }
  return out
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function entryFor(id: string, info: ModelsDevModel): CatalogModelEntry | undefined {
  const api = zenApiForProvider(info.provider)
  if (api === undefined) return undefined
  const name = info.name?.trim() || id
  const entry: CatalogModelEntry = { id, name, api, reasoningEfforts: effortsFor(info) }
  const description = info.description?.trim()
  if (description) entry.description = description
  const contextWindow = positiveNumber(info.limit?.context)
  if (contextWindow !== undefined) entry.contextWindow = contextWindow
  const maxTokens = positiveNumber(info.limit?.output)
  if (maxTokens !== undefined) entry.maxTokens = maxTokens
  return entry
}

export class ZenFreeCatalog {
  readonly #zenBaseUrl: string
  readonly #modelsApi: string
  readonly #fetch: typeof globalThis.fetch
  #entries: CatalogModelEntry[] = []
  #inflight: Promise<CatalogModelEntry[]> | undefined
  #loaded = false

  constructor(options: ZenFreeCatalogOptions = {}) {
    this.#zenBaseUrl = (options.zenBaseUrl ?? ZEN_BASE_URL).replace(/\/+$/, '')
    this.#modelsApi = options.modelsApi ?? MODELS_API
    this.#fetch = options.fetch ?? nodeFetch
  }

  snapshot(): CatalogModelEntry[] {
    return this.#entries.map((entry) => ({ ...entry, reasoningEfforts: [...entry.reasoningEfforts] }))
  }

  /** Cached snapshot. Fetches at most once until `refreshOnce()` is called. */
  async list(): Promise<CatalogModelEntry[]> {
    if (this.#loaded) return this.snapshot()
    return this.refreshOnce()
  }

  async refreshOnce(): Promise<CatalogModelEntry[]> {
    if (this.#inflight) return this.#inflight
    this.#inflight = this.#refresh()
    try {
      return await this.#inflight
    } finally {
      this.#inflight = undefined
    }
  }

  async #refresh(): Promise<CatalogModelEntry[]> {
    try {
      const [api, zen] = await Promise.all([
        this.#getJson<ModelsDevPayload>(this.#modelsApi),
        this.#getJson<ZenModelsPayload>(`${this.#zenBaseUrl}/v1/models`),
      ])
      const models = api.opencode?.models ?? {}
      const freeAll = new Map<string, CatalogModelEntry>()
      for (const [id, info] of Object.entries(models)) {
        const cost = info.cost ?? {}
        if (cost.input !== 0 || cost.output !== 0) continue
        const entry = entryFor(id, info)
        if (entry) freeAll.set(id, entry)
      }
      const zenIds = new Set((zen.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string' && id.length > 0))
      const active = zenIds.size > 0
        ? [...freeAll.keys()].filter((id) => zenIds.has(id)).sort()
        : [...freeAll.keys()].sort()
      if (active.length > 0) {
        this.#entries = active.map((id) => freeAll.get(id)!)
      }
    } catch {
      // Keep the last good snapshot (empty on cold-start failure).
    }
    this.#loaded = true
    return this.snapshot()
  }

  async #getJson<T>(url: string): Promise<T> {
    const response = await this.#fetch(url, {
      headers: { accept: 'application/json', 'user-agent': catalogUserAgent() },
    })
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    return await response.json() as T
  }
}
