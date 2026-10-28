/**
 * Session-bound board contract (TDD).
 * Tools take no path/project/cwd; children share the root board at
 * <cwd>/.super-goals/<session>/board.json.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { once } from 'node:events'
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

async function loadSession() {
  return import(resolveMod('session'))
}

function makeLookup(agents) {
  return (id) => agents.get(id)
}

function agent(id, { cwd, parent } = {}) {
  return {
    id,
    session: {
      header: {
        ...(cwd != null ? { cwd } : {}),
        ...(parent != null ? { parentSession: parent } : {}),
      },
    },
  }
}

test('child agent walks parentSession to the root board file', async () => {
  const { boardIdentityOf, BOARD_REL_DIR, BOARD_FILE } = await loadSession()
  const workspace = 'C:\\work\\demo'
  const agents = new Map([
    ['root-1', agent('root-1', { cwd: workspace })],
    ['child-2', agent('child-2', { parent: 'root-1' })],
  ])
  const id = boardIdentityOf(agents.get('child-2'), makeLookup(agents))
  assert.equal(id.rootId, 'root-1')
  assert.equal(id.workspace, workspace)
  assert.equal(id.boardDir, join(workspace, BOARD_REL_DIR, 'root-1'))
  assert.equal(id.boardFile, join(workspace, BOARD_REL_DIR, 'root-1', BOARD_FILE))
  assert.equal(BOARD_REL_DIR, '.super-goals')
  assert.equal(BOARD_FILE, 'board.json')
})

test('sessionDirName keeps ordinary ids and sanitizes separators', async () => {
  const { sessionDirName } = await loadSession()
  assert.equal(sessionDirName('session-7a72e993-a6fa-419e-bd4c-7b0c9568b65f'), 'session-7a72e993-a6fa-419e-bd4c-7b0c9568b65f')
  assert.equal(sessionDirName('a/b\\c'), 'a_b_c')
  assert.throws(() => sessionDirName('..'), /BAD_SESSION|非法/)
})

test('PlanStore writes board.json under .super-goals/<session>, not .plan-board', async () => {
  const { PlanStore } = await import(resolveMod('store'))
  const { boardIdentityOf } = await loadSession()
  const tmp = mkdtempSync(join(tmpdir(), 'pb-session-'))
  try {
    const agents = new Map([['root-1', agent('root-1', { cwd: tmp })]])
    const ident = boardIdentityOf(agents.get('root-1'), makeLookup(agents))
    const store = PlanStore.ensure(ident, { blockOnDrift: true }, { name: 'Demo', goal: 'ship' })
    const expected = join(tmp, '.super-goals', 'root-1', 'board.json')
    assert.equal(store.boardFile, expected)
    assert.equal(existsSync(expected), true)
    assert.equal(existsSync(join(tmp, '.plan-board', 'plan.board.json')), false)
    const parsed = JSON.parse(readFileSync(expected, 'utf8'))
    assert.equal(parsed.plan.name, 'Demo')
    assert.equal(parsed.plan.goal, 'ship')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

function collectTools() {
  const registered = []
  return {
    registered,
    register(tool) { registered.push(tool) },
  }
}

test('registered tools are super_goals_* and declare no path/project/cwd parameters', async () => {
  const { registerBoardTools, TOOL_NAMES } = await import(resolveMod('tools'))
  const tools = collectTools()
  const agents = new Map([['root-1', agent('root-1', { cwd: process.cwd() })]])
  registerBoardTools(tools, {
    lookup: makeLookup(agents),
    opts: { blockOnDrift: true },
  })
  assert.deepEqual([...TOOL_NAMES], ['super_goals_map', 'super_goals_edit', 'super_goals_next', 'super_goals_update'])
  const names = tools.registered.map((t) => t.name)
  assert.deepEqual(names, [...TOOL_NAMES])
  for (const tool of tools.registered) {
    const keys = Object.keys(tool.parameters?.properties ?? tool.parameters ?? {})
    for (const banned of ['project', 'path', 'cwd', 'workspace', 'sessionDir']) {
      assert.equal(keys.includes(banned), false, tool.name + ' must not take ' + banned)
    }
    assert.equal(typeof tool.output?.schema, 'object')
    assert.equal(typeof tool.output?.render, 'function')
    assert.equal(Number.isFinite(tool.timeoutMs) && tool.timeoutMs > 0, true)
  }
  assert.equal(names.includes('plan_map'), false)
  assert.equal(names.includes('plan_link'), false)
})

function abortExec(agentLike) {
  return {
    agent: agentLike,
    signal: AbortSignal.timeout(15_000),
  }
}

test('super_goals_map from a child shares the root board and drops a legacy approval queue', async () => {
  const { registerBoardTools } = await import(resolveMod('tools'))
  const { boardIdentityOf } = await loadSession()
  const tmp = mkdtempSync(join(tmpdir(), 'pb-map-'))
  try {
    const agents = new Map([
      ['root-1', agent('root-1', { cwd: tmp })],
      ['child-2', agent('child-2', { parent: 'root-1' })],
    ])
    const ident = boardIdentityOf(agents.get('root-1'), makeLookup(agents))
    mkdirSync(ident.boardDir, { recursive: true })
    writeFileSync(ident.boardFile, JSON.stringify({
      version: 1,
      plan: { name: 'Shared', goal: 'one board' },
      nodes: [],
      pendingApprovals: [{ id: 'ap1', reason: 'old', ops: [], by: 'agent', proposedAt: '2026-01-01T00:00:00.000Z' }],
      apSeq: 1,
      driftBlock: null,
    }, null, 2))
    const tools = collectTools()
    registerBoardTools(tools, { lookup: makeLookup(agents), opts: { blockOnDrift: true } })
    const map = tools.registered.find((t) => t.name === 'super_goals_map')
    assert.ok(map, 'super_goals_map must be registered')
    const result = await map.execute({}, abortExec(agents.get('child-2')))
    assert.equal(result.ok, true)
    assert.match(String(result.text), /Shared/)
    assert.doesNotMatch(String(result.text), /\u5f85\u6279/)
    assert.equal(result.approvals, undefined)
    assert.equal(result.pendingApproval, undefined)
    assert.equal(result.rootId, 'root-1')
    const stored = JSON.parse(readFileSync(ident.boardFile, 'utf8'))
    assert.equal(stored.pendingApprovals.length, 1)
    assert.equal(stored.apSeq, 1)
    assert.equal(existsSync(join(tmp, '.plan-board')), false)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('super_goals_edit applies structural ops immediately and does not queue approval', async () => {
  const { registerBoardTools } = await import(resolveMod('tools'))
  const { boardIdentityOf } = await loadSession()
  const tmp = mkdtempSync(join(tmpdir(), 'pb-edit-'))
  try {
    const agents = new Map([['root-1', agent('root-1', { cwd: tmp })]])
    const ident = boardIdentityOf(agents.get('root-1'), makeLookup(agents))
    mkdirSync(ident.boardDir, { recursive: true })
    writeFileSync(ident.boardFile, JSON.stringify({
      version: 1,
      plan: { name: 'Shared', goal: 'one board' },
      nodes: [],
      driftBlock: null,
    }, null, 2))
    const tools = collectTools()
    registerBoardTools(tools, { lookup: makeLookup(agents), opts: { blockOnDrift: true } })
    const edit = tools.registered.find((t) => t.name === 'super_goals_edit')
    assert.ok(edit, 'super_goals_edit must be registered')
    const result = await edit.execute({
      reason: 'seed a module without waiting for a human click',
      ops: [{ op: 'add_node', node: { id: 'mod-a', type: 'module', title: 'Alpha' } }],
    }, abortExec(agents.get('root-1')))
    assert.equal(result.ok, true)
    assert.equal(result.status, 'applied')
    const stored = JSON.parse(readFileSync(ident.boardFile, 'utf8'))
    assert.equal(stored.nodes.some((n) => n.id === 'mod-a'), true)
    assert.equal(stored.pendingApprovals, undefined)
    assert.match(edit.description, /apply at once/i)
    assert.doesNotMatch(edit.description, /REQUIRE human approval/)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
test('HTTP /state uses sessionId, not a project absolute path', async () => {
  const { mountRoutes, BoardRegistry, ROUTE_PREFIX } = await import(resolveMod('routes'))
  const { authenticatedWebRoutes } = await import(resolveMod('web-auth'))
  const tmp = mkdtempSync(join(tmpdir(), 'pb-http-'))
  const agents = new Map([['root-1', agent('root-1', { cwd: tmp })]])
  const handlers = []
  const raw = {
    register(route) {
      handlers.push(route)
      return () => {}
    },
  }
  const web = authenticatedWebRoutes(raw, () => ({ requestRejection() { return undefined } }))
  const registry = new BoardRegistry({ lookup: makeLookup(agents), opts: { blockOnDrift: true } })
  mountRoutes(web, registry)
  const route = handlers.find((r) => r.path === ROUTE_PREFIX || String(r.path).includes('dsh-super-goals'))
  assert.ok(route, 'super-goals route must be registered')

  const server = createServer((req, res) => { void route.handler(req, res) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  try {
    const missing = await fetch('http://127.0.0.1:' + port + ROUTE_PREFIX + '/state')
    assert.equal(missing.status, 400)
    const body = await missing.json()
    assert.equal(body.ok, false)
    assert.notEqual(String(body.error?.code ?? ''), 'BAD_PROJECT')

    const okEmpty = await fetch('http://127.0.0.1:' + port + ROUTE_PREFIX + '/state?sessionId=' + encodeURIComponent('root-1'))
    const json = await okEmpty.json()
    if (okEmpty.status === 404) {
      assert.equal(json.error?.code, 'PLAN_NOT_FOUND')
    } else {
      assert.equal(okEmpty.status, 200)
      assert.equal(json.ok, true)
      assert.equal(json.rootId, 'root-1')
      assert.equal(json.project, undefined)
    }

    const unix = await fetch('http://127.0.0.1:' + port + ROUTE_PREFIX + '/state?project=/tmp/demo')
    const unixJson = await unix.json()
    assert.notEqual(unix.status, 200)
    assert.notEqual(String(unixJson.error?.code ?? ''), 'BAD_PROJECT')
  } finally {
    server.close()
    await once(server, 'close')
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('host apply injects tools+agents and registers tools as an effect', async () => {
  const src = readFileSync(join(SRC, 'index.ts'), 'utf8')
  assert.match(src, /export const inject/)
  assert.match(src, /['"]agents['"]/)
  assert.match(src, /['"]tools['"]/)
  assert.match(src, /['"]webServer['"]/)
  assert.match(src, /ctx\.effect/)
  assert.doesNotMatch(src, /ctx\.inject\(\s*\[\s*['"]webServer['"]\s*,\s*['"]tools['"]/)
  const { name, inject } = await import(resolveMod('index'))
  assert.equal(name, 'dsh-super-goals')
  assert.ok(Array.isArray(inject) || typeof inject !== 'undefined')
  const list = Array.from(inject)
  assert.ok(list.includes('agents'))
  assert.ok(list.includes('tools'))
  assert.ok(list.includes('webServer'))
})

test('client panel binds the current session and has no project path input', async () => {
  const src = readFileSync(join(SRC, 'client', 'index.ts'), 'utf8')
  assert.match(src, /currentSessionId/)
  assert.match(src, /sessionId/)
  assert.match(src, /['"]sessions['"]/)
  assert.doesNotMatch(src, /planboard\.project/)
  assert.doesNotMatch(src, /项目根目录绝对路径/)
  assert.doesNotMatch(src, /localStorage\.getItem\('planboard\.project'\)/)
  assert.match(src, /\/state\?sessionId=/)
})

async function loadPanelGeometry() {
  return import(pathToFileURL(join(SRC, 'client', 'panel-geometry.ts')).href)
}

test('overlay geometry matches the AgentTeams dock/float/resize/compact shell', async () => {
  const {
    DEFAULT_PANEL_LAYOUT,
    PANEL_FLOAT_MARGIN,
    PANEL_LAYOUT_STORAGE_KEY,
    PANEL_MAX_WIDTH,
    compactPanelForBounds,
    dockPanelLayout,
    floatPanelLayout,
    movePanelLayout,
    panelMaximumHeight,
    panelUsesAutoHeight,
    parsePanelLayout,
    resizePanelLayout,
    resolvePanelGeometry,
  } = await loadPanelGeometry()
  assert.equal(PANEL_LAYOUT_STORAGE_KEY, 'dsh-super-goals:overlay-panel:v1')
  const panelBounds = { width: 1440, height: 900, anchorRight: 1440 }
  const dockedPanel = resolvePanelGeometry(DEFAULT_PANEL_LAYOUT, panelBounds)
  assert.equal(dockedPanel.mode, 'docked')
  assert.equal(dockedPanel.x, 1034)
  assert.equal(dockedPanel.y, 64)
  assert.equal(dockedPanel.width, 388)
  assert.equal(dockedPanel.height, 788)
  assert.equal(dockedPanel.heightMode, 'auto')
  assert.equal(panelUsesAutoHeight(dockedPanel, panelBounds), true)
  assert.equal(panelMaximumHeight(dockedPanel, panelBounds), 788)
  const floatingPanel = floatPanelLayout(dockedPanel, panelBounds)
  const movedPanel = movePanelLayout(floatingPanel, 999, 999, panelBounds)
  assert.equal(movedPanel.mode, 'floating')
  assert.equal(movedPanel.x, 1040)
  assert.equal(movedPanel.y, 100)
  const widerDockedPanel = resizePanelLayout(dockedPanel, 'left', -120, 0, panelBounds)
  assert.equal(widerDockedPanel.width, 508)
  assert.equal(widerDockedPanel.x, 914)
  const narrowerFloatingPanel = resizePanelLayout(floatingPanel, 'left', 200, 0, panelBounds)
  assert.equal(narrowerFloatingPanel.width, 320)
  assert.equal(narrowerFloatingPanel.x, 1102)
  const cornerPanel = resizePanelLayout({ ...floatingPanel, x: 400, y: 200, width: 388, height: 500 }, 'corner', 1200, 1200, panelBounds)
  const maxFromRight = panelBounds.width - 400 - PANEL_FLOAT_MARGIN
  const maxPanelWidth = Math.min(PANEL_MAX_WIDTH, maxFromRight)
  assert.ok(PANEL_MAX_WIDTH >= 1100, 'panel max width must grow past the old 640 cap')
  assert.ok(maxPanelWidth > 640, 'a 1440-wide shell must allow a panel wider than 640')
  assert.equal(cornerPanel.x, 400)
  assert.equal(cornerPanel.y, 200)
  assert.equal(cornerPanel.width, maxPanelWidth)
  assert.equal(cornerPanel.height, 688)
  assert.equal(cornerPanel.heightMode, 'manual')
  assert.equal(panelUsesAutoHeight(cornerPanel, panelBounds), false)
  const bottomPanel = resizePanelLayout({ ...floatingPanel, x: 400, y: 200, width: 388, height: 500 }, 'bottom', 0, 1200, panelBounds)
  assert.equal(bottomPanel.y, 200)
  assert.equal(bottomPanel.height, 688)
  assert.equal(bottomPanel.heightMode, 'manual')
  const redockedPanel = dockPanelLayout({ ...floatingPanel, width: 472, x: 120, y: 100, heightMode: 'manual' }, panelBounds)
  assert.equal(redockedPanel.x, 950)
  assert.equal(redockedPanel.width, 472)
  assert.equal(redockedPanel.heightMode, 'auto')
  const compactBounds = { width: 900, height: 700, anchorRight: 900 }
  const compactPanel = resolvePanelGeometry(floatingPanel, compactBounds)
  assert.equal(compactPanelForBounds(compactBounds), true)
  assert.equal(compactPanel.x, 12)
  assert.equal(compactPanel.y, 12)
  assert.equal(compactPanel.width, 876)
  assert.equal(compactPanel.height, 676)
  assert.equal(panelUsesAutoHeight({ ...compactPanel, heightMode: 'manual' }, compactBounds), true)
  assert.equal(panelMaximumHeight(compactPanel, compactBounds), 676)
  assert.equal(parsePanelLayout('{"mode":"floating","x":1}').mode, 'docked')
  assert.equal(parsePanelLayout('not-json').mode, 'docked')
  const migratedPanel = parsePanelLayout('{"mode":"floating","x":120,"y":80,"width":420,"height":600}')
  const manualPanel = parsePanelLayout('{"mode":"floating","x":120,"y":80,"width":420,"height":600,"heightMode":"manual"}')
  const legacyDockedManualPanel = parsePanelLayout('{"mode":"docked","x":120,"y":80,"width":420,"height":600,"heightMode":"manual"}')
  assert.equal(migratedPanel.heightMode, 'auto')
  assert.equal(panelUsesAutoHeight(migratedPanel, panelBounds), true)
  assert.equal(manualPanel.heightMode, 'manual')
  assert.equal(panelUsesAutoHeight(manualPanel, panelBounds), false)
  assert.equal(legacyDockedManualPanel.heightMode, 'auto')
})
async function loadMapGeometry() {
  return import(pathToFileURL(join(SRC, 'client', 'map-geometry.ts')).href)
}

async function loadMapView() {
  return import(pathToFileURL(join(SRC, 'client', 'map-view.ts')).href)
}

test('mind map columns fit the overlay inner width and camera stays under the cursor', async () => {
  const {
    MAP_HANDLE_REACH,
    MAP_PAD,
    MAP_VIEWPORT_INSET,
    columnMetrics,
    contentBBox,
    fitView,
    mapViewportWidth,
    nodeCardWidth,
    viewNeedsFit,
  } = await loadMapGeometry()
  const { clientToWorld, zoomViewAt } = await loadMapView()

  assert.equal(mapViewportWidth(388), 388 - MAP_VIEWPORT_INSET)
  const dockInner = mapViewportWidth(388)
  assert.equal(dockInner, 388 - MAP_VIEWPORT_INSET)
  const dockCols = columnMetrics(dockInner)
  assert.ok(dockCols.taskX + dockCols.taskW + MAP_HANDLE_REACH <= dockInner - MAP_PAD + 1e-9)
  assert.ok(dockCols.modX >= dockCols.rootX + dockCols.rootW)
  assert.ok(dockCols.taskX >= dockCols.modX + dockCols.modW)
  assert.ok(dockCols.rootX >= 0)
  assert.ok(dockCols.taskW >= 120)

  const maxInner = mapViewportWidth(640)
  const maxCols = columnMetrics(maxInner)
  assert.ok(maxCols.taskX + maxCols.taskW + MAP_HANDLE_REACH <= maxInner - MAP_PAD + 1e-9)

  const wideCols = columnMetrics(900)
  assert.equal(wideCols.rootW, 130)
  assert.equal(wideCols.modW, 170)
  assert.equal(wideCols.taskW, 260)
  assert.equal(wideCols.modX, 180)
  assert.equal(wideCols.taskX, 410)
  const longTitle = 'A very long planning title that must widen the card'
  const shortW = nodeCardWidth('Plan', 'root')
  const longW = nodeCardWidth(longTitle, 'task')
  assert.ok(longW > shortW, 'longer titles must produce a wider card')
  assert.ok(longW >= 260)
  const asciiW = nodeCardWidth('ABCDEFGH', 'task')
  const cjkW = nodeCardWidth('一二三四五六七八', 'task')
  assert.ok(cjkW > asciiW, 'CJK glyphs must be wider than the same number of ASCII letters')
  const runaway = nodeCardWidth('A'.repeat(80), 'task')
  assert.ok(runaway > 520, 'card width follows the painted label instead of a 520px cap')
  const bbox = contentBBox([
    { x: 16, y: 100, w: 130, h: 40, kind: 'root' },
    { x: 180, y: 20, w: 170, h: 36, kind: 'module' },
    { x: 410, y: 62, w: 260, h: 24, kind: 'task' },
  ])
  assert.ok(bbox.maxX >= 410 + 260 + MAP_HANDLE_REACH)
  assert.ok(bbox.minX <= 16 - 6)
  assert.ok(bbox.minY <= 20 - 6)

  const viewport = { width: dockInner, height: 300 }
  assert.equal(viewNeedsFit(bbox, viewport, MAP_PAD), true)
  const fitted = fitView(bbox, viewport, MAP_PAD)
  assert.ok(fitted.k < 1)
  assert.ok(fitted.k >= 0.35)
  const screenRight = fitted.tx + bbox.maxX * fitted.k
  const screenLeft = fitted.tx + bbox.minX * fitted.k
  assert.ok(screenRight <= dockInner - MAP_PAD + 1e-6)
  assert.ok(screenLeft >= MAP_PAD - 1e-6)

  const origin = { left: 100, top: 50 }
  const before = { k: 1, tx: 0, ty: 0 }
  const after = zoomViewAt(before, 180, 90, origin, 1.08)
  const world0 = clientToWorld(before, 180, 90, origin)
  const world1 = clientToWorld(after, 180, 90, origin)
  assert.ok(Math.abs(world0.x - world1.x) < 1e-9)
  assert.ok(Math.abs(world0.y - world1.y) < 1e-9)
})

test('status is encoded by fill versus stroke, not a left bar', async () => {
  const geo = await loadMapGeometry()
  assert.equal('statusBarPath' in geo, false)
  assert.equal('MAP_STATUS_BAR' in geo, false)
  assert.equal(typeof geo.nodeCardWidth, 'function')
  assert.equal(typeof geo.statusPaint, 'function')
  const open = geo.statusPaint('planned')
  const solid = geo.statusPaint('doing')
  const done = geo.statusPaint('done')
  assert.equal(open.fill, 'none')
  assert.ok(open.stroke)
  assert.notEqual(solid.fill, 'none')
  assert.notEqual(done.fill, 'none')
  assert.notEqual(solid.fill, done.fill)
  const client = readFileSync(join(SRC, 'client', 'index.ts'), 'utf8')
  assert.doesNotMatch(client, /statusBarPath/)
  assert.doesNotMatch(client, /MAP_STATUS_BAR/)
  assert.match(client, /statusPaint/)
  assert.match(client, /nodeCardWidth/)
  assert.match(client, /MAP_NODE_RX/)
  assert.match(client, /MAP_ROOT_RX/)
  assert.doesNotMatch(client, /width: 4, height: it\.h, rx: 2/)
})

test('panel has no delete confirm and no delayed save', () => {
  const client = readFileSync(join(SRC, 'client', 'index.ts'), 'utf8')
  assert.doesNotMatch(client, /window\.confirm/)
  assert.doesNotMatch(client, /data-confirm/)
  assert.doesNotMatch(client, /pb-confirm/)
  assert.doesNotMatch(client, /pendingRemove/)
  assert.doesNotMatch(client, /\u786e\u8ba4\u5220\u9664/)
  assert.doesNotMatch(client, /saving \? '[^']+' : '\u786e\u8ba4\u751f\u6548'/)
  assert.doesNotMatch(client, /\u4fdd\u5b58\u66f4\u6539/)
  assert.doesNotMatch(client, /\u4efb\u52a1\u601d\u7ef4\u5bfc\u56fe/)
})

test('mind map keeps overflow clip, map flex, and pointer-cancel wiring', () => {
  const client = readFileSync(join(SRC, 'client', 'index.ts'), 'utf8')
  assert.match(client, /columnMetrics/)
  assert.match(client, /fitView/)
  assert.match(client, /zoomViewAt/)
  assert.match(client, /onPointerCancel/)
  assert.match(client, /onLostPointerCapture/)
  assert.match(client, /clipPath/)
  assert.match(client, /flex:1 1 auto/)
  assert.match(client, /\.pb-map\{[^}]*overflow:hidden/)
  assert.match(client, /\.pb-map\{[^}]*height:100%/)
  assert.match(client, /width:\s*['"]100%['"][\s\S]{0,80}height:\s*['"]100%['"]/)
  assert.doesNotMatch(client, /key:\s*b\.version/)
  assert.match(client, /const mLabel = \(mOrd != null \? '#' \+ mOrd \+ ' ' : ''\) \+ m\.title/)
  assert.match(client, /nodeCardWidth\(mLabel, 'module'\)/)
  assert.doesNotMatch(client, /height: autoHeight \? 'auto' : geometry\.height/)
  assert.match(client, /height: geometry\.height/)
})

test('client overlay uses the AgentTeams shell chrome instead of a full-height dock', async () => {
  const src = [
    readFileSync(join(SRC, 'client', 'index.ts'), 'utf8'),
    existsSync(join(SRC, 'client', 'panel-geometry.ts')) ? readFileSync(join(SRC, 'client', 'panel-geometry.ts'), 'utf8') : '',
  ].join('\n')
  assert.match(src, /data-super-goals-activity/)
  assert.match(src, /data-super-goals-panel-open/)
  assert.match(src, /--super-goals-panel-shift/)
  assert.match(src, /data-resize-edge/)
  assert.match(src, /floatPanelLayout/)
  assert.match(src, /dockPanelLayout/)
  assert.match(src, /data-super-goals-collapsed/)
  assert.match(src, /isolateOverlay/)
  assert.match(src, /onWheel: isolateOverlay/)
  assert.match(src, /event\.stopPropagation\(\)/)
  assert.doesNotMatch(src, /position:fixed;top:0;right:0;bottom:0/)
  assert.doesNotMatch(src, /width:min\(560px,46vw\)/)
})

test('plugin identity is dsh-super-goals, not dsh-plan-board', async () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.name, '@dsh-external/dsh-super-goals')
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id:\s*dsh-super-goals/)
  assert.match(patch, /name:\s*'@dsh-external\/dsh-super-goals'/)
  assert.doesNotMatch(patch, /dsh-plan-board/)
  const tsdown = readFileSync(join(ROOT, 'tsdown.config.ts'), 'utf8')
  assert.match(tsdown, /PLUGIN_ID = "@dsh-external\/dsh-super-goals"/)
  const { name } = await import(resolveMod('index'))
  const { ROUTE_PREFIX } = await import(resolveMod('routes'))
  assert.equal(name, 'dsh-super-goals')
  assert.equal(ROUTE_PREFIX, '/_dsh/dsh-super-goals')
  const client = readFileSync(join(SRC, 'client', 'index.ts'), 'utf8')
  assert.match(client, /const NS = 'dsh-super-goals'/)
  assert.match(client, /const API = '\/_dsh\/dsh-super-goals'/)
  assert.match(client, /SuperGoals/)
  assert.doesNotMatch(client, /PlanBoard/)
  assert.doesNotMatch(client, /dsh-plan-board/)
  assert.doesNotMatch(client, /planboard:/)
  const indexSrc = readFileSync(join(SRC, 'index.ts'), 'utf8')
  assert.match(indexSrc, /export const name = 'dsh-super-goals'/)
  assert.doesNotMatch(indexSrc, /export const name = 'dsh-plan-board'/)
})
