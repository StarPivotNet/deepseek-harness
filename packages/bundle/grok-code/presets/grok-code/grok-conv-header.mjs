/**
 * Grok request headers plus harness:identity shadow for dsh-grok sessions.
 *
 * Stamps every streaming model call of this preset with the headers Grok's
 * sampler sends on a turn: a stable x-grok-conv-id (prefix-cache affinity within a session,
 * never across sessions), the session id, the model id,
 * a request id held for one user prompt, a 0-based turn index,
 * x-compactions-remaining (1 until a compact checkpoint is on the surface,
 * then 0), plus the identity headers listed below.
 * A compaction call gets xai-compact-<uuid> and no turn index.
 * Identity headers are stamped only when the local Grok facts exist:
 * x-grok-agent-id is this stream's session id (the routing bucket, not the machine id),
 * x-grok-client-identifier is grok-shell, x-grok-client-version is 1.0.46,
 * x-grok-user-id from an xAI login, x-grok-deployment-id from a deployment key,
 * x-grok-conv-group-id from the root session, x-compaction-at as the fixed 499000
 * until a compact checkpoint is on the surface, and both loop-check headers always:
 * x-grok-doom-loop-check is fixed at 1024 and x-grok-exact-repetition-check is fixed at 64.
 * x-grok-transient-retry is not sent: DSH does not resubmit a turn the way Grok does.
 * prompt_cache_key is a Responses body field. dsh-llm-pi-ai already sends the
 * current session id there, truncated to 64 characters. This row cannot rewrite that body.
 * A header the caller already set is left alone.
 * Shadows host harness:identity (empty, so the Chinese-first persona prefix leads).
 * AgentTeams usage shadow lives in agent-teams-stub.mjs. No service is published.
 */

import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'grok-conv-header'
export const inject = ['sessions', 'systemPrompt']
const GROK_PREFIX = 'dsh-grok'
const HEADER = 'x-grok-conv-id'
const CONV_SEED_NS = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'
const HEX = '0123456789abcdef'

