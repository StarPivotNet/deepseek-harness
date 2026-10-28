/**
 * dsh-super-goals client：AgentTeams 同款 shell.overlay 浮动面板；无导航栏入口。
 * 两必坑（骨架实测）：apply 用 ctx.slots 必须 export const inject；register 必带 name。
 * 面板绑定当前会话（sessions.list → currentSessionId），不收项目路径。
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, MutableRefObject, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import {
  DEFAULT_PANEL_LAYOUT,
  PANEL_LAYOUT_STORAGE_KEY,
  compactPanelForBounds,
  dockPanelLayout,
  floatPanelLayout,
  movePanelLayout,
  panelMaximumHeight,
  panelUsesAutoHeight,
  parsePanelLayout,
  resizePanelLayout,
  resolvePanelGeometry,
  type PanelBounds,
  type PanelLayout,
  type PanelResizeEdge,
} from './panel-geometry.ts'
import {
  clientToOverlay,
  clientToWorld,
  nodeDragPosition,
  nodeMovedEnough,
  overlayDragPosition,
  panView,
  wheelZoomFactor,
  zoomViewAt,
  type MapView,
} from './map-view.ts'
import {
MAP_PAD,
  MAP_NODE_RX,
  MAP_ROOT_RX,
  columnMetrics,
  contentBBox,
  displayPaint,
  fitView,
  mapViewportWidth,
  nodeCardWidth,
  originPaint,
  statusPaint,
  statusLabel,
  viewNeedsFit,
} from './map-geometry.ts'
type PEv = { clientX: number; clientY: number; pointerId: number; button?: number; currentTarget: Element; target: Element; stopPropagation(): void; preventDefault(): void }

const NS = 'dsh-super-goals'
const API = '/_dsh/dsh-super-goals'
const POLL_MS = 4000
const PANEL_OPEN_ATTRIBUTE = 'data-super-goals-panel-open'
const PANEL_SHIFT_PROPERTY = '--super-goals-panel-shift'
const PANEL_CONVERSATION_GAP = 14
const MOVE_THRESHOLD = 4

type PanelGesture = {
  readonly kind: 'move' | 'resize'
  readonly edge?: PanelResizeEdge
  readonly pointerId: number
  readonly originX: number
  readonly originY: number
  readonly start: PanelLayout
  activated: boolean
}

function initialPanelLayout(): PanelLayout {
  if (typeof window === 'undefined') return DEFAULT_PANEL_LAYOUT
  return parsePanelLayout(window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY))
}

function initialPanelBounds(): PanelBounds {
  if (typeof window === 'undefined') return { width: 1440, height: 900, anchorRight: 1440 }
  return { width: window.innerWidth, height: window.innerHeight, anchorRight: window.innerWidth }
}

function IconPanelLeft(): ReturnType<typeof h> {
  return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('rect', { key: 'r', x: 2, y: 2.5, width: 12, height: 11, rx: 2 }),
    h('path', { key: 'p', d: 'M6 2.5v11' }))
}

function IconChevronDown(): ReturnType<typeof h> {
  return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('path', { d: 'm3 5 4 4 4-4' }))
}
type SessionsSnapshot = {
  readonly current?: string
  readonly byId: Readonly<Record<string, { readonly id: string; readonly retainedBy?: Readonly<Record<string, number>> }>>
}
type SessionsList = {
  subscribe(cb: () => void): () => void
  getSnapshot(): SessionsSnapshot
}
const EMPTY_SESSIONS: SessionsList = {
  subscribe: () => () => {},
  getSnapshot: () => ({ byId: {} }),
}
export function currentSessionId(state: SessionsSnapshot): string | undefined {
  if ('current' in state) return state.current
  return Object.values(state.byId).find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id
}
function useCurrentSessionId(sessions?: SessionsList): string | undefined {
  const list = sessions ?? EMPTY_SESSIONS
  const snap = useSyncExternalStore(list.subscribe, list.getSnapshot)
  return currentSessionId(snap)
}
interface BoardNode {
  id: string; type: 'module' | 'task'; parent: string | null; title: string
  status: string; deps: string[]; priority?: number
  acceptance?: string[]; scope?: string[]; evidence?: string[]; note?: string
  completion?: 'required' | 'optional'
  pos?: { x: number; y: number } | null
}
interface NodeDraft {
  fields?: { title?: string; note?: string; acceptance?: string[]; scope?: string[]; priority?: number; deps?: string[] }
  pos?: { x: number; y: number }
}
interface BoardData {
  board: {
    version: number; digest?: string
    plan: { name: string; goal: string }
    nodes: BoardNode[]
    driftBlock: { taskId: string; reason: string; at: string } | null
  }
  order: Record<string, number>
  station: string | null
  events: { ts: string; seq: number; kind: string; actor: string; payload?: { taskId?: string; tool?: string; path?: string; note?: string } }[]
}

let openState = false
function togglePanel(): void {
  openState = !openState
  window.dispatchEvent(new CustomEvent('super-goals:toggle'))
}

/** 主题跟随：采样 app body 实际背景亮度；异常时退回系统偏好。 */
function appDark(): boolean {
  try {
    const bg = getComputedStyle(document.body).backgroundColor
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg)
    if (m != null) {
      const lum = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255
      return lum < 0.5
    }
  } catch { /* 采样失败走系统偏好 */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

const CSS = [
  'html{--super-goals-panel-shift:420px}',
  "html[data-super-goals-panel-open] [data-phase='active']{box-sizing:border-box;padding-right:var(--super-goals-panel-shift)}",
  '@media (max-width:960px){html[data-super-goals-panel-open] [data-phase=\'active\']{padding-right:0}}',
  '.pb-badge{position:absolute;top:106px;right:18px;display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px;box-sizing:border-box;',
  'border:1px solid var(--dsw-alias-border-l2,rgba(148,163,184,.45));border-radius:999px;',
  'background:color-mix(in srgb,var(--dsw-alias-bg-module-platform,#0f172a) 92%,transparent);backdrop-filter:blur(16px);',
  'box-shadow:0 8px 28px color-mix(in srgb,var(--dsw-alias-bg-mask-3,#020617) 29%,transparent);',
  'color:var(--dsw-alias-label-secondary,#94a3b8);font:inherit;font-size:12px;font-weight:600;line-height:20px;cursor:pointer;',
  'transition:border-color 150ms ease,transform 120ms ease;z-index:60}',
  '.pb-badge:hover{border-color:var(--dsw-alias-border-l3,rgba(148,163,184,.7));transform:translateY(-1px)}',
  '.pb-badge:active{transform:translateY(0) scale(.98)}',
  '.pb-badge:focus-visible,.pb-icon:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#8b5cf6);outline-offset:2px}',
  '.pb-badge-dot,.pb-panel-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#94a3b8)}',
  '.pb-badge-dot[data-busy=true],.pb-panel-dot[data-busy=true]{background:var(--dsw-alias-state-business-primary,#8b5cf6);animation:pb-pulse 1.25s ease-in-out infinite}',
  '.pb-badge-count{font-variant-numeric:tabular-nums}',
  '@media (max-width:640px){.pb-badge{top:98px;right:10px}}',
  '.pb-panel{--pb-bg:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#f8fafc) 95%,transparent);--pb-ink:var(--dsw-alias-label-primary,#0f172a);',
  '--pb-line:color-mix(in srgb,var(--dsw-alias-border-l3,#e2e8f0) 58%,transparent);--pb-card:var(--dsw-alias-bg-module-platform,#ffffff);--pb-muted:var(--dsw-alias-label-tertiary,#64748b);',
  'position:absolute;top:0;left:0;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;',
  'border:1px solid var(--pb-line);border-radius:16px;background:var(--pb-bg);color:var(--pb-ink);',
  'backdrop-filter:blur(20px) saturate(1.08);box-shadow:0 12px 32px color-mix(in srgb,var(--dsw-alias-bg-mask-3,#020617) 25%,transparent),0 32px 72px color-mix(in srgb,var(--dsw-alias-bg-mask-3,#020617) 33%,transparent);',
  'animation:pb-panel-in 160ms ease-out;will-change:transform;z-index:60}',
  '.pb-panel[data-dragging],.pb-panel[data-resizing]{user-select:none;box-shadow:0 16px 38px color-mix(in srgb,var(--dsw-alias-bg-mask-3,#020617) 29%,transparent),0 36px 78px color-mix(in srgb,var(--dsw-alias-bg-mask-3,#020617) 33%,transparent)}',
  '@keyframes pb-panel-in{from{opacity:0}to{opacity:1}}',
  '.pb-panel[data-mode="dark"]{--pb-bg:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#0f141c) 95%,transparent);--pb-ink:var(--dsw-alias-label-primary,#e2e8f0);--pb-line:color-mix(in srgb,var(--dsw-alias-border-l3,#1e293b) 58%,transparent);--pb-card:var(--dsw-alias-bg-module-platform,#151b26);--pb-muted:var(--dsw-alias-label-tertiary,#7c8798)}',
  '.pb-head{display:flex;flex:none;align-items:center;justify-content:space-between;min-height:44px;padding:0 14px 0 16px;border-bottom:1px solid var(--dsw-alias-border-l2,var(--pb-line));cursor:grab;touch-action:none}',
  '.pb-head:active,.pb-panel[data-dragging] .pb-head{cursor:grabbing}',
  '.pb-panel[data-compact] .pb-head{cursor:default;touch-action:auto}',
  '.pb-title{display:inline-flex;align-items:center;gap:8px;color:var(--pb-ink);font-size:14px;font-weight:600;line-height:20px}',
  '.pb-controls{display:inline-flex;flex:none;align-items:center;gap:2px}',
  '.pb-icon{display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;padding:0;border:0;border-radius:7px;background:transparent;color:var(--pb-muted);cursor:pointer;transition:background-color 120ms ease,color 120ms ease,transform 120ms ease}',
  '.pb-icon:hover{background:var(--dsw-alias-button-ghost-active-fill,rgba(148,163,184,.16));color:var(--pb-ink)}',
  '.pb-icon:active{transform:scale(.94)}',
  '.pb-icon[data-control=dock][data-mode=docked] svg{transform:scaleX(-1)}',
  '.pb-resize{position:absolute;z-index:5;touch-action:none;pointer-events:auto}',
  '.pb-resize[data-resize-edge=left]{top:44px;bottom:14px;left:0;width:14px;cursor:ew-resize}',
  '.pb-resize[data-resize-edge=left]::after{position:absolute;top:50%;left:4px;width:3px;height:48px;border-radius:999px;background:color-mix(in srgb,var(--pb-muted) 42%,transparent);content:\'\';opacity:.45;transform:translateY(-50%);transition:background-color 120ms ease,opacity 120ms ease}',
  '.pb-resize[data-resize-edge=bottom]{right:20px;bottom:0;left:20px;height:14px;cursor:ns-resize}',
  '.pb-resize[data-resize-edge=bottom]::after{position:absolute;bottom:4px;left:50%;width:48px;height:3px;border-radius:999px;background:color-mix(in srgb,var(--pb-muted) 42%,transparent);content:\'\';opacity:.45;transform:translateX(-50%);transition:background-color 120ms ease,opacity 120ms ease}',
  '.pb-resize[data-resize-edge=corner]{right:0;bottom:0;width:28px;height:28px;cursor:nwse-resize}',
  '.pb-resize[data-resize-edge=corner]::after{position:absolute;right:6px;bottom:6px;width:10px;height:10px;border-right:2px solid var(--pb-muted);border-bottom:2px solid var(--pb-muted);content:\'\';opacity:.58;transition:border-color 120ms ease,opacity 120ms ease}',
  '.pb-resize:hover::after,.pb-panel[data-resizing] .pb-resize::after{background-color:var(--dsw-alias-state-business-primary,#8b5cf6);border-color:var(--dsw-alias-state-business-primary,#8b5cf6);opacity:.95}',
  '.pb-input{flex:1;min-width:0;font:12px/1.4 ui-monospace,monospace;padding:5px 8px;border-radius:8px;',
  'border:1px solid var(--pb-line);background:var(--pb-card);color:var(--pb-ink)}',
  '.pb-btn{cursor:pointer;padding:5px 12px;border-radius:8px;font-size:12px;font-weight:600;',
  'border:1px solid var(--pb-line);background:var(--pb-card);color:var(--pb-ink)}',
  '.pb-btn:hover{filter:brightness(1.08)}',
  '.pb-btn.pb-ok{background:#10b981;border-color:#10b981;color:#fff}',
  '.pb-btn.pb-no{background:#ef4444;border-color:#ef4444;color:#fff}',
  '.pb-btn.pb-vio{background:#8b5cf6;border-color:#8b5cf6;color:#fff}',
  '.pb-btn:disabled{opacity:.5;cursor:not-allowed}',
  '.pb-body{flex:1;min-height:0;overflow:hidden;padding:0;display:flex;flex-direction:column;gap:8px}',
  '.pb-banner{margin:8px 10px 0;padding:8px 12px;border-radius:10px;font-size:12px;font-weight:600;display:flex;gap:8px;align-items:center}',
  '.pb-banner.pb-drift{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.5);color:#ef4444}',
  '.pb-banner.pb-hold{background:rgba(100,116,139,.10);border:1px dashed rgba(100,116,139,.55);color:#64748b}',
  '[data-mode="dark"] .pb-banner.pb-hold{color:#94a3b8}',
  '.pb-banner.pb-dirty{background:rgba(245,158,11,.14);border:1px solid rgba(245,158,11,.6);color:#b45309;position:sticky;top:0;z-index:5}',
  '[data-mode="dark"] .pb-banner.pb-dirty{color:#fbbf24}',
  '.pb-card{background:var(--pb-card);border:1px solid var(--pb-line);border-radius:10px;padding:8px 10px;font-size:12px}',
  '.pb-sec{font-size:11px;font-weight:700;letter-spacing:1px;color:var(--pb-muted);text-transform:uppercase}',
  '.pb-station{animation:pb-pulse 1.6s ease-in-out infinite}',
  '@keyframes pb-pulse{0%,100%{opacity:.35}50%{opacity:1}}',
  '.pb-map{position:relative;flex:1 1 auto;min-height:0;height:100%;background:var(--pb-card);border:0;border-radius:0;overflow:hidden;cursor:grab;touch-action:none}',
  '.pb-map text{font-family:ui-sans-serif,system-ui,sans-serif;fill:var(--pb-ink,#0f172a)}',
  '.pb-node{cursor:grab}',
  '.pb-node.pb-dragging{cursor:grabbing}',
  '.pb-handle{cursor:crosshair}',
  '.pb-node-menu{position:absolute;z-index:80;min-width:148px;padding:4px;border:1px solid var(--pb-line);border-radius:10px;background:var(--pb-card);box-shadow:0 10px 28px color-mix(in srgb,var(--dsw-alias-bg-mask-3,#020617) 28%,transparent)}',
  '.pb-node-menu button{display:block;width:100%;margin:0;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:var(--pb-ink);font:inherit;font-size:12px;text-align:left;cursor:pointer}',
  '.pb-node-menu button:hover{background:var(--dsw-alias-button-ghost-active-fill,rgba(148,163,184,.16))}',
  '.pb-edit-panel{position:absolute;z-index:81;width:268px;max-height:min(420px,calc(100% - 24px));overflow:auto;padding:10px 12px;border:1px solid var(--pb-line);border-radius:12px;background:var(--pb-bg);box-shadow:0 12px 32px color-mix(in srgb,var(--dsw-alias-bg-mask-3,#020617) 28%,transparent);display:flex;flex-direction:column;gap:8px}',
  '.pb-edit-head{display:flex;align-items:center;justify-content:space-between;cursor:grab;touch-action:none;user-select:none}',
  '.pb-edit-head:active{cursor:grabbing}',
  '.pb-edit-panel textarea{min-height:64px;resize:vertical;font:12px/1.4 ui-sans-serif,system-ui,sans-serif;padding:5px 8px;border-radius:8px;border:1px solid var(--pb-line);background:var(--pb-card);color:var(--pb-ink)}',
  '.pb-hint{font-size:11px;color:var(--pb-muted);line-height:1.6}',
].join('\n')

function ensureStyles(): void {
  if (document.getElementById('super-goals-css') != null) return
  const el = document.createElement('style')
  el.id = 'super-goals-css'
  el.textContent = CSS
  document.head.appendChild(el)
}

async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return await r.json() as Record<string, unknown>
}


