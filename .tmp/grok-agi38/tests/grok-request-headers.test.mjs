import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  grokRequestHeaders,
  promptIndexFor,
  hasCompactionSummary,
  reqIdFor,
  conversationGroupId,
  compactionAtTokens,
  doomLoopWindow,
  exactRepetitionMinTokens,
  headerValue,
  rootSessionId,
  grokIdentityHeaders,
} from '../grok-conv-header.mjs'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const HEADER = join(PRESET_ROOT, 'grok-conv-header.mjs')
const CORDIS = join(PRESET_ROOT, 'agent.cordis.yml')

function user(id) {
  return { role: 'user', id, source: { kind: 'user' } }
}

function plugin(name) {
  return { role: 'user', source: { kind: 'plugin', plugin: name, form: 'snapshot' } }
}

function compact() {
  return { role: 'user', source: { kind: 'plugin', plugin: 'compact', compactionId: 'c1' } }
}

const IDENTITY = {
  userId: 'user-1',
  rootId: 'ses',
  contextWindow: 256000,
  thresholdPercent: 80,
  doomWindow: 1024,
}

describe('grok request headers', () => {
  it('counts only kind:user messages and starts at 0', () => {
    const messages = [plugin('ledger-inject'), user('a'), plugin('todo-inject'), user('b')]
    assert.equal(promptIndexFor(messages, 'a'), '0')
    assert.equal(promptIndexFor(messages, 'b'), '1')
    assert.equal(promptIndexFor(messages, undefined), '1')
  })

  it('does not count a compact checkpoint as a user prompt', () => {
    const messages = [user('a'), compact(), user('b')]
    assert.equal(promptIndexFor(messages, 'b'), '1')
  })

  it('sees a compaction summary only while a compact checkpoint is still present', () => {
    assert.equal(hasCompactionSummary([user('a')]), false)
    assert.equal(hasCompactionSummary([compact(), user('b')]), true)
    assert.equal(hasCompactionSummary([user('b')]), false)
  })

  it('keeps one request id for a user prompt and mints a fresh one otherwise', () => {
    const ids = new Map()
    const first = reqIdFor(ids, 'ses', 'prompt-1')
    assert.equal(reqIdFor(ids, 'ses', 'prompt-1'), first)
    assert.notEqual(reqIdFor(ids, 'ses', 'prompt-2'), first)
    const side = reqIdFor(ids, 'ses', undefined)
    assert.notEqual(side, first)
    assert.notEqual(reqIdFor(ids, 'ses', undefined), side)
  })

  it('stamps the Grok per-request set and drops the remaining count after compaction', () => {
    const convIds = new Map([['ses', 'conv-fixed']])
    const reqIds = new Map()
    const fresh = {
      sessionId: 'ses',
      model: 'grok-4',
      messages: [user('prompt-1')],
    }
    const first = grokRequestHeaders(fresh, convIds, reqIds, IDENTITY)
    assert.equal(first['x-grok-conv-id'], 'conv-fixed')
    assert.equal(first['x-grok-session-id'], 'ses')
    assert.equal(first['x-grok-model-override'], 'grok-4')
    assert.equal(first['x-grok-turn-idx'], '0')
    assert.equal(first['x-grok-req-id'], 'prompt-1')
    assert.equal(first['x-compactions-remaining'], '1')
    assert.equal('x-grok-transient-retry' in first, false)
    assert.equal(first['x-grok-agent-id'], 'ses')
    assert.equal(first['x-grok-client-identifier'], 'grok-shell')
    assert.equal(first['x-grok-client-version'], '1.0.46')
    assert.equal(first['x-grok-doom-loop-check'], '1024')
    assert.equal(first['x-grok-exact-repetition-check'], '64')
    assert.equal(first['x-grok-conv-group-id'], conversationGroupId('ses'))
    assert.equal(first['x-compaction-at'], '499990')
    assert.equal(first['x-grok-user-id'], 'user-1')
    assert.equal('x-grok-deployment-id' in first, false)
    assert.equal('prompt_cache_key' in first, false)

    const again = grokRequestHeaders({ ...fresh, messages: [user('prompt-1'), { role: 'assistant' }] }, convIds, reqIds, IDENTITY)
    assert.equal(again['x-grok-req-id'], 'prompt-1')

    const compacted = grokRequestHeaders(
      { sessionId: 'ses', model: 'grok-4', messages: [compact(), user('prompt-2')] },
      convIds,
      reqIds,
      IDENTITY,
    )
    assert.equal(compacted['x-grok-turn-idx'], '0')
    assert.equal(compacted['x-grok-req-id'], 'prompt-2')
    assert.equal(compacted['x-compactions-remaining'], '0')
    assert.equal('x-compaction-at' in compacted, false)
  })

  it('uses a compact-prefixed request id and no turn index for compaction calls', () => {
    const headers = grokRequestHeaders(
      { sessionId: 'ses', purpose: 'compaction', model: 'grok-4', messages: [user('prompt-1')] },
      new Map([['ses', 'conv-fixed']]),
      new Map(),
      IDENTITY,
    )
    assert.match(headers['x-grok-req-id'], /^xai-compact-/)
    assert.equal('x-grok-turn-idx' in headers, false)
    assert.equal(headers['x-grok-session-id'], 'ses')
    assert.equal(headers['x-grok-agent-id'], 'ses')
    assert.equal('x-grok-transient-retry' in headers, false)
    assert.equal('x-compaction-at' in headers, false)
  })

  it('keeps the mount and does not overwrite a header the caller already set', () => {
    const source = readFileSync(HEADER, 'utf8')
    const cordis = readFileSync(CORDIS, 'utf8')
    assert.match(source, /x-grok-req-id/)
    assert.match(source, /x-grok-turn-idx/)
    assert.match(source, /x-compactions-remaining/)
    assert.match(source, /x-grok-agent-id/)
    assert.match(source, /x-grok-client-identifier/)
    assert.match(source, /x-grok-doom-loop-check/)
    assert.match(source, /x-grok-exact-repetition-check/)
    assert.match(source, /x-grok-conv-group-id/)
    assert.match(source, /x-compaction-at/)
    assert.match(cordis, /id: grok-conv-header/)
    assert.match(source, /prev\[key\]/)
    assert.doesNotMatch(source, /headers\['prompt_cache_key'\]/)
    assert.doesNotMatch(source, /headers\['x-grok-transient-retry'\]/)
    assert.match(source, /headers\['x-grok-client-version'\] = '1\.0\.46'/)
  })

  it('derives the frozen conversation group and walks parentSession to the root', () => {
    assert.equal(conversationGroupId('root-session-123'), '111fc242-925b-5a7d-826e-2974daad239f')
    assert.notEqual(conversationGroupId('root-a'), conversationGroupId('root-b'))
    const child = { id: 'child', header: { parentSession: 'root' } }
    const missing = { id: 'orphan', header: { parentSession: 'gone' } }
    const lookup = (id) => (id === 'root' ? { id: 'root', header: {} } : undefined)
    assert.equal(rootSessionId(child, lookup), 'root')
    assert.equal(rootSessionId(missing, lookup), 'orphan')
    assert.equal(rootSessionId({ id: 'self' }, lookup), 'self')
  })

  it('sends the fixed compaction token count only before compaction and pins the doom window', () => {
    assert.equal(compactionAtTokens(false), '499990')
    assert.equal(compactionAtTokens(true), undefined)
    assert.equal(doomLoopWindow(undefined), '1024')
    assert.equal(doomLoopWindow(4096), '1024')
    assert.equal(doomLoopWindow(false), '1024')
    assert.equal(exactRepetitionMinTokens(undefined), '64')
    assert.equal(exactRepetitionMinTokens(false), '64')
  })

  it('reads a header-safe string and skips secrets and empty values', () => {
    assert.equal(headerValue(' agent-1 '), 'agent-1')
    assert.equal(headerValue(''), undefined)
    assert.equal(headerValue('bad\rvalue'), undefined)
    assert.equal(headerValue(12), undefined)
  })

  it('stamps the session id as the agent id and pins the client identity', () => {
    const headers = grokIdentityHeaders({
      sessionId: 'ses-child',
      userId: 'user-1',
      deploymentId: '',
      rootId: 'root-session-123',
      contextWindow: 256000,
      thresholdPercent: 80,
      compacted: false,
      doomWindow: 1024,
    })
    assert.equal(headers['x-grok-agent-id'], 'ses-child')
    assert.equal(headers['x-grok-client-identifier'], 'grok-shell')
    assert.equal(headers['x-grok-client-version'], '1.0.46')
    assert.equal(headers['x-grok-conv-group-id'], '111fc242-925b-5a7d-826e-2974daad239f')
    assert.equal(headers['x-compaction-at'], '499990')
    assert.equal(headers['x-grok-exact-repetition-check'], '64')
    assert.equal('x-grok-deployment-id' in headers, false)
    assert.equal('x-grok-transient-retry' in headers, false)

    const compacted = grokIdentityHeaders({
      sessionId: 'ses-child',
      compacted: true,
      contextWindow: 256000,
      doomWindow: false,
    })
    assert.equal(compacted['x-grok-agent-id'], 'ses-child')
    assert.equal('x-compaction-at' in compacted, false)
    assert.equal(compacted['x-grok-doom-loop-check'], '1024')
    assert.equal(compacted['x-grok-exact-repetition-check'], '64')
    assert.equal('x-grok-user-id' in compacted, false)
  })
})