function sha1hex(text) {
  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0
  const bytes = []
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff, (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff)
  const rotl = (v, n) => ((v << n) | (v >>> (32 - n))) >>> 0
  const words = []
  for (let i = 0; i < bytes.length; i += 4) {
    words.push((((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0))
  }
  for (let i = 0; i < words.length; i += 16) {
    const w = words.slice(i, i + 16)
    for (let t = 16; t < 80; t += 1) {
      w[t] = rotl((w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]) >>> 0, 1)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let t = 0; t < 80; t += 1) {
      let f
      let k
      if (t < 20) { f = ((b & c) | (~b & d)) >>> 0; k = 0x5a827999 }
      else if (t < 40) { f = (b ^ c ^ d) >>> 0; k = 0x6ed9eba1 }
      else if (t < 60) { f = ((b & c) | (b & d) | (c & d)) >>> 0; k = 0x8f1bbcdc }
      else { f = (b ^ c ^ d) >>> 0; k = 0xca62c1d6 }
      const tmp = (rotl(a, 5) + f + e + k + w[t]) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = tmp
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }
  return [h0, h1, h2, h3, h4].map((v) => v.toString(16).padStart(8, '0')).join('')
}

function uuidv5(seedText) {
  const hex = sha1hex(`${CONV_SEED_NS}:${seedText}`)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`
}

function uuidv5Bytes(namespace, name) {
  const hash = createHash('sha1').update(Buffer.from(namespace, 'hex')).update(name).digest()
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function uuidv4() {
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => HEX[b >> 4] + HEX[b & 0x0f]).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isUserPrompt(message) {
  return message != null && message.role === 'user' && message.source != null && message.source.kind === 'user'
}

function isCompactCheckpoint(message) {
  const source = message == null ? undefined : message.source
  return source != null && source.kind === 'plugin' && source.plugin === 'compact'
}

export function promptIndexFor(messages, anchorId) {
  if (!Array.isArray(messages)) return '0'
  let count = 0
  let last = -1
  for (const message of messages) {
    if (!isUserPrompt(message)) continue
    if (typeof anchorId === 'string' && message.id === anchorId) return String(count)
    last = count
    count += 1
  }
  return String(last < 0 ? 0 : last)
}

export function hasCompactionSummary(messages) {
  if (!Array.isArray(messages)) return false
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isCompactCheckpoint(messages[index])) return true
  }
  return false
}

function lastUserPromptId(messages) {
  if (!Array.isArray(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (isUserPrompt(message) && typeof message.id === 'string' && message.id !== '') return message.id
  }
  return undefined
}

export function reqIdFor(reqIds, sessionId, promptId) {
  if (typeof promptId !== 'string' || promptId === '') return uuidv4()
  const key = `${sessionId}\0${promptId}`
  let id = reqIds.get(key)
  if (!id) {
    id = promptId
    reqIds.set(key, id)
  }
  return id
}

const GROUP_NS = 'xai:grok-build:conversation-group:'
const XAI_ISSUERS = new Set(['https://auth.x.ai', 'http://localhost:22255'])
const XAI_AUTH_MODES = new Set(['oidc', 'external'])

export function headerValue(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || /[\r\n\0]/.test(trimmed)) return undefined
  return trimmed
}

export function conversationGroupId(rootId) {
  const seed = headerValue(rootId)
  if (!seed) return undefined
  return uuidv5Bytes('6ba7b8129dad11d180b400c04fd430c8', `${GROUP_NS}${seed}`)
}

export function rootSessionId(session, lookup) {
  let current = session
  const seen = new Set()
  while (current != null) {
    const id = headerValue(current.id)
    if (!id || seen.has(id)) return id
    seen.add(id)
    const parentId = current.header == null ? undefined : headerValue(current.header.parentSession)
    if (!parentId || typeof lookup !== 'function') return id
    const parent = lookup(parentId)
    if (parent == null) return id
    current = parent
  }
  return undefined
}

export const COMPACTION_AT_TOKENS = '499000'

export function compactionAtTokens(compacted) {
  if (compacted) return undefined
  return COMPACTION_AT_TOKENS
}

export const DOOM_LOOP_WINDOW = '1024'
export const EXACT_REPETITION_MIN_TOKENS = '64'

export function doomLoopWindow() {
  return DOOM_LOOP_WINDOW
}

export function exactRepetitionMinTokens() {
  return EXACT_REPETITION_MIN_TOKENS
}

export function grokIdentityHeaders(facts) {
  const headers = {}
  const source = facts == null ? {} : facts
  const agentId = headerValue(source.sessionId)
  if (agentId) headers['x-grok-agent-id'] = agentId
  headers['x-grok-client-identifier'] = 'grok-shell'
  headers['x-grok-client-version'] = '1.0.46'
  const userId = headerValue(source.userId)
  if (userId) headers['x-grok-user-id'] = userId
  const deploymentId = headerValue(source.deploymentId)
  if (deploymentId) headers['x-grok-deployment-id'] = deploymentId
  const groupId = conversationGroupId(source.rootId)
  if (groupId) headers['x-grok-conv-group-id'] = groupId
  const compactionAt = source.compactionDisabled === true ? undefined : compactionAtTokens(source.compacted === true)
  if (compactionAt) headers['x-compaction-at'] = compactionAt
  headers['x-grok-doom-loop-check'] = doomLoopWindow()
  headers['x-grok-exact-repetition-check'] = exactRepetitionMinTokens()
  return headers
}

export function grokRequestHeaders(options, convIds, reqIds, identity) {
  const sessionId = options.sessionId
  const headers = {}
  headers[HEADER] = convIds.get(sessionId)
  headers['x-grok-session-id'] = sessionId
  if (typeof options.model === 'string' && options.model !== '') {
    headers['x-grok-model-override'] = options.model
  }
  const compacted = hasCompactionSummary(options.messages)
  if (options.purpose === 'compaction') {
    headers['x-grok-req-id'] = `xai-compact-${uuidv4()}`
  } else {
    const promptId = lastUserPromptId(options.messages)
    headers['x-grok-req-id'] = reqIdFor(reqIds, sessionId, promptId)
    headers['x-grok-turn-idx'] = promptIndexFor(options.messages, promptId)
  }
  headers['x-compactions-remaining'] = compacted ? '0' : '1'
  const facts = { ...(identity ?? {}), compacted: compacted || options.purpose === 'compaction' }
  facts.sessionId = sessionId
  if (facts.rootId == null) facts.rootId = sessionId
  Object.assign(headers, grokIdentityHeaders(facts))
  return headers
}

function grokHome() {
  const fromEnv = headerValue(process.env.GROK_HOME)
  if (fromEnv) return fromEnv
  try {
    const home = homedir()
    if (typeof home === 'string' && home !== '') return join(home, '.grok')
  } catch (error) {}
  return undefined
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    return undefined
  }
}

function readJson(path) {
  const text = readText(path)
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch (error) {
    return undefined
  }
}

function contextWindowOf(session) {
  const events = session == null ? undefined : session.events
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event == null || event.type !== 'request/context' || event.data == null) continue
    const window = event.data.contextWindow
    if (Number.isFinite(window) && window > 0) return window
  }
  return undefined
}

export function loadGrokIdentity() {
  const home = grokHome()
  const facts = {}
  if (!home) return facts
  const models = readJson(join(home, 'models_cache.json'))
  const modelEntry = models == null || models.models == null ? undefined : Object.values(models.models)[0]
  const info = modelEntry == null ? undefined : modelEntry.info
  if (info != null) {
    if (Number.isFinite(info.context_window) && info.context_window > 0) facts.contextWindow = info.context_window
    if (Number.isInteger(info.auto_compact_threshold_percent)) facts.thresholdPercent = info.auto_compact_threshold_percent
    if (info.compaction_at_tokens === false) facts.compactionDisabled = true
  }
  const settings = readJson(join(home, 'settings_cache.json'))
  const payload = settings == null || typeof settings.payload !== 'string' ? undefined : readJsonText(settings.payload)
  const remote = payload == null ? undefined : payload.settings
  if (remote != null) {
    if (Number.isInteger(remote.auto_compact_threshold_percent)) facts.thresholdPercent = remote.auto_compact_threshold_percent
  }
  const auth = readJson(join(home, 'auth.json'))
  const login = xaiLogin(auth)
  if (login) facts.userId = headerValue(login.user_id)
  const deploymentKey = headerValue(process.env.GROK_DEPLOYMENT_KEY) ?? deploymentKeyFromConfig(readText(join(home, 'config.toml')))
  if (deploymentKey) facts.deploymentId = uuidv5(deploymentKey)
  return facts
}

function readJsonText(text) {
  try {
    return JSON.parse(text)
  } catch (error) {
    return undefined
  }
}

function xaiLogin(auth) {
  if (auth == null || typeof auth !== 'object') return undefined
  for (const entry of Object.values(auth)) {
    if (entry == null || typeof entry !== 'object') continue
    const mode = typeof entry.auth_mode === 'string' ? entry.auth_mode.toLowerCase() : ''
    const issuer = headerValue(entry.oidc_issuer)
    if (XAI_AUTH_MODES.has(mode) && issuer && XAI_ISSUERS.has(issuer)) return entry
  }
  return undefined
}

function deploymentKeyFromConfig(text) {
  if (typeof text !== 'string' || text === '') return undefined
  const match = text.match(/^\s*deployment_key\s*=\s*"([^"]+)"\s*$/m)
  return match ? headerValue(match[1]) : undefined
}

function isGrokPreset(session) {
  if (session == null) return false
  const names = []
  try {
    if (session.header != null && typeof session.header.agentPreset === 'string') names.push(session.header.agentPreset)
    const events = session.events
    if (Array.isArray(events)) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (event != null && event.type === 'agent-preset/selected' && event.data != null && typeof event.data.agentPreset === 'string') {
          names.push(event.data.agentPreset)
          break
        }
      }
    }
  } catch (error) {}
  for (const name of names) {
    if (typeof name === 'string' && name.indexOf(GROK_PREFIX) === 0) return true
  }
  return false
}

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'harness:identity',
    order: ctx.systemPrompt.getSectionOrder("HARNESS_IDENTITY"),
    text: '',
  })
  const convIds = new Map()
  const reqIds = new Map()
  let identity

  function identityFor() {
    if (!identity) identity = loadGrokIdentity()
    return identity
  }

  function convIdFor(sessionId) {
    let id = convIds.get(sessionId)
    if (!id) {
      id = uuidv5(sessionId)
      convIds.set(sessionId, id)
    }
    return id
  }

  ctx.on(
    'llm/stream',
    (options, next) => {
      try {
        const sid = options == null ? undefined : options.sessionId
        if (typeof sid !== 'string' || !sid) return next()
        const sessions = ctx.get('sessions')
        const session = sessions == null ? undefined : sessions.get(sid)
        if (!isGrokPreset(session)) return next()
        const prev =
          options.headers != null &&
          typeof options.headers === 'object' &&
          !Array.isArray(options.headers)
            ? options.headers
            : undefined
        convIdFor(sid)
        const facts = { ...identityFor() }
        const lookup = (id) => (sessions == null ? undefined : sessions.get(id))
        facts.rootId = rootSessionId(session, lookup) ?? sid
        const liveWindow = contextWindowOf(session)
        if (liveWindow) facts.contextWindow = liveWindow
        if (facts.compactionDisabled) facts.contextWindow = undefined
        const stamped = grokRequestHeaders(options, convIds, reqIds, facts)
        const merged = { ...(prev ?? {}) }
        for (const key of Object.keys(stamped)) {
          if (prev != null && typeof prev[key] === 'string' && prev[key] !== '') continue
          merged[key] = stamped[key]
        }
        options.headers = merged
      } catch (error) {
        // Frozen options, missing services, anything else: never break the stream.
      }
      return next()
    },
    { global: true },
  )

  ctx.on(
    'session/disposed',
    (session) => {
      try {
        const id = session == null ? undefined : session.id
        if (typeof id === 'string') {
          convIds.delete(id)
          const prefix = `${id}\0`
          for (const key of reqIds.keys()) {
            if (key.startsWith(prefix)) reqIds.delete(key)
          }
        }
      } catch (error) {}
    },
    { global: true },
  )
}
