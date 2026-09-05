/**
 * Optional desktop Host installer: the Web GUI calls `window.dshDesktop`
 * when this page is the packaged Electron window. A browser tab has no
 * preload and this module is a no-op there.
 */

import type { ProductReleaseArtifact } from '../artifact.ts'

/** Progress events the isolated preload forwards from the main process. */
export type DesktopUpdateProgress =
  | { phase: 'downloading'; received: number; total: number }
  | { phase: 'verifying' }
  | { phase: 'applying' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

/** Renderer → main install request. */
export interface DesktopInstallRequest {
  tag: string
  version: string
  artifact: ProductReleaseArtifact
}

/** Isolated preload face used by the product-update row. */
export interface DesktopInstallBridge {
  canInstall?: () => boolean
  installUpdate?: (payload: DesktopInstallRequest) => Promise<{ ok: true } | { ok: false; error: string }>
  cancelUpdate?: () => void
  onUpdateProgress?: (cb: (event: unknown) => void) => () => void
  relaunchToUpdate?: () => void
}

/**
 * Read the installer methods when this page is the desktop window.
 *
 * @param target - `window`, or a test double.
 * @returns the preload object, or `undefined` in a plain browser tab.
 */
export function readDesktopInstallBridge(
  target: { dshDesktop?: DesktopInstallBridge } | undefined = globalThis as { dshDesktop?: DesktopInstallBridge },
): DesktopInstallBridge | undefined {
  return target.dshDesktop
}

/**
 * Whether this page can run the packaged installer.
 *
 * @param target - `window`, or a test double.
 * @returns `true` only when the preload reports a packaged build.
 */
export function desktopCanInstall(
  target: { dshDesktop?: DesktopInstallBridge } | undefined = globalThis as { dshDesktop?: DesktopInstallBridge },
): boolean {
  const canInstall = readDesktopInstallBridge(target)?.canInstall
  if (canInstall === undefined) return false
  try {
    const value: unknown = canInstall()
    return value === true
  } catch {
    // Preload or Host rejection must not break the Web GUI.
    return false
  }
}

/**
 * Narrow an unknown progress payload from IPC.
 *
 * @param value - preload callback argument.
 * @returns a progress event, or `undefined`.
 */
export function readDesktopUpdateProgress(value: unknown): DesktopUpdateProgress | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const rec = value as Record<string, unknown>
  if (rec.phase === 'downloading') {
    if (typeof rec.received !== 'number' || typeof rec.total !== 'number') return undefined
    return { phase: 'downloading', received: rec.received, total: rec.total }
  }
  if (rec.phase === 'verifying' || rec.phase === 'applying' || rec.phase === 'ready') {
    return { phase: rec.phase }
  }
  if (rec.phase === 'error' && typeof rec.message === 'string') {
    return { phase: 'error', message: rec.message }
  }
  return undefined
}
