/** Pure layout math so the mind-map tree fits the overlay canvas. */

import { MAP_MAX_SCALE, MAP_MIN_SCALE, type MapView } from './map-view.ts'

/** Map now fills the overlay body; keep a 0 inset so columns use the full width. */
export const MAP_VIEWPORT_INSET = 0
export const MAP_PAD = 12
export const MAP_HANDLE_REACH = 11
export const MAP_DEP_LEFT = 52
export const MAP_HALO = 6
export const MAP_NODE_RX = 9
export const MAP_ROOT_RX = 12
export const MAP_CHAR_W = 7.4
export const MAP_CJK_W = 13
export const MAP_LABEL_PAD = 24
export const MAP_ROOT_W = 130
export const MAP_MOD_W = 170
export const MAP_TASK_W = 260
export const MAP_MIN_ROOT_W = 88
export const MAP_MIN_MOD_W = 96
export const MAP_MIN_TASK_W = 120
export const MAP_ROOT_X = 16
export const MAP_MOD_X = 180
export const MAP_TASK_X = 410
export const MAP_GAP = 18

const STATUS_STROKE: Record<string, string> = {
  planned: '#94a3b8',
  ready: '#3b82f6',
  doing: '#f59e0b',
  blocked: '#ef4444',
  done: '#10b981',
  canceled: '#6b7280',
}
const HOLLOW_STATUS = new Set(['planned', 'ready'])
const STATUS_LABEL: Record<string, string> = {
  planned: '计划中',
  ready: '就绪',
  doing: '进行中',
  blocked: '已阻断',
  done: '已完成',
  canceled: '已取消',
}
export interface StatusPaint {
  readonly fill: string
  readonly stroke: string
  readonly text: string
}

export interface ColumnMetrics {
  readonly rootX: number
  readonly rootW: number
  readonly modX: number
  readonly modW: number
  readonly taskX: number
  readonly taskW: number
}

export interface ContentBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly kind?: 'root' | 'module' | 'task'
}

