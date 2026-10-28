import { createHash, randomBytes } from 'node:crypto'

/**
 * Byte-faithful port of OpenCode's request identity:
 * - ID anatomy from `@opencode-ai/schema/identifier` + `opencode/src/id/id.ts`:
 *   `<prefix>_` + 12 lowercase hex (48-bit time quantity) + 14 base62 chars.
 *   Sessions are descending (newest-first, as created in session.ts), user
 *   message ids (which ride `x-opencode-request`, see
 *   `opencode/src/session/llm/request.ts`) are ascending.
 * - Header set from `LLMRequestPrep.prepare` for `opencode*` providers: only
 *   x-opencode-project / x-opencode-session / x-opencode-request /
 *   x-opencode-client plus the wire User-Agent. Desktop 1.18.31 sets
 *   `USER_AGENT = opencode/${InstallationChannel}/${InstallationVersion}/${OPENCODE_CLIENT}`
 *   (`prod` / version / `desktop`). That value is what rides the wire for Zen.
 *   The x-session-affinity / X-Session-Id pair is only sent for
 *   NON-opencode providers, so it must NOT be present here.
 */
export interface RequestIDs {
  session: string
  request: string
  /** Official Hash.fast(project) when known; omit the header when absent. */
  project?: string
}
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

let lastTimestamp = 0
let counter = 0

function timePart(descending: boolean, timestamp: number): string {
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp
    counter = 0
  }
  counter++
  const current = BigInt(timestamp) * 0x1000n + BigInt(counter)
  const value = descending ? ~current : current
  return Array.from(
    { length: 6 },
    (_, index) => Number((value >> BigInt(40 - 8 * index)) & 0xffn).toString(16).padStart(2, '0'),
  ).join('')
}

function randomTail(length: number): string {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += BASE62[bytes[i]! % 62]
  return out
}

/** Deterministic 14-char tail from a seed (stable session per conversation). */
function seededTail(seed: string, length: number): string {
  const digest = createHash('sha256').update(seed).digest()
  let out = ''
  for (let i = 0; i < length; i++) out += BASE62[digest[i % digest.length]! % 62]
  return out
}

function makeID(prefix: string, descending: boolean, timestamp: number, tail: string): string {
  return `${prefix}_${timePart(descending, timestamp)}${tail}`
}

/** Current OpenCode release line (`packages/opencode/package.json`). */
export function opencodeVersion(): string {
  const fromEnv = typeof process.env.OPENCODE_VERSION === 'string' ? process.env.OPENCODE_VERSION.trim() : ''
  return fromEnv || '1.18.31'
}
function installationChannel(): string {
  const fromEnv = typeof process.env.OPENCODE_CHANNEL === 'string' ? process.env.OPENCODE_CHANNEL.trim() : ''
  return fromEnv || 'prod'
}

const PROVIDER_UTILS_VERSION: Record<string, string> = {
  'openai-responses': '4.0.40',
  'openai-completions': '4.0.23',
  'anthropic-messages': '4.0.46',
  'google-generative-ai': '4.0.27',
}

function nodeRuntime(): string {
  const fromEnv = typeof process.env.OPENCODE_NODE_VERSION === 'string' ? process.env.OPENCODE_NODE_VERSION.trim() : ''
  if (fromEnv) return fromEnv
  const v = process.versions?.node ?? '24.15.0'
  const major = v.split('.')[0] ?? '24'
  return major
}

/**
 * Exact wire User-Agent captured from official sidecar `globalThis.fetch`:
 * `opencode/<version> ai-sdk/provider-utils/<v> runtime/node.js/<major>`.
 * Catalog fetches use `catalogUserAgent` (`opencode/prod/<v>/desktop`).
 */
export function opencodeUserAgent(api?: string): string {
  const utils = (api !== undefined ? PROVIDER_UTILS_VERSION[api] : undefined) ?? PROVIDER_UTILS_VERSION['openai-responses']!
  return `opencode/${opencodeVersion()} ai-sdk/provider-utils/${utils} runtime/node.js/${nodeRuntime()}`
}

function opencodeClient(): string {
  const fromEnv = typeof process.env.OPENCODE_CLIENT === 'string' ? process.env.OPENCODE_CLIENT.trim() : ''
  return fromEnv || 'desktop'
}