/** 客户端环检测（保存前快失败；服务端 lint 仍兜底）。 */
function hasCycle(nodes: { id: string; deps: string[] }[]): boolean {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const color = new Map<string, number>()
  const dfs = (id: string): boolean => {
    const c = color.get(id)
    if (c === 1) return true
    if (c === 2) return false
    color.set(id, 1)
    for (const d of byId.get(id)?.deps ?? []) {
      if (byId.has(d) && dfs(d)) return true
    }
    color.set(id, 2)
    return false
  }
  for (const n of nodes) { if (dfs(n.id)) return true }
  return false
}
function moduleSettled(nodes: BoardNode[], m: BoardNode): boolean {
  if (m.type !== 'module') return false
  if (m.status === 'done') return true
  if (m.completion === 'optional') return false
  const kids = nodes.filter(n => n.type === 'task' && n.parent === m.id)
  return kids.length > 0 && kids.every(k => k.status === 'done' || k.status === 'canceled')
}
function newNodeId(prefix: string, used: Set<string>): string {
  for (;;) {
    const id = prefix + '-' + Math.random().toString(36).slice(2, 8)
    if (!used.has(id)) return id
  }
}

interface LayoutItem { node: BoardNode; x: number; y: number; w: number; h: number }
interface Layout { items: LayoutItem[]; totalH: number }
interface MapProps {
  data: BoardData
  effNodes: BoardNode[]
  layout: Layout
  view: MapView
  setView: (f: (v: MapView) => MapView) => void
  dragRef: MutableRefObject<{ kind: 'node'; id: string; sx: number; sy: number; bx: number; by: number; moved: boolean } | { kind: 'dep'; from: string } | null>
  depLine: { x1: number; y1: number; x2: number; y2: number } | null
  setDepLine: (v: { x1: number; y1: number; x2: number; y2: number } | null) => void
  onNodePointerDown: (e: PEv, id: string, base: { x: number; y: number }) => void
  onNodeMove: (id: string, pos: { x: number; y: number }) => void
  onNodeDragEnd: (id: string, pos: { x: number; y: number }) => void
  onNodeClick: (id: string) => void
  onNodeContextMenu: (id: string, at: { x: number; y: number }) => void
  menu: { id: string; x: number; y: number } | null
  onMenuEdit: (id: string) => void
  onMenuAddChild: (id: string, completion?: 'required' | 'optional') => void
  onMenuDelete: (id: string) => void
  onDismissMenu: () => void
  editingId: string | null
  editPos: { x: number; y: number } | null
  onCloseEditor: () => void
  onEditorPointerDown: (e: PEv) => void
  editForm: { title: string; note: string; acceptance: string; scope: string; priority: string; goal: string; completion: string }
  onEditForm: (patch: Partial<{ title: string; note: string; acceptance: string; scope: string; priority: string; goal: string; completion: string }>) => void
  onSaveEdit: () => void
  onDepDrop: (from: string, at: { clientX: number; clientY: number }) => void
  onHandlePointerDown: (e: PEv, id: string) => void
  svgRef: RefObject<SVGSVGElement | null>
  mapWidth: number
}

