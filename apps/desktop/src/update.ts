/**
 * Packaged-desktop in-app update: download, verify, stage, then relaunch through a helper.
 * @module @deepseek-ai/dsh-desktop/update
 */

import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { planApply } from './update-apply.ts'
import { downloadVerifiedFile } from './update-download.ts'
import { DEFAULT_DESKTOP_UPDATE_REPO, readInstallRequest } from './update-url.ts'
import { unzipTo } from './update-zip.ts'

/** Progress events sent to the renderer. */
export type DesktopUpdateProgress =
  | { phase: 'downloading'; received: number; total: number }
  | { phase: 'verifying' }
  | { phase: 'applying' }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }

/** Install RPC result. */
export type DesktopInstallResult = { ok: true } | { ok: false; error: string }

/** IO seams the main process injects. */
export interface DesktopUpdaterHost {
  isPackaged: boolean
  platform: NodeJS.Platform
  execPath: string
  userData: string
  pid: number
  appImage?: string
  repo?: string
  fetchImpl?: typeof fetch
  sendProgress: (event: DesktopUpdateProgress) => void
  quit: () => void
  spawnDetached?: (command: string, args: readonly string[]) => void
}

/** Mutable updater bound to one Electron app. */
export interface DesktopUpdater {
  canInstall: () => boolean
  install: (payload: unknown) => Promise<DesktopInstallResult>
  cancel: () => void
  relaunch: () => void
}

/**
 * Create the desktop updater. `canInstall` is true only for a packaged build.
 *
 * @param host - process and IO seams.
 * @returns the updater.
 */
export function createDesktopUpdater(host: DesktopUpdaterHost): DesktopUpdater {
  const repo = host.repo ?? DEFAULT_DESKTOP_UPDATE_REPO
  const fetchImpl = host.fetchImpl ?? fetch
  const spawnDetached = host.spawnDetached ?? defaultSpawnDetached
  const root = join(host.userData, 'updates')
  let controller: AbortController | undefined
  let ready = false
  let busy = false

  const fail = (error: string): DesktopInstallResult => {
    ready = false
    busy = false
    host.sendProgress({ phase: 'error', message: error })
    return { ok: false, error }
  }

  return {
    canInstall: () => host.isPackaged,
    cancel: () => {
      controller?.abort()
    },
    relaunch: () => {
      if (!ready) return
      const stagingDir = join(root, 'staging')
      const plan = planApply({
        platform: host.platform,
        pid: host.pid,
        stagingDir,
        execPath: host.execPath,
        appImage: host.appImage,
        helperDir: root,
      })
      if (plan === undefined) {
        host.sendProgress({ phase: 'error', message: 'incomplete-staging' })
        return
      }
      host.sendProgress({ phase: 'applying' })
      writeFileSync(plan.scriptPath, plan.script)
      if (host.platform !== 'win32') chmodSync(plan.scriptPath, 0o755)
      spawnDetached(plan.command, plan.args)
      host.quit()
    },
    install: async (payload) => {
      if (!host.isPackaged) return fail('not-packaged')
      if (busy) return { ok: false, error: 'busy' }
      const request = readInstallRequest(payload, repo, host.platform)
      if (request === undefined) return fail('invalid-artifact')
      if (host.platform === 'linux' && (host.appImage === undefined || host.appImage === '')) {
        return fail('not-appimage')
      }
      busy = true
      ready = false
      controller = new AbortController()
      rmSync(root, { recursive: true, force: true })
      mkdirSync(root, { recursive: true })
      const archivePath = join(root, request.artifact.name)
      const stagingDir = join(root, 'staging')
      try {
        await downloadVerifiedFile({
          url: request.artifact.url,
          destPath: archivePath,
          sha256: request.artifact.sha256,
          size: request.artifact.size,
          fetchImpl,
          signal: controller.signal,
          onProgress: (received, total) => {
            host.sendProgress({ phase: 'downloading', received, total })
          },
        })
        host.sendProgress({ phase: 'verifying' })
        mkdirSync(stagingDir, { recursive: true })
        if (host.platform === 'linux') {
          const staged = join(stagingDir, 'DeepSeekHarness.AppImage')
          renameSync(archivePath, staged)
          chmodSync(staged, 0o755)
        } else {
          unzipTo(readFileSync(archivePath), stagingDir)
        }
        const plan = planApply({
          platform: host.platform,
          pid: host.pid,
          stagingDir,
          execPath: host.execPath,
          appImage: host.appImage,
          helperDir: root,
        })
        if (plan === undefined) return fail('incomplete-staging')
        ready = true
        busy = false
        host.sendProgress({ phase: 'ready' })
        return { ok: true }
      } catch (error) {
        if (controller.signal.aborted) return fail('cancelled')
        const message = error instanceof Error ? error.message : String(error)
        return fail(message)
      } finally {
        busy = false
        controller = undefined
      }
    },
  }
}

/**
 * Register install IPC on `ipcMain`.
 *
 * @param ipc - Electron `ipcMain`.
 * @param updater - updater instance.
 */
export function bindDesktopUpdateIpc(
  ipc: {
    handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => void
    on: (channel: string, listener: (event: unknown) => void) => void
  },
  updater: DesktopUpdater,
): void {
  ipc.on('dsh-desktop:update-can-install', (event) => {
    (event as { returnValue: boolean }).returnValue = updater.canInstall()
  })
  ipc.handle('dsh-desktop:update-install', (_event, payload) => updater.install(payload))
  ipc.on('dsh-desktop:update-cancel', () => { updater.cancel() })
  ipc.on('dsh-desktop:update-relaunch', () => { updater.relaunch() })
}

function defaultSpawnDetached(command: string, args: readonly string[]): void {
  const child = spawn(command, [...args], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}