export interface ContentBBox {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export interface MapViewport {
  readonly width: number
  readonly height: number
}

export function mapViewportWidth(panelWidth: number): number {
  return Math.max(0, panelWidth - MAP_VIEWPORT_INSET)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

/** Card width tracks the painted label, counting CJK as wider than ASCII. */
function labelAdvance(label: string): number {
  let width = 0
  for (const ch of label) {
    const code = ch.codePointAt(0) ?? 0
    width += code > 0x2e7f ? MAP_CJK_W : MAP_CHAR_W
  }
  return width
}

export function nodeCardWidth(label: string, kind: 'root' | 'module' | 'task'): number {
  const min = kind === 'root' ? MAP_MIN_ROOT_W : kind === 'module' ? MAP_MIN_MOD_W : MAP_MIN_TASK_W
  const extra = kind === 'task' ? 8 : 0
  return Math.max(min, Math.ceil(labelAdvance(String(label)) + MAP_LABEL_PAD + extra))
}

/** Chinese status word for hover text; color still comes from statusPaint. */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

/** Hollow stroke for queued work; solid fill for active / terminal statuses. */
export function statusPaint(status: string): StatusPaint {
  const stroke = STATUS_STROKE[status] ?? '#94a3b8'
  if (HOLLOW_STATUS.has(status)) return { fill: 'none', stroke, text: 'var(--pb-ink,#0f172a)' }
  return { fill: stroke, stroke, text: '#fff' }
}

/** Origin (始根) is always a solid card, independent of planned/ready hollow rules. */
export function originPaint(): StatusPaint {
  return { fill: '#4f46e5', stroke: '#4f46e5', text: '#fff' }
}

export interface DisplayPaintOpts {
  readonly origin: boolean
  readonly status: string
  readonly optional: boolean
  readonly settled: boolean
}

/** Required settled roots paint as done; optional roots keep their own status; origin stays solid. */
export function displayPaint(opts: DisplayPaintOpts): StatusPaint {
  if (opts.origin) return originPaint()
  if (opts.settled && !opts.optional) return statusPaint('done')
  return statusPaint(opts.status)
}

/** Pack the three columns so the task handle stays inside the canvas at k=1. */
export function columnMetrics(mapWidth: number): ColumnMetrics {
  const inner = Math.max(0, mapWidth - MAP_PAD)
  if (MAP_TASK_X + MAP_TASK_W + MAP_HANDLE_REACH <= inner) {
    return {
      rootX: MAP_ROOT_X,
      rootW: MAP_ROOT_W,
      modX: MAP_MOD_X,
      modW: MAP_MOD_W,
      taskX: MAP_TASK_X,
      taskW: MAP_TASK_W,
    }
  }
  const rootX = Math.min(MAP_ROOT_X, Math.max(4, inner))
  const avail = Math.max(0, inner - rootX - MAP_HANDLE_REACH)
  const minW = MAP_MIN_ROOT_W + MAP_MIN_MOD_W + MAP_MIN_TASK_W
  const minGap = 8
  let gap = minGap
  if (avail > minW + minGap * 2) {
    gap = Math.min(MAP_GAP, Math.floor((avail - minW) / 2))
  }
  const widthBudget = Math.max(minW, avail - gap * 2)
  let extra = widthBudget - minW
  const take = (want: number): number => {
    const n = Math.min(want, extra)
    extra -= n
    return n
  }
  const taskW = MAP_MIN_TASK_W + take(MAP_TASK_W - MAP_MIN_TASK_W)
  const modW = MAP_MIN_MOD_W + take(MAP_MOD_W - MAP_MIN_MOD_W)
  const rootW = MAP_MIN_ROOT_W + take(MAP_ROOT_W - MAP_MIN_ROOT_W)
  const modX = rootX + rootW + gap
  const taskX = modX + modW + gap
  return { rootX, rootW, modX, modW, taskX, taskW }
}

export function contentBBox(items: readonly ContentBox[]): ContentBBox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of items) {
    const left = item.x - (item.kind === 'task' || item.kind === 'module' ? MAP_HALO : 0)
    const top = item.y - MAP_HALO
    const right = item.x + item.w + (item.kind === 'task' ? MAP_HANDLE_REACH : MAP_HALO)
    const bottom = item.y + item.h + MAP_HALO
    minX = Math.min(minX, left, item.x - 6)
    minY = Math.min(minY, top)
    maxX = Math.max(maxX, right)
    maxY = Math.max(maxY, bottom)
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  minX = Math.min(minX, MAP_ROOT_X - MAP_DEP_LEFT)
  return { minX, minY, maxX, maxY }
}

export function viewNeedsFit(bbox: ContentBBox, viewport: MapViewport, padding: number): boolean {
  const spanX = bbox.maxX - bbox.minX
  const spanY = bbox.maxY - bbox.minY
  const innerW = Math.max(1, viewport.width - padding * 2)
  const innerH = Math.max(1, viewport.height - padding * 2)
  if (spanX > innerW || spanY > innerH) return true
  if (bbox.minX < padding || bbox.minY < padding) return true
  if (bbox.maxX > viewport.width - padding || bbox.maxY > viewport.height - padding) return true
  return false
}

export function fitView(bbox: ContentBBox, viewport: MapViewport, padding: number): MapView {
  const spanX = Math.max(1, bbox.maxX - bbox.minX)
  const spanY = Math.max(1, bbox.maxY - bbox.minY)
  const innerW = Math.max(1, viewport.width - padding * 2)
  const innerH = Math.max(1, viewport.height - padding * 2)
  const k = clamp(Math.min(innerW / spanX, innerH / spanY, 1), MAP_MIN_SCALE, MAP_MAX_SCALE)
  const contentW = spanX * k
  const contentH = spanY * k
  const tx = padding + (innerW - contentW) / 2 - bbox.minX * k
  const ty = padding + (innerH - contentH) / 2 - bbox.minY * k
  return { k, tx, ty }
}