const ROW = 30
const MOD_H = 42

function MindMap(props: MapProps): ReturnType<typeof h> {
  const { data, effNodes, layout, view, setView, dragRef, depLine, setDepLine, onNodePointerDown, onNodeMove, onNodeDragEnd, onNodeClick, onNodeContextMenu, menu, onMenuEdit, onMenuAddChild, onMenuDelete, onDismissMenu, editingId, editPos, onCloseEditor, onEditorPointerDown, editForm, onEditForm, onSaveEdit, onDepDrop, onHandlePointerDown, svgRef, mapWidth } = props
  const drag = useRef<{ pointerId: number; x: number; y: number; tx: number; ty: number } | null>(null)
  const viewRef = useRef(view)
  const pendingViewRef = useRef<MapView | null>(null)
  const frameRef = useRef<number | null>(null)
  const pendingNodeRef = useRef<{ id: string; x: number; y: number } | null>(null)
  const pendingDepRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  viewRef.current = view
  const mods = useMemo(() => effNodes.filter(n => n.type === 'module'), [effNodes])
  const posOf = (id: string): LayoutItem | undefined => layout.items.find(i => i.node.id === id)
  const mapRef = useRef<HTMLDivElement | null>(null)
  const overlayOrigin = (): { left: number; top: number } => {
    const rect = mapRef.current?.getBoundingClientRect()
    return { left: rect?.left ?? 0, top: rect?.top ?? 0 }
  }
  const mapOrigin = (): { left: number; top: number } => {
    const rect = svgRef.current?.getBoundingClientRect()
    return { left: rect?.left ?? 0, top: rect?.top ?? 0 }
  }
  const toSvg = (clientX: number, clientY: number): { x: number; y: number } => {
    return clientToWorld(viewRef.current, clientX, clientY, mapOrigin())
  }
  const edge = (a: LayoutItem, bx: number, by: number): string => {
    const x1 = a.x + a.w
    const y1 = a.y + a.h / 2
    const mx = (x1 + bx) / 2
    return 'M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + by + ', ' + bx + ' ' + by
  }
  const depEdge = (a: LayoutItem, bp: LayoutItem): string => {
    const x1 = a.x - 6
    const y1 = a.y + a.h / 2
    const x2 = bp.x - 6
    const y2 = bp.y + bp.h / 2
    const mx = Math.min(x1, x2) - 46
    return 'M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2
  }
  const flushFrame = (): void => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const nextView = pendingViewRef.current
    pendingViewRef.current = null
    if (nextView !== null) setView(() => nextView)
    const node = pendingNodeRef.current
    pendingNodeRef.current = null
    if (node !== null) onNodeMove(node.id, node)
    const dep = pendingDepRef.current
    pendingDepRef.current = null
    if (dep !== null) setDepLine(dep)
  }
  const schedule = (): void => {
    frameRef.current ??= requestAnimationFrame(() => {
      frameRef.current = null
      flushFrame()
    })
  }
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])
  // 原生非 passive 监听器：React 合成 onWheel 走根节点 passive 注册，preventDefault 无效且报错（M2-3 验收 P2 修复）
  useEffect(() => {
    const el = mapRef.current
    if (el == null) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const origin = mapOrigin()
      setView(v => zoomViewAt(v, e.clientX, e.clientY, origin, wheelZoomFactor(e.deltaY)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setView])
  const fittedRef = useRef('')
  useLayoutEffect(() => {
    const width = Math.max(1, mapWidth)
    const height = Math.max(mapRef.current?.clientHeight ?? 0, 1)
    const bbox = contentBBox(layout.items.map(it => ({
      x: it.x,
      y: it.y,
      w: it.w,
      h: it.h,
      kind: it.node.id === '__root__' ? 'root' : it.node.type,
    })))
    const viewport = { width, height }
    const key = String(width) + 'x' + String(height)
    if (fittedRef.current === key) return
    if (layout.items.length <= 1) return
    fittedRef.current = key
    if (!viewNeedsFit(bbox, viewport, MAP_PAD)) return
    setView(() => fitView(bbox, viewport, MAP_PAD))
  }, [layout, mapWidth, setView])
  const endPointer = (e: PEv, cancelled: boolean): void => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
    flushFrame()
    const d = dragRef.current
    dragRef.current = null
    setDepLine(null)
    const el = mapRef.current
    if (el != null && el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (cancelled) return
    if (d != null && d.kind === 'node') {
      if (!d.moved) { onNodeClick(d.id); return }
      const p = toSvg(e.clientX, e.clientY)
      onNodeDragEnd(d.id, nodeDragPosition(d, p))
      return
    }
    if (d != null && d.kind === 'dep') { onDepDrop(d.from, { clientX: e.clientX, clientY: e.clientY }) }
  }
  return h('div', {
    className: 'pb-map',
    ref: mapRef,
    onPointerDown: (e: PEv) => {
      if (e.button != null && e.button !== 0) return
      onDismissMenu()
      e.preventDefault()
      mapRef.current?.setPointerCapture?.(e.pointerId)
      if (dragRef.current != null) return
      drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty }
    },
    onPointerMove: (e: PEv) => {
      const d = dragRef.current
      if (d != null && d.kind === 'node') {
        const p = toSvg(e.clientX, e.clientY)
        if (nodeMovedEnough(d, p, viewRef.current.k)) d.moved = true
        pendingNodeRef.current = { id: d.id, ...nodeDragPosition(d, p) }
        schedule()
        return
      }
      if (d != null && d.kind === 'dep') {
        const p = toSvg(e.clientX, e.clientY)
        const f = posOf(d.from)
        if (f != null) {
          pendingDepRef.current = { x1: f.x + f.w, y1: f.y + f.h / 2, x2: p.x, y2: p.y }
          schedule()
        }
        return
      }
      if (drag.current == null || drag.current.pointerId !== e.pointerId) return
      pendingViewRef.current = panView(
        { k: viewRef.current.k, tx: drag.current.tx, ty: drag.current.ty },
        e.clientX - drag.current.x,
        e.clientY - drag.current.y,
      )
      schedule()
    },
    onPointerUp: (e: PEv) => { endPointer(e, false) },
    onPointerCancel: (e: PEv) => { endPointer(e, true) },
    onLostPointerCapture: (e: PEv) => { endPointer(e, true) },
    onContextMenu: (e: PEv) => { e.preventDefault() },
  },
    h('svg', { width: '100%', height: '100%', ref: svgRef },
      h('defs', null,
        layout.items.map((it, ii) => h('clipPath', { key: 'c' + ii, id: 'pb-clip-' + ii },
          h('rect', { x: it.x, y: it.y, width: it.w, height: it.h, rx: it.node.id === '__root__' ? MAP_ROOT_RX : MAP_NODE_RX })))),
      h('g', { transform: 'translate(' + view.tx + ',' + view.ty + ') scale(' + view.k + ')' },
        effNodes.filter(n => n.type === 'module' && n.parent == null).map((m, i) => {
          const rp = posOf('__root__')
          const mp = posOf(m.id)
          if (rp == null || mp == null) return null
          return h('path', { key: 'e' + i, d: edge(rp, mp.x, mp.y + mp.h / 2), stroke: 'var(--pb-line,#cbd5e1)', strokeWidth: 1.6, fill: 'none' })
        }),
        mods.map((m, mi) => {
          const mp = posOf(m.id)
          if (mp == null) return null
          return h('g', { key: 'mg' + mi },
            effNodes.filter(t => t.type === 'task' && t.parent === m.id).map((t, ti) => {
              const tp = posOf(t.id)
              if (tp == null) return null
              return h('path', { key: 'te' + mi + '_' + ti, d: edge(mp, tp.x, tp.y + tp.h / 2), stroke: 'var(--pb-line,#cbd5e1)', strokeWidth: 1.2, fill: 'none' })
            }))
        }),
        effNodes.flatMap((t, di) => (t.deps ?? []).map((d, dj) => {
          const a = posOf(t.id)
          const bp = posOf(d)
          if (a == null || bp == null) return null
          return h('path', { key: 'dep' + di + '_' + dj, d: depEdge(bp, a), stroke: '#8b5cf6', strokeWidth: 1.3, strokeDasharray: '5 4', fill: 'none', opacity: .8 })
        })),
        depLine != null ? h('line', { x1: depLine.x1, y1: depLine.y1, x2: depLine.x2, y2: depLine.y2, stroke: '#8b5cf6', strokeWidth: 2, strokeDasharray: '4 3', opacity: .9 }) : null,
        layout.items.map((it, ii) => {
          const isRoot = it.node.id === '__root__'
          const optional = it.node.type === 'module' && it.node.completion === 'optional'
          const settled = it.node.type === 'module' && moduleSettled(effNodes, it.node)
          const paint = isRoot ? originPaint() : (it.node.type === 'module' ? displayPaint({ origin: false, status: it.node.status, optional, settled }) : statusPaint(it.node.status))
          const ord = data.order[it.node.id]
          const isStation = it.node.id === data.station
          const rx = isRoot ? MAP_ROOT_RX : MAP_NODE_RX
          const label = isRoot ? it.node.title : ((ord != null ? '#' + ord + ' ' : '') + it.node.title)
          const fill = paint.fill === 'none' ? 'var(--pb-bg)' : paint.fill
          if (isRoot) {
            return h('g', {
              key: 'n' + ii,
              className: 'pb-node',
              'data-id': it.node.id,
              onPointerDown: (e: PEv) => {
                if (e.button != null && e.button !== 0) return
                e.stopPropagation()
              },
              onContextMenu: (e: PEv) => {
                e.preventDefault()
                e.stopPropagation()
                onNodeContextMenu(it.node.id, clientToOverlay(e.clientX, e.clientY, overlayOrigin()))
              },
            },
              h('title', null, '始根 · ' + it.node.title),
              h('rect', { x: it.x, y: it.y, width: it.w, height: it.h, rx, fill, stroke: paint.stroke, strokeWidth: 2 }),
              h('text', { x: it.x + 12, y: it.y + it.h / 2 + 4, fontSize: 13, fontWeight: 600, fill: paint.text, clipPath: 'url(#pb-clip-' + ii + ')' }, label))
          }
          return h('g', {
            key: 'n' + it.node.id,
            className: 'pb-node',
            'data-id': it.node.id,
            onPointerDown: (e: PEv) => {
              if (e.button != null && e.button !== 0) return
              e.stopPropagation()
              e.preventDefault()
              mapRef.current?.setPointerCapture?.(e.pointerId)
              onNodePointerDown(e, it.node.id, { x: it.x, y: it.y })
            },
            onContextMenu: (e: PEv) => {
              e.preventDefault()
              e.stopPropagation()
              onNodeContextMenu(it.node.id, clientToOverlay(e.clientX, e.clientY, overlayOrigin()))
            },
          },
            h('title', null, (it.node.type === 'module' ? (optional ? '可不完根' : '必完根') + ' · ' : '') + statusLabel(settled && !optional ? 'done' : it.node.status) + (ord != null ? ' · #' + ord : '') + ' · ' + it.node.title),
            isStation ? h('rect', { className: 'pb-station', x: it.x - 4, y: it.y - 4, width: it.w + 8, height: it.h + 8, rx: 12, fill: 'none', stroke: '#f59e0b', strokeWidth: 2 }) : null,
            h('rect', { x: it.x, y: it.y, width: it.w, height: it.h, rx, fill, stroke: paint.stroke, strokeWidth: 1.5 }),
            h('text', { x: it.x + 12, y: it.y + it.h / 2 + 4, fontSize: 12, fontWeight: 600, fill: paint.text, clipPath: 'url(#pb-clip-' + ii + ')' }, label),
            it.node.type === 'task' ? h('circle', {
              className: 'pb-handle', cx: it.x + it.w + 6, cy: it.y + it.h / 2, r: 5, fill: '#8b5cf6', opacity: .85,
              title: '拖到目标任务 = 目标依赖此任务；再拖一次 = 移除依赖',
              onPointerDown: (e: PEv) => {
                e.stopPropagation()
                e.preventDefault()
                mapRef.current?.setPointerCapture?.(e.pointerId)
                onHandlePointerDown(e, it.node.id)
              },
            }) : null)
        })),
      ),
      menu != null ? h('div', {
        className: 'pb-node-menu',
        style: { left: menu.x, top: menu.y },
        onPointerDown: (e: PEv) => { e.stopPropagation() },
        onPointerMove: (e: PEv) => { e.stopPropagation() },
        onContextMenu: (e: PEv) => { e.preventDefault(); e.stopPropagation() },
      },
        h('button', { type: 'button', key: 'edit', onClick: () => onMenuEdit(menu.id) }, '编辑'),
        menu.id === '__root__'
          ? h('button', { type: 'button', key: 'add-req', onClick: () => onMenuAddChild(menu.id, 'required') }, '添加必完根')
          : h('button', { type: 'button', key: 'add', onClick: () => onMenuAddChild(menu.id) }, '添加子分支'),
        menu.id === '__root__'
          ? h('button', { type: 'button', key: 'add-opt', onClick: () => onMenuAddChild(menu.id, 'optional') }, '添加可不完根')
          : null,
        menu.id !== '__root__' ? h('button', { type: 'button', key: 'del', onClick: () => onMenuDelete(menu.id) }, '删除') : null) : null,
      editingId != null && editPos != null ? h('div', {
        className: 'pb-edit-panel',
        style: { left: editPos.x, top: editPos.y },
        onPointerDown: (e: PEv) => { e.stopPropagation() },
        onPointerMove: (e: PEv) => { e.stopPropagation() },
        onContextMenu: (e: PEv) => { e.preventDefault(); e.stopPropagation() },
      },
        h('div', { className: 'pb-edit-head', onPointerDown: onEditorPointerDown },
          h('div', { className: 'pb-sec' }, '编辑')),
        h('input', {
          className: 'pb-input',
          value: editForm.title,
          placeholder: '标题',
          onChange: (e: { target: { value: string } }) => onEditForm({ title: e.target.value }),
        }),
        editingId === '__root__'
          ? h('textarea', {
            value: editForm.goal,
            placeholder: '目标',
            onChange: (e: { target: { value: string } }) => onEditForm({ goal: e.target.value }),
          })
          : h('textarea', {
            value: editForm.note,
            placeholder: '备注',
            onChange: (e: { target: { value: string } }) => onEditForm({ note: e.target.value }),
          }),
        editingId !== '__root__' ? h('textarea', {
          value: editForm.acceptance,
          placeholder: '验收（每行一条）',
          onChange: (e: { target: { value: string } }) => onEditForm({ acceptance: e.target.value }),
        }) : null,
        editingId !== '__root__' ? h('textarea', {
          value: editForm.scope,
          placeholder: '范围（每行一条）',
          onChange: (e: { target: { value: string } }) => onEditForm({ scope: e.target.value }),
        }) : null,
        editingId !== '__root__' ? h('input', {
          className: 'pb-input',
          value: editForm.priority,
          placeholder: '优先级',
          onChange: (e: { target: { value: string } }) => onEditForm({ priority: e.target.value }),
        }) : null,
        editingId !== '__root__' && effNodes.find(x => x.id === editingId)?.type === 'module' ? h('select', {
          className: 'pb-input',
          value: editForm.completion,
          onChange: (e: { target: { value: string } }) => onEditForm({ completion: e.target.value }),
        },
          h('option', { value: 'required' }, '必完根'),
          h('option', { value: 'optional' }, '可不完根')) : null,
        h('div', { style: { display: 'flex', gap: 8 } },
          h('button', { type: 'button', className: 'pb-btn pb-ok', onClick: onSaveEdit }, '保存'),
          h('button', { type: 'button', className: 'pb-btn', onClick: onCloseEditor }, '关闭'))) : null)
}