/** Bare UA for models.opencode.ai (sidecar catalog GET). */
export function catalogUserAgent(): string {
  return `opencode/${installationChannel()}/${opencodeVersion()}/${opencodeClient()}`
}
/**
 * The conversation signal: JSON of the first user message's content. Using the
 * first user turn keeps a multi-turn conversation stable as its history grows.
 */
export function conversationSeed(messages: Array<{ role: string; content: unknown }>): string {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const encoded = JSON.stringify(message.content ?? null)
    if (encoded !== 'null' && encoded.length > 0) return encoded
  }
  return ''
}

const SESSION_CACHE_LIMIT = 256
const sessionBySeed = new Map<string, { timestamp: number; tail: string }>()

function stableSession(seed: string): { timestamp: number; tail: string } {
  const existing = sessionBySeed.get(seed)
  if (existing) {
    sessionBySeed.delete(seed)
    sessionBySeed.set(seed, existing)
    return existing
  }
  const created = { timestamp: Date.now(), tail: seededTail(`ses:${seed}`, 14) }
  sessionBySeed.set(seed, created)
  if (sessionBySeed.size > SESSION_CACHE_LIMIT) {
    const oldest = sessionBySeed.keys().next().value
    if (oldest !== undefined) sessionBySeed.delete(oldest)
  }
  return created
}

function projectId(): string | undefined {
  const fromEnv = typeof process.env.OPENCODE_PROJECT_ID === 'string' ? process.env.OPENCODE_PROJECT_ID.trim() : ''
  if (fromEnv.toLowerCase() === 'omit' || fromEnv.toLowerCase() === 'none') return undefined
  return fromEnv || 'global'
}

/**
 * Derive correlation ids for one upstream request. Session is stable for the
 * conversation seed (same time quantity + tail across retries). Request is a
 * fresh ascending user-message id per call. Project defaults to `global` (official
 * desktop sidecar always sends `x-opencode-project: global`). Set OPENCODE_PROJECT_ID
 * to override, or `omit`/`none` to drop the header.
 */
export function deriveRequestIDs(messages: Array<{ role: string; content: unknown }>): RequestIDs {
  const seed = conversationSeed(messages)
  const sessionSeed = seed === '' || seed === '{}' ? 'fallback:empty' : seed
  const session = stableSession(sessionSeed)
  const project = projectId()
  return {
    session: makeID('ses', true, session.timestamp, session.tail),
    request: makeID('msg', false, Date.now(), randomTail(14)),
    ...(project ? { project } : {}),
  }
}

/**
 * The exact header set OpenCode sends for `opencode*` providers. Upstream
 * waterfall headers (e.g. from x-grok-conv-id) still win on collision.
 *
 * Stainless SDK telemetry (`X-Stainless-*`, emitted by the `openai` /
 * `@anthropic-ai/sdk` clients pi-ai builds on) is explicitly nulled: the
 * Stainless `buildHeaders` helper deletes null-valued defaults, and
 * official OpenCode (Vercel AI SDK transport) never emits them. Same for
 * the SDKs' default `Accept` (Vercel only sends Content-Type),
 * `anthropic-dangerous-direct-browser-access` (browser-only flag Vercel
 * never sets), and pi-ai's always-on `anthropic-beta`
 * (`interleaved-thinking-…`; Vercel sends betas only when a feature
 * requires one, and these models advertise no reasoning levels).
 */
export function disguiseHeaders(
  ids: RequestIDs,
  api: string,
  extraHeaders?: Record<string, string>,
): Record<string, string | null> {
  const headers: Record<string, string | null> = {
    'User-Agent': opencodeUserAgent(api),
    'x-opencode-session': ids.session,
    'x-opencode-request': ids.request,
    'x-opencode-client': opencodeClient(),
    'X-Stainless-Lang': null,
    'X-Stainless-Package-Version': null,
    'X-Stainless-OS': null,
    'X-Stainless-Arch': null,
    'X-Stainless-Runtime': null,
    'X-Stainless-Runtime-Version': null,
    'X-Stainless-Retry-Count': null,
    'X-Stainless-Timeout': null,
    'X-Stainless-Async': null,
    Accept: null,
    'anthropic-dangerous-direct-browser-access': null,
    'anthropic-beta': null,
    ...(extraHeaders ?? {}),
  }
  if (ids.project) headers['x-opencode-project'] = ids.project
  else delete headers['x-opencode-project']
  return headers
}
