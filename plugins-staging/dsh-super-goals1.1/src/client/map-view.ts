/** Pure camera math for the mind-map: screen ↔ world, pan, cursor-anchored zoom. */

export const MAP_MIN_SCALE = 0.35
export const MAP_MAX_SCALE = 2.2
export const MAP_NODE_MOVE_PX = 3

export interface MapView {
  readonly k: number
  readonly tx: number
  readonly ty: number
}

export interface MapPoint {
  readonly x: number
  readonly y: number
}

export interface MapOrigin {
  readonly left: number
  readonly top: number
}

/** Viewport clientXY → overlay-local coords. Panel transform makes position:fixed use this frame. */
export function clientToOverlay(clientX: number, clientY: number, origin: MapOrigin): MapPoint {
  return { x: clientX - origin.left, y: clientY - origin.top }
}

export function overlayDragPosition(start: MapPoint, delta: MapPoint): MapPoint {
  return { x: start.x + delta.x, y: start.y + delta.y }
}
export function clampScale(k: number): number {
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, k))
}

export function wheelZoomFactor(deltaY: number): number {
  return deltaY > 0 ? 0.92 : 1.08
}

export function clientToWorld(view: MapView, clientX: number, clientY: number, origin: MapOrigin): MapPoint {
  return {
    x: (clientX - origin.left - view.tx) / view.k,
    y: (clientY - origin.top - view.ty) / view.k,
  }
}

export function panView(view: MapView, dx: number, dy: number): MapView {
  return { k: view.k, tx: view.tx + dx, ty: view.ty + dy }
}

/** Zoom so the world point under the cursor stays under the cursor. */
export function zoomViewAt(
  view: MapView,
  clientX: number,
  clientY: number,
  origin: MapOrigin,
  factor: number,
): MapView {
  const world = clientToWorld(view, clientX, clientY, origin)
  const k = clampScale(view.k * factor)
  return {
    k,
    tx: clientX - origin.left - world.x * k,
    ty: clientY - origin.top - world.y * k,
  }
}

export function nodeDragPosition(
  start: { readonly sx: number; readonly sy: number; readonly bx: number; readonly by: number },
  world: MapPoint,
): MapPoint {
  return { x: start.bx + (world.x - start.sx), y: start.by + (world.y - start.sy) }
}

export function nodeMovedEnough(
  start: { readonly sx: number; readonly sy: number },
  world: MapPoint,
  k: number,
): boolean {
  return Math.abs(world.x - start.sx) * k > MAP_NODE_MOVE_PX
    || Math.abs(world.y - start.sy) * k > MAP_NODE_MOVE_PX
}
