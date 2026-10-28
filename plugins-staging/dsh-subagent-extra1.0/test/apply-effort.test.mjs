import assert from 'node:assert/strict'
import test from 'node:test'
import { applySubagentEffort, isSubagentRequest } from '../lib/apply-effort.js'

function child(parentSession) {
  return { agent: { session: { header: { origin: 'subagent', parentSession } } } }
}

test('ignores a request that is not a subagent', () => {
  const config = { provider: 'p', model: 'm', reasoningEffort: 'high' }
  assert.equal(isSubagentRequest({ agent: { session: { header: { origin: 'user' } } } }), false)
  assert.equal(applySubagentEffort(config, { agent: { session: { header: {} } } }, new Map([['parent', 'low']])), config)
})

test('leaves a subagent request unchanged when its parent set nothing', () => {
  const config = { provider: 'p', model: 'm', reasoningEffort: 'high' }
  const result = applySubagentEffort(config, child('parent'), new Map())
  assert.equal(result, config)
})

const lowOnRoute = new Map([['parent', { provider: 'p', model: 'm', effort: 'low' }]])

test('replaces inherited effort for a direct child on the same route', () => {
  const result = applySubagentEffort(
    { provider: 'p', model: 'm', reasoningEffort: 'high' },
    child('parent'),
    lowOnRoute,
  )
  assert.deepEqual(result, { provider: 'p', model: 'm', reasoningEffort: 'low' })
})

test('fills a child request that has no effort yet', () => {
  const result = applySubagentEffort(
    { provider: 'p', model: 'm' },
    child('parent'),
    new Map([['parent', { provider: 'p', model: 'm', effort: 'max' }]]),
  )
  assert.equal(result.reasoningEffort, 'max')
})

test('does not stamp the parent effort onto a different child route', () => {
  const config = { provider: 'p', model: 'other', reasoningEffort: 'high' }
  const result = applySubagentEffort(config, child('parent'), lowOnRoute)
  assert.equal(result, config)
})

test('does not apply a grandparent override to a nested child', () => {
  const config = { provider: 'p', model: 'm', reasoningEffort: 'high' }
  const result = applySubagentEffort(config, child('child-session'), new Map([['root', 'low']]))
  assert.equal(result, config)
})
