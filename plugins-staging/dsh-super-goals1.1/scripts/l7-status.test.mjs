/**
 * Scope enforcement is removed; mind-map status is labeled on hover.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)))
const SRC = join(ROOT, 'src')

async function loadMapGeometry() {
  return import(pathToFileURL(join(SRC, 'client', 'map-geometry.ts')).href)
}

test('scope enforcement is gone from the host entry', async () => {
  const indexSrc = readFileSync(join(SRC, 'index.ts'), 'utf8')
  const routesSrc = readFileSync(join(SRC, 'routes.ts'), 'utf8')
  assert.equal(existsSync(join(SRC, 'guard.ts')), false)
  assert.doesNotMatch(indexSrc, /ScopeGuard/)
  assert.doesNotMatch(indexSrc, /enforceScope/)
  assert.doesNotMatch(routesSrc, /sub === '\/guard'/)
  assert.doesNotMatch(routesSrc, /sub === '\/approve'/)
})

test('mind-map status has Chinese labels and SVG title hover text', async () => {
  const geo = await loadMapGeometry()
  assert.equal(typeof geo.statusLabel, 'function')
  assert.equal(geo.statusLabel('planned'), '计划中')
  assert.equal(geo.statusLabel('ready'), '就绪')
  assert.equal(geo.statusLabel('doing'), '进行中')
  assert.equal(geo.statusLabel('blocked'), '已阻断')
  assert.equal(geo.statusLabel('done'), '已完成')
  assert.equal(geo.statusLabel('canceled'), '已取消')
  const client = readFileSync(join(SRC, 'client', 'index.ts'), 'utf8')
  assert.match(client, /statusLabel/)
  assert.match(client, /h\('title'/)
  assert.match(client, /statusLabel\(/)
  assert.doesNotMatch(client, /L7 越界拦截/)
  assert.doesNotMatch(client, /暂停拦截/)
})
