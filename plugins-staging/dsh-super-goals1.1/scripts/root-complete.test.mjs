/**
 * Required vs optional module roots, and a always-solid origin node.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)))
const SRC = join(ROOT, 'src')
const LIB = join(ROOT, 'lib')

function resolveMod(name) {
  const src = join(SRC, name + '.ts')
  const lib = join(LIB, name + '.js')
  if (existsSync(lib)) return pathToFileURL(lib).href
  if (existsSync(src)) return pathToFileURL(src).href
  throw new Error('missing module ' + name)
}

async function loadSchema() {
  return import(resolveMod('schema'))
}

async function loadMapGeometry() {
  return import(pathToFileURL(join(SRC, 'client', 'map-geometry.ts')).href)
}

function boardWith(schema, ops) {
  const now = '2026-04-01T00:00:00.000Z'
  const b = schema.newBoard('Plan', 'goal')
  schema.applyOps(b, ops, now)
  return b
}

test('add_node stores required/optional completion on modules and defaults to required', async () => {
  const schema = await loadSchema()
  const b = boardWith(schema, [
    { op: 'add_node', node: { id: 'm-req', type: 'module', title: '必完' } },
    { op: 'add_node', node: { id: 'm-opt', type: 'module', title: '可不完', completion: 'optional' } },
    { op: 'add_node', node: { id: 't1', type: 'task', title: 'T', parent: 'm-req' } },
  ])
  const req = b.nodes.find((n) => n.id === 'm-req')
  const opt = b.nodes.find((n) => n.id === 'm-opt')
  const task = b.nodes.find((n) => n.id === 't1')
  assert.equal(req.completion, 'required')
  assert.equal(opt.completion, 'optional')
  assert.equal(task.completion, undefined)
})

test('required module completes when every child task is done or canceled', async () => {
  const schema = await loadSchema()
  const b = boardWith(schema, [
    { op: 'add_node', node: { id: 'm1', type: 'module', title: '必完', completion: 'required' } },
    { op: 'add_node', node: { id: 't1', type: 'task', title: 'A', parent: 'm1' } },
    { op: 'add_node', node: { id: 't2', type: 'task', title: 'B', parent: 'm1' } },
  ])
  const m = b.nodes.find((n) => n.id === 'm1')
  assert.equal(schema.moduleComplete(b, m), false)
  b.nodes.find((n) => n.id === 't1').status = 'done'
  b.nodes.find((n) => n.id === 't1').evidence = ['a']
  b.nodes.find((n) => n.id === 't2').status = 'canceled'
  assert.equal(schema.moduleComplete(b, m), true)
})

test('optional module does not auto-complete when children finish', async () => {
  const schema = await loadSchema()
  const b = boardWith(schema, [
    { op: 'add_node', node: { id: 'm1', type: 'module', title: '可不完', completion: 'optional' } },
    { op: 'add_node', node: { id: 't1', type: 'task', title: 'A', parent: 'm1' } },
  ])
  const m = b.nodes.find((n) => n.id === 'm1')
  b.nodes.find((n) => n.id === 't1').status = 'done'
  b.nodes.find((n) => n.id === 't1').evidence = ['a']
  assert.equal(schema.moduleComplete(b, m), false)
  m.status = 'done'
  m.evidence = ['explicit']
  assert.equal(schema.moduleComplete(b, m), true)
})

test('depSatisfied ignores optional-module auto-settle', async () => {
  const schema = await loadSchema()
  const b = boardWith(schema, [
    { op: 'add_node', node: { id: 'opt', type: 'module', title: '可不完', completion: 'optional' } },
    { op: 'add_node', node: { id: 'req', type: 'module', title: '必完', completion: 'required' } },
    { op: 'add_node', node: { id: 't-opt', type: 'task', title: 'O', parent: 'opt' } },
    { op: 'add_node', node: { id: 't-req', type: 'task', title: 'R', parent: 'req' } },
    { op: 'add_node', node: { id: 'wait', type: 'module', title: 'W' } },
    { op: 'add_node', node: { id: 't-wait', type: 'task', title: 'Need both', parent: 'wait', deps: ['opt', 'req'] } },
  ])
  b.nodes.find((n) => n.id === 't-opt').status = 'done'
  b.nodes.find((n) => n.id === 't-opt').evidence = ['o']
  b.nodes.find((n) => n.id === 't-req').status = 'done'
  b.nodes.find((n) => n.id === 't-req').evidence = ['r']
  assert.equal(schema.depSatisfied(b, 'req'), true)
  assert.equal(schema.depSatisfied(b, 'opt'), false)
})

test('origin paint is always solid; required settled roots paint done green', async () => {
  const geo = await loadMapGeometry()
  assert.equal(typeof geo.originPaint, 'function')
  assert.equal(typeof geo.displayPaint, 'function')
  const origin = geo.originPaint()
  assert.notEqual(origin.fill, 'none')
  assert.notEqual(origin.fill, geo.statusPaint('planned').fill)
  const planned = geo.displayPaint({ origin: false, status: 'planned', optional: false, settled: false })
  assert.equal(planned.fill, 'none')
  const requiredDone = geo.displayPaint({ origin: false, status: 'planned', optional: false, settled: true })
  assert.equal(requiredDone.fill, geo.statusPaint('done').fill)
  assert.equal(requiredDone.stroke, geo.statusPaint('done').stroke)
  const optionalKidsDone = geo.displayPaint({ origin: false, status: 'planned', optional: true, settled: true })
  assert.equal(optionalKidsDone.fill, 'none')
  const originDisplay = geo.displayPaint({ origin: true, status: 'planned', optional: false, settled: false })
  assert.notEqual(originDisplay.fill, 'none')
  assert.equal(originDisplay.fill, origin.fill)
})

test('origin menu adds required and optional roots; modules expose completion', () => {
  const src = readFileSync(join(SRC, 'client', 'index.ts'), 'utf8')
  assert.match(src, /originPaint|displayPaint/)
  assert.match(src, /[\u5fc5\u5b8c\u6839]/)
  assert.match(src, /[\u53ef\u4e0d\u5b8c\u6839]/)
  assert.match(src, /completion:\s*['"]required['"]/)
  assert.match(src, /completion:\s*['"]optional['"]/)
  assert.match(src, /completion !== 'optional'|completion === 'optional'|optional:/)
})