function PaneWindow({ sessions }: { sessions?: SessionsList } = {}): ReturnType<typeof h> {
  const sessionId = useCurrentSessionId(sessions)
  const [open, setOpen] = useState(openState)
  const [data, setData] = useState<BoardData | null>(null)
  const [err, setErr] = useState('')
  const [nonce, setNonce] = useState(0)
  const [mode, setMode] = useState(appDark() ? 'dark' : 'light')
  const [drafts, setDrafts] = useState<Record<string, NodeDraft>>({})
  const [saveMsg, setSaveMsg] = useState('')
  const [depLine, setDepLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 })
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPos, setEditPos] = useState<{ x: number; y: number } | null>(null)
  const [editForm, setEditForm] = useState({ title: '', note: '', acceptance: '', scope: '', priority: '3', goal: '', completion: 'required' })
  const prevSessionRef = useRef<string | undefined>(undefined)
  const dragRef = useRef<{ kind: 'node'; id: string; sx: number; sy: number; bx: number; by: number; moved: boolean } | { kind: 'dep'; from: string } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const editorDragRef = useRef<{ pointerId: number; sx: number; sy: number; bx: number; by: number } | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const [layoutState, setLayoutState] = useState<PanelLayout>(initialPanelLayout)
  const [bounds, setBounds] = useState<PanelBounds>(initialPanelBounds)
  const [interaction, setInteraction] = useState<'dragging' | 'resizing' | null>(null)
  const boundsRef = useRef(bounds)
  const gestureRef = useRef<PanelGesture | null>(null)
  const frameRef = useRef<number | null>(null)
  const pendingLayoutRef = useRef<PanelLayout | null>(null)
  const geometry = useMemo(() => resolvePanelGeometry(layoutState, bounds), [layoutState, bounds])
  const compact = compactPanelForBounds(bounds)
  const commitLayout = useCallback((next: PanelLayout): void => { setLayoutState(next) }, [])
  useEffect(() => {
    window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layoutState))
  }, [layoutState])
  useLayoutEffect(() => {
    const overlay = document.querySelector<HTMLElement>('[data-shell-overlay]')
    if (overlay === null) return
    const conversation = document.querySelector<HTMLElement>("[data-phase='active']")
    let frame: number | null = null
    const measure = (): void => {
      frame = null
      const overlayRect = overlay.getBoundingClientRect()
      const conversationRect = conversation?.getBoundingClientRect()
      const next: PanelBounds = {
        width: overlayRect.width,
        height: overlayRect.height,
        anchorRight: conversationRect === undefined
          ? overlayRect.width
          : Math.min(Math.max(conversationRect.right - overlayRect.left, 0), overlayRect.width),
      }
      const previous = boundsRef.current
      if (previous.width === next.width && previous.height === next.height && previous.anchorRight === next.anchorRight) return
      boundsRef.current = next
      setBounds(next)
    }
    const scheduleMeasure = (): void => { frame ??= requestAnimationFrame(measure) }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
    observer?.observe(overlay)
    if (conversation !== null) observer?.observe(conversation)
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [sessionId])
  useLayoutEffect(() => {
    const root = document.documentElement
    const shouldYield = open && geometry.mode === 'docked' && !compact
    if (shouldYield) {
      root.setAttribute(PANEL_OPEN_ATTRIBUTE, '')
      root.style.setProperty(PANEL_SHIFT_PROPERTY, `${geometry.width + PANEL_CONVERSATION_GAP + 18}px`)
    } else {
      root.removeAttribute(PANEL_OPEN_ATTRIBUTE)
      root.style.removeProperty(PANEL_SHIFT_PROPERTY)
    }
    return () => {
      root.removeAttribute(PANEL_OPEN_ATTRIBUTE)
      root.style.removeProperty(PANEL_SHIFT_PROPERTY)
    }
  }, [compact, open, geometry.mode, geometry.width])
  const panelGeometryForGesture = useCallback((): PanelLayout => {
    const measuredHeight = panelRef.current?.getBoundingClientRect().height
    if (measuredHeight === undefined || measuredHeight <= 0) return geometry
    return { ...geometry, height: measuredHeight }
  }, [geometry])
  const flushScheduledLayout = useCallback((): void => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const pending = pendingLayoutRef.current
    pendingLayoutRef.current = null
    if (pending !== null) commitLayout(pending)
  }, [commitLayout])
  const scheduleLayout = useCallback((next: PanelLayout): void => {
    pendingLayoutRef.current = next
    frameRef.current ??= requestAnimationFrame(() => {
      frameRef.current = null
      const pending = pendingLayoutRef.current
      pendingLayoutRef.current = null
      if (pending !== null) commitLayout(pending)
    })
  }, [commitLayout])
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])
  const beginMove = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation()
    if (compact || event.button !== 0 || (event.target as Element).closest('button') !== null) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = {
      kind: 'move',
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      start: panelGeometryForGesture(),
      activated: false,
    }
  }, [compact, panelGeometryForGesture])
  const beginResize = useCallback((edge: PanelResizeEdge, event: ReactPointerEvent<HTMLDivElement>): void => {
    if (compact || event.button !== 0 || (geometry.mode === 'docked' && edge !== 'left')) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestureRef.current = {
      kind: 'resize',
      edge,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      start: panelGeometryForGesture(),
      activated: true,
    }
    setInteraction('resizing')
  }, [compact, geometry.mode, panelGeometryForGesture])
  const updateGesture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation()
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId
      || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const dx = event.clientX - gesture.originX
    const dy = event.clientY - gesture.originY
    const activeBounds = boundsRef.current
    if (gesture.kind === 'move') {
      if (!gesture.activated && Math.hypot(dx, dy) < MOVE_THRESHOLD) return
      if (!gesture.activated) {
        gesture.activated = true
        setInteraction('dragging')
      }
      scheduleLayout(movePanelLayout(
        floatPanelLayout(gesture.start, activeBounds),
        dx,
        dy,
        activeBounds,
      ))
      return
    }
    setInteraction('resizing')
    scheduleLayout(resizePanelLayout(
      gesture.start,
      gesture.edge,
      dx,
      dy,
      activeBounds,
    ))
  }, [scheduleLayout])
  const endGesture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation()
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    updateGesture(event)
    flushScheduledLayout()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    gestureRef.current = null
    setInteraction(null)
  }, [flushScheduledLayout, updateGesture])
  const cancelGesture = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation()
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) return
    flushScheduledLayout()
    gestureRef.current = null
    setInteraction(null)
  }, [flushScheduledLayout])
  const toggleDock = useCallback((): void => {
    const liveGeometry = panelGeometryForGesture()
    commitLayout(liveGeometry.mode === 'docked'
      ? floatPanelLayout(liveGeometry, boundsRef.current)
      : dockPanelLayout(liveGeometry, boundsRef.current))
  }, [commitLayout, panelGeometryForGesture])
  const autoHeight = panelUsesAutoHeight(geometry, bounds)
  const panelStyle: CSSProperties = {
    width: geometry.width,
    height: geometry.height,
    maxHeight: panelMaximumHeight(geometry, bounds),
    transform: `translate3d(${geometry.x}px, ${geometry.y}px, 0)`,
  }
  ensureStyles()
  useEffect(() => {
    const f = (): void => { setOpen(openState) }
    window.addEventListener('super-goals:toggle', f)
    return () => window.removeEventListener('super-goals:toggle', f)
  }, [])
  useEffect(() => {
    const prev = prevSessionRef.current
    prevSessionRef.current = sessionId
    if (prev === undefined || prev === sessionId) return
    openState = false
    setOpen(false)
    setData(null)
    setErr('')
    setDrafts({})
    setSaveMsg('')
    setMenu(null)
    setEditingId(null)
    setEditPos(null)
    setNonce(n => n + 1)
  }, [sessionId])
  useEffect(() => {
    const t = setInterval(() => { const d = appDark(); setMode(prev => (prev === (d ? 'dark' : 'light') ? prev : (d ? 'dark' : 'light'))) }, 2000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!open || sessionId == null || sessionId === '') return
    const ctrl = new AbortController()
    let stop = false
    const run = async (): Promise<void> => {
      try {
        const r = await fetch(API + '/stream?sessionId=' + encodeURIComponent(sessionId), { signal: ctrl.signal })
        const reader = r.body?.getReader()
        if (reader == null) return
        const dec = new TextDecoder()
        let buf = ''
        while (!stop) {
          const chunk = await reader.read()
          if (chunk.done) break
          buf += dec.decode(chunk.value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (line.trim() === '') continue
            try { const msg = JSON.parse(line) as { kind?: string }; if (msg.kind === 'event') setNonce(n => n + 1) } catch { /* 跳过坏行 */ }
          }
        }
      } catch { /* abort 或连接失败 */ }
      if (!stop) setTimeout(() => { void run() }, 3000)
    };
    void run()
    return () => { stop = true; ctrl.abort() }
  }, [open, sessionId])
  useEffect(() => {
    if (sessionId == null || sessionId === '') {
      setData(null)
      setErr('')
      return
    }
    let stop = false
    const tick = async (): Promise<void> => {
      try {
        const r = await fetch(API + '/state?sessionId=' + encodeURIComponent(sessionId))
        const j = await r.json() as Record<string, unknown>
        if (stop) return
        if (j.ok === true && (j as { board?: unknown }).board != null) {
          setData(j as unknown as BoardData)
          setErr('')
        } else {
          setData(null)
          setErr('')
        }
      } catch {
        if (!stop) {
          setData(null)
          setErr('')
        }
      }
    }
    void tick()
    const t = setInterval(tick, POLL_MS)
    return () => { stop = true; clearInterval(t) }
  }, [open, sessionId, nonce])
  ensureStyles()
  const b = data?.board
  const effNodes: BoardNode[] = useMemo(() => {
    if (data == null) return []
    return data.board.nodes.map(n => {
      const d = drafts[n.id]
      if (d == null) return n
      return { ...n, ...((d.fields ?? {}) as Partial<BoardNode>), pos: d.pos !== undefined ? d.pos : (n.pos ?? null) }
    })
  }, [data, drafts]);
  const mapWidth = mapViewportWidth(geometry.width)
  const cols = useMemo(() => columnMetrics(mapWidth), [mapWidth])
  const layout = useMemo<Layout>(() => {
    let y = 20
    const items: LayoutItem[] = []
    const floating: LayoutItem[] = []
    const mods = effNodes.filter(n => n.type === 'module')
    for (const m of mods) {
      const tasks = effNodes.filter(t => t.type === 'task' && t.parent === m.id)
      const blockH = MOD_H + tasks.length * ROW + 8
      const mx = m.pos != null ? m.pos.x : cols.modX
      const my = m.pos != null ? m.pos.y : y
      const mOrd = data?.order[m.id]
      const mLabel = (mOrd != null ? '#' + mOrd + ' ' : '') + m.title
      const mw = nodeCardWidth(mLabel, 'module')
      const mi: LayoutItem = { node: m, x: mx, y: my, w: mw, h: MOD_H - 6 }
      if (m.pos != null) floating.push(mi); else items.push(mi)
      let ty = my + MOD_H
      for (const t of tasks) {
        const ord = data?.order[t.id]
        const label = (ord != null ? '#' + ord + ' ' : '') + t.title
        const tw = nodeCardWidth(label, 'task')
        const ti: LayoutItem = { node: t, x: t.pos != null ? t.pos.x : cols.taskX, y: t.pos != null ? t.pos.y : ty, w: tw, h: ROW - 6 }
        if (t.pos != null) floating.push(ti); else items.push(ti)
        ty += ROW
      }
      y = (m.pos != null ? my + blockH : y + blockH) + 18
    }
    const totalH = Math.max(y + 20, 260)
    items.push(...floating)
    const rootTitle = b?.plan.name ?? 'Plan'
    items.push({ node: { id: '__root__', type: 'module', parent: null, title: rootTitle, status: 'planned', deps: [] }, x: cols.rootX, y: totalH / 2 - 20, w: nodeCardWidth(rootTitle, 'root'), h: 40 })
    return { items, totalH }
  }, [effNodes, b, cols, data]);
  if (data == null) return null
  if (!open) {
    if (data == null) return null
    const busy = (b?.nodes ?? []).some(n => n.status === 'doing') || b?.driftBlock != null
    const count = (b?.nodes ?? []).filter(n => n.status === 'doing' || n.status === 'blocked').length
    return h('button', {
      type: 'button',
      className: 'pb-badge',
      'data-super-goals-collapsed': true,
      'data-busy': busy || undefined,
      onClick: togglePanel,
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => { event.stopPropagation() },
      onWheel: (event: { stopPropagation(): void }) => { event.stopPropagation() },
      'aria-label': 'SuperGoals 规划面板',
      title: 'SuperGoals 规划面板',
    },
      h('span', { className: 'pb-badge-dot', 'data-busy': busy || undefined, 'aria-hidden': true }),
      h('span', { className: 'pb-badge-count' }, count > 0 ? String(count) : 'SuperGoals'))
  }
  const persistField = async (id: string, fields: Record<string, unknown>, note: string): Promise<boolean> => {
    if (sessionId == null || sessionId === '') return false
    try {
      const j = await post('/edit', { sessionId, ops: [{ op: 'update_node', id, fields }], note })
      if (j.ok === true) {
        setNonce(n => n + 1)
        return true
      }
      setSaveMsg('⛔ ' + String((j.error as { message?: string })?.message ?? '写入失败'))
    } catch (e) {
      setSaveMsg('⛔ ' + String(e))
    }
    return false
  }
  const persistOps = async (ops: Record<string, unknown>[], note: string): Promise<boolean> => {
    if (sessionId == null || sessionId === '') return false
    try {
      const j = await post('/edit', { sessionId, ops, note })
      if (j.ok === true) {
        setNonce(n => n + 1)
        return true
      }
      setSaveMsg('⛔ ' + String((j.error as { message?: string })?.message ?? '写入失败'))
    } catch (e) {
      setSaveMsg('⛔ ' + String(e))
    }
    return false
  }
  const toSvg = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect()
    return clientToWorld(view, clientX, clientY, { left: rect?.left ?? 0, top: rect?.top ?? 0 })
  }
  const setDraft = (id: string, patch: NodeDraft): void => {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch, fields: { ...(prev[id]?.fields ?? {}), ...(patch.fields ?? {}) } } }))
  }
  const onNodePointerDown = (e: PEv, id: string, base: { x: number; y: number }): void => {
    if (id === '__root__') return
    if (e.button != null && e.button !== 0) return
    setMenu(null)
    const p = toSvg(e.clientX, e.clientY)
    dragRef.current = { kind: 'node', id, sx: p.x, sy: p.y, bx: base.x, by: base.y, moved: false }
  }
  const persistPos = async (id: string, pos: { x: number; y: number }): Promise<void> => {
    const rounded = { x: Math.round(pos.x), y: Math.round(pos.y) }
    setDraft(id, { pos: rounded })
    if (sessionId == null || sessionId === '') return
    try {
      const j = await post('/edit', {
        sessionId,
        ops: [{ op: 'update_node', id, fields: { pos: rounded } }],
        note: 'panel:drag-pos',
      })
      if (j.ok === true) {
        setData(prev => {
          if (prev == null) return prev
          return {
            ...prev,
            board: {
              ...prev.board,
              nodes: prev.board.nodes.map(n => n.id === id ? { ...n, pos: rounded } : n),
            },
          }
        })
        setDrafts(prev => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setNonce(n => n + 1)
      } else {
        setSaveMsg('⛔ ' + String((j.error as { message?: string })?.message ?? '位置保存失败'))
      }
    } catch (e) {
      setSaveMsg('⛔ ' + String(e))
    }
  }
  const onNodeMove = (id: string, pos: { x: number; y: number }): void => {
    setDraft(id, { pos: { x: Math.round(pos.x), y: Math.round(pos.y) } })
  }
  const onNodeDragEnd = (id: string, pos: { x: number; y: number }): void => {
    void persistPos(id, pos)
  }
  const onNodeClick = (_id: string): void => { setSaveMsg(''); setMenu(null) }
  const onDismissMenu = (): void => { setMenu(null) }
  const onNodeContextMenu = (id: string, at: { x: number; y: number }): void => {
    setMenu({ id, x: at.x, y: at.y })
    setSaveMsg('')
  }
  const onCloseEditor = (): void => { setEditingId(null); setEditPos(null); editorDragRef.current = null }
  const onEditorPointerDown = (e: PEv): void => {
    if (e.button != null && e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const pos = editPos
    if (pos == null) return
    const pointerId = e.pointerId
    const sx = e.clientX
    const sy = e.clientY
    editorDragRef.current = { pointerId, sx, sy, bx: pos.x, by: pos.y }
    e.currentTarget.setPointerCapture?.(pointerId)
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      setEditPos(overlayDragPosition({ x: pos.x, y: pos.y }, { x: ev.clientX - sx, y: ev.clientY - sy }))
    }
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      editorDragRef.current = null
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
  }
  const onEditForm = (patch: Partial<{ title: string; note: string; acceptance: string; scope: string; priority: string; goal: string; completion: string }>): void => {
    setEditForm(prev => ({ ...prev, ...patch }))
  }
  const fillEditForm = (id: string): void => {
    if (id === '__root__') {
      setEditForm({ title: b?.plan.name ?? '', note: '', acceptance: '', scope: '', priority: '3', goal: b?.plan.goal ?? '', completion: 'required' })
      return
    }
    const n = effNodes.find(x => x.id === id)
    setEditForm({
      title: n?.title ?? '',
      note: n?.note ?? '',
      acceptance: (n?.acceptance ?? []).join('\n'),
      scope: (n?.scope ?? []).join('\n'),
      priority: String(n?.priority ?? 3),
      goal: '',
      completion: n?.type === 'module' && n.completion === 'optional' ? 'optional' : 'required',
    })
  }
  const onMenuEdit = (id: string): void => {
    setEditingId(id)
    setEditPos({ x: Math.max(8, (menu?.x ?? 12) + 8), y: Math.max(8, menu?.y ?? 12) })
    fillEditForm(id)
    setMenu(null)
  }
  const onMenuAddChild = (id: string, completion?: 'required' | 'optional'): void => {
    setMenu(null)
    const used = new Set(effNodes.map(n => n.id))
    if (id === '__root__') {
      const nid = newNodeId('mod', used)
      if (completion === 'optional') {
        void persistOps([{ op: 'add_node', node: { id: nid, type: 'module', title: '可不完根', parent: null, completion: 'optional' } }], 'panel:add-child')
      } else {
        void persistOps([{ op: 'add_node', node: { id: nid, type: 'module', title: '必完根', parent: null, completion: 'required' } }], 'panel:add-child')
      }
      return
    }
    const n = effNodes.find(x => x.id === id)
    if (n == null) return
    const parent = n.type === 'module' ? n.id : n.parent
    if (parent == null) { setSaveMsg('⛔ 任务缺少父模块'); return }
    const nid = newNodeId('task', used)
    void persistOps([{ op: 'add_node', node: { id: nid, type: 'task', title: '新任务', parent } }], 'panel:add-child')
  }
  const onMenuDelete = (id: string): void => {
    setMenu(null)
    if (id === '__root__') return
    const ids: string[] = []
    const walk = (cur: string): void => {
      for (const child of effNodes.filter(n => n.parent === cur)) walk(child.id)
      ids.push(cur)
    }
    walk(id)
    if (editingId != null && ids.includes(editingId)) { setEditingId(null); setEditPos(null) }
    void persistOps(ids.map(nid => ({ op: 'remove_node', id: nid })), 'panel:remove')
  }
  const onSaveEdit = (): void => {
    if (editingId == null) return
    if (editingId === '__root__') {
      const name = editForm.title.trim()
      if (name === '') { setSaveMsg('⛔ 标题不能为空'); return }
      void persistOps([{ op: 'init_board', name, goal: editForm.goal }], 'panel:edit-root').then(ok => { if (ok) onCloseEditor() })
      return
    }
    const title = editForm.title.trim()
    if (title === '') { setSaveMsg('⛔ 标题不能为空'); return }
    const pri = Number(editForm.priority)
    const fields: Record<string, unknown> = {
      title,
      note: editForm.note,
      acceptance: editForm.acceptance.split('\n').map(s => s.trim()).filter(Boolean),
      scope: editForm.scope.split('\n').map(s => s.trim()).filter(Boolean),
    }
    if (Number.isFinite(pri) && pri > 0) fields.priority = pri
    const editing = effNodes.find(x => x.id === editingId)
    if (editing?.type === 'module') fields.completion = editForm.completion === 'optional' ? 'optional' : 'required'
    void persistField(editingId, fields, 'panel:edit').then(ok => { if (ok) onCloseEditor() })
  }
  const onHandlePointerDown = (e: PEv, id: string): void => {
    if (e.button != null && e.button !== 0) return
    setMenu(null)
    dragRef.current = { kind: 'dep', from: id }
  }
  const onDepDrop = (from: string, at: { clientX: number; clientY: number }): void => {
    const el = document.elementFromPoint(at.clientX, at.clientY)
    const gEl = el != null ? el.closest('.pb-node') : null
    const hitId = gEl != null ? gEl.getAttribute('data-id') : null
    if (hitId == null || hitId === from || hitId === '__root__') return
    const tid = hitId
    const cur = effNodes.find(n => n.id === tid)
    if (cur == null || cur.type !== 'task') return
    const deps = [...(cur.deps ?? [])]
    const idx = deps.indexOf(from)
    if (idx >= 0) deps.splice(idx, 1); else deps.push(from)
    const sim = effNodes.map(n => (n.id === tid ? { ...n, deps } : { ...n, deps: [...(n.deps ?? [])] }))
    if (hasCycle(sim.filter(n => n.type === 'task'))) { setSaveMsg('⛔ 该依赖会成环，已拒绝（' + tid + ' ⇠ ' + from + '）'); return }
    setDraft(tid, { fields: { deps } })
    void persistField(tid, { deps }, 'panel:dep').then(ok => {
      if (ok) {
        setDrafts(prev => {
          const next = { ...prev }
          delete next[tid]
          return next
        })
        setSaveMsg('')
        return
      }
      setDrafts(prev => {
        const next = { ...prev }
        delete next[tid]
        return next
      })
    })
  }
  const busy = (b?.nodes ?? []).some(n => n.status === 'doing') || b?.driftBlock != null
  const resizeHandle = (edge: PanelResizeEdge): ReturnType<typeof h> => h('div', {
    key: 'resize-' + edge,
    className: 'pb-resize',
    'data-resize-edge': edge,
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => { beginResize(edge, event) },
    onPointerMove: updateGesture,
    onPointerUp: endGesture,
    onPointerCancel: cancelGesture,
    'aria-hidden': true,
  })
  const isolateOverlay = (event: { stopPropagation(): void }): void => { event.stopPropagation() }
  return h('aside', {
    ref: panelRef,
    className: 'pb-panel',
    style: panelStyle,
    'data-super-goals-activity': true,
    'data-panel-mode': geometry.mode,
    'data-height-mode': autoHeight ? 'auto' : 'manual',
    'data-compact': compact || undefined,
    'data-dragging': interaction === 'dragging' || undefined,
    'data-resizing': interaction === 'resizing' || undefined,
    'data-mode': mode,
    'aria-label': 'SuperGoals 规划面板',
    onPointerDown: isolateOverlay,
    onPointerMove: isolateOverlay,
    onWheel: isolateOverlay,
  },
    h('header', {
      className: 'pb-head',
      onPointerDown: beginMove,
      onPointerMove: updateGesture,
      onPointerUp: endGesture,
      onPointerCancel: cancelGesture,
      'data-drag-handle': !compact || undefined,
    },
      h('span', { className: 'pb-title' },
        'SuperGoals',
        h('span', { className: 'pb-panel-dot', 'data-busy': busy || undefined, 'aria-hidden': true })),
      h('span', { className: 'pb-hint', style: { flex: 1, minWidth: 0 } }),
      h('span', { className: 'pb-controls' },
        !compact ? h('button', {
          type: 'button',
          className: 'pb-icon',
          'data-control': 'dock',
          'data-mode': geometry.mode,
          onClick: toggleDock,
          'aria-label': geometry.mode === 'docked' ? '切换为浮动面板' : '停靠到右侧',
          title: geometry.mode === 'docked' ? '切换为浮动面板' : '停靠到右侧',
        }, IconPanelLeft()) : null,
        h('button', {
          type: 'button',
          className: 'pb-icon',
          'data-control': 'collapse',
          onClick: togglePanel,
          'aria-label': '收起规划面板',
          title: '收起规划面板',
        }, IconChevronDown()),
      ),
    ),
    err !== '' ? h('div', { className: 'pb-banner pb-drift' }, '⚠ ' + err) : null,
    h('div', { className: 'pb-body' },
      saveMsg !== '' ? h('div', { className: 'pb-banner pb-drift' }, saveMsg) : null,
      b.driftBlock != null ? h('div', { className: 'pb-banner pb-drift' },
        '⛔ 漂移阻断: ' + b.driftBlock.reason,
        h('button', {
          className: 'pb-btn pb-ok', style: { marginLeft: 'auto' },
          onClick: () => { void post('/unblock', { sessionId }).then(() => setNonce(n => n + 1)) },
        }, '解除阻断')) : null,
      h(MindMap, { data: data as BoardData, effNodes, layout, view, setView, dragRef, depLine, setDepLine, onNodePointerDown, onNodeMove, onNodeDragEnd, onNodeClick, onNodeContextMenu, menu, onMenuEdit, onMenuAddChild, onMenuDelete, onDismissMenu, editingId, editPos, onCloseEditor, onEditorPointerDown, editForm, onEditForm, onSaveEdit, onDepDrop, onHandlePointerDown, svgRef, mapWidth } as never),
    ),
    !compact ? resizeHandle('left') : null,
    !compact && geometry.mode === 'floating' ? resizeHandle('bottom') : null,
    !compact && geometry.mode === 'floating' ? resizeHandle('corner') : null,
  )
}

type SlotsCtx = {
  slots: {
    inject(slot: string, register: () => unknown): void
    register(meta: Record<string, unknown>, component?: unknown): unknown
  }
  sessions?: { list: SessionsList }
  effect(fn: () => unknown, label?: string): void
}

export const inject = ['slots', 'sessions']

export function apply(ctx: SlotsCtx): void {
  const sessions = ctx.sessions?.list
  const Overlay = (): ReturnType<typeof h> => h(PaneWindow, { sessions })
  ctx.effect(() => {
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: NS + ':pane', order: 85 }, Overlay as unknown as (props: never) => unknown))
  }, NS + ':ui')
}