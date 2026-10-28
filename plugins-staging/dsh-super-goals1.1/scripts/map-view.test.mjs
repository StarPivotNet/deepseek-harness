/**
 * Mind-map camera: cursor-anchored zoom and 1:1 node drag (TDD).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)))
const SRC = join(ROOT, 'src')

async function loadMapView() {
  return import(pathToFileURL(join(SRC, 'client', 'map-view.ts')).href)
}

test('map view keeps the cursor world point when zooming and drags 1:1', async () => {
  const {
    clientToOverlay,
    overlayDragPosition,
    clientToWorld,
    panView,
    zoomViewAt,
    nodeDragPosition,
    nodeMovedEnough,
    clampScale,
    wheelZoomFactor,
    MAP_MIN_SCALE,
    MAP_MAX_SCALE,
  } = await loadMapView()
  const origin = { left: 100, top: 40 }
  const view = { k: 1, tx: 20, ty: 10 }
  assert.deepEqual(clientToWorld(view, 220, 150, origin), { x: 100, y: 100 })
  assert.deepEqual(clientToOverlay(220, 150, origin), { x: 120, y: 110 })
  assert.deepEqual(overlayDragPosition({ x: 80, y: 40 }, { x: 12, y: -5 }), { x: 92, y: 35 })

  const panned = panView(view, 30, -10)
  assert.deepEqual(panned, { k: 1, tx: 50, ty: 0 })
  assert.deepEqual(clientToWorld(panned, 220, 150, origin), { x: 70, y: 110 })

  const zoomed = zoomViewAt(view, 220, 150, origin, 1.08)
  assert.equal(zoomed.k, 1.08)
  const anchored = clientToWorld(zoomed, 220, 150, origin)
  assert.ok(Math.abs(anchored.x - 100) < 1e-10)
  assert.ok(Math.abs(anchored.y - 100) < 1e-10)

  const naive = { ...view, k: 1.08 }
  const naiveWorld = clientToWorld(naive, 220, 150, origin)
  assert.ok(Math.abs(naiveWorld.x - 100) > 0.5)

  const v2 = { k: 2, tx: 20, ty: 10 }
  const startWorld = clientToWorld(v2, 220, 150, origin)
  assert.deepEqual(startWorld, { x: 50, y: 50 })
  const start = { sx: startWorld.x, sy: startWorld.y, bx: 40, by: 60 }
  const movedWorld = clientToWorld(v2, 228, 156, origin)
  const pos = nodeDragPosition(start, movedWorld)
  assert.deepEqual(pos, { x: 44, y: 63 })
  assert.equal(nodeMovedEnough(start, startWorld, 2), false)
  assert.equal(nodeMovedEnough(start, movedWorld, 2), true)

  assert.equal(clampScale(0.1), MAP_MIN_SCALE)
  assert.equal(clampScale(9), MAP_MAX_SCALE)
  assert.equal(wheelZoomFactor(100), 0.92)
  assert.equal(wheelZoomFactor(-100), 1.08)

  const maxed = { k: MAP_MAX_SCALE, tx: 5, ty: 7 }
  const still = zoomViewAt(maxed, 220, 150, origin, 1.08)
  assert.equal(still.k, MAP_MAX_SCALE)
  const before = clientToWorld(maxed, 220, 150, origin)
  const after = clientToWorld(still, 220, 150, origin)
  assert.ok(Math.abs(before.x - after.x) < 1e-10)
  assert.ok(Math.abs(before.y - after.y) < 1e-10)
})

test('mind map captures pointers on the HTML map container and zooms at the cursor', () => {
  const src = readFileSync(join(SRC, 'client', 'index.ts'), 'utf8')
  assert.match(src, /from '\.\/map-view\.ts'/)
  assert.match(src, /zoomViewAt/)
  assert.match(src, /clientToWorld/)
  assert.match(src, /onPointerCancel/)
  assert.match(src, /touch-action:none/)
  assert.match(src, /mapRef\.current\?\.setPointerCapture/)
  assert.doesNotMatch(src, /\(e\.target as Element\)\.setPointerCapture/)
  assert.doesNotMatch(src, /setView\(v => \(\{ \.\.\.v, k:/)
})
