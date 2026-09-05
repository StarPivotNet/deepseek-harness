/**
 * Electron main process: one custom-chrome window around a local `dsh web` Host.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyCompletedDockIcon } from './dock-attention.ts'
import { isReusableListenPort, startWebHost, stopWebHost, type StartedHost } from './host.ts'
import { bindDesktopUpdateIpc, createDesktopUpdater, type DesktopUpdateProgress } from './update.ts'
import { APP_USER_MODEL_ID, desktopIconPath } from './icon.ts'
import { windowsShortcutPath, windowsShortcutSpec } from './shortcut.ts'
import {
  TITLEBAR_HEIGHT_PX,
  loadingPage,
  titlebarInjectScript,
  titlebarStyles,
  titlebarVariantForPlatform,
} from './titlebar.ts'

const WINDOW_TITLE = 'DeepSeek Harness'
const PRELOAD = fileURLToPath(new URL('./preload.js', import.meta.url))
const IS_MAC = process.platform === 'darwin'
const TITLEBAR_VARIANT = titlebarVariantForPlatform(process.platform)

/** Last successful workspace, Node path, and Host port, kept next to Electron's userData. */
function workspaceMemoryPath(): string {
  return join(app.getPath('userData'), 'workspace.json')
}

interface LaunchMemory {
  cwd?: string
  node?: string
  /** Last successful Host loopback port; reused so Chromium keeps localStorage. */
  port?: number
}

/** Restore the previous window's `dsh web` cwd, Node executable, and loopback port. */
function readLaunchMemory(): LaunchMemory {
  try {
    const parsed: unknown = JSON.parse(readFileSync(workspaceMemoryPath(), 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as { cwd?: unknown; node?: unknown; port?: unknown }
    const port = isReusableListenPort(record.port) ? record.port : undefined
    return {
      ...typeof record.cwd === 'string' && existsSync(record.cwd) ? { cwd: record.cwd } : {},
      ...typeof record.node === 'string' && existsSync(record.node) ? { node: record.node } : {},
      ...port === undefined ? {} : { port },
    }
  } catch {
    return {}
  }
}

/** Persist the directory, Node path, and Host port this window used. */
function rememberLaunch(cwd: string, node: string, port: number): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(workspaceMemoryPath(), `${JSON.stringify({ cwd, node, port })}\n`)
}

/** Working directory for the Host spawned beside this window. */
function resolveWorkspace(memory: LaunchMemory): string {
  return memory.cwd
    ?? (process.env.INIT_CWD !== undefined && existsSync(process.env.INIT_CWD) ? process.env.INIT_CWD : undefined)
    ?? process.cwd()
}

/** Extra `dsh web` flags forwarded by `dsh desktop` through the environment. */
function extraWebArgs(): string[] {
  const raw = process.env.DSH_DESKTOP_WEB_ARGS
  if (raw === undefined || raw === '') return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error('dsh desktop: DSH_DESKTOP_WEB_ARGS must be a JSON string array')
  }
  return parsed
}

function createWindow(): BrowserWindow {
  // On macOS the native traffic lights sit in the reserved left side of the
  // title bar; elsewhere the system caption-button overlay sits on the right.
  const chrome = IS_MAC
    ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 12, y: Math.floor((TITLEBAR_HEIGHT_PX - 14) / 2) },
      vibrancy: 'under-window' as const,
    }
    : {
      titleBarStyle: 'hidden' as const,
      titleBarOverlay: {
        color: '#151517',
        symbolColor: '#ececf1',
        height: TITLEBAR_HEIGHT_PX,
      },
    }
  return new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: WINDOW_TITLE,
    icon: nativeImage.createFromPath(desktopIconPath()),
    backgroundColor: '#151517',
    frame: false,
    ...chrome,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
}

/**
 * Standard macOS application menu. `role` items carry their own Cmd shortcuts.
 */
function installApplicationMenu(): void {
  if (!IS_MAC) return
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
  ]))
}

function bindWindowChrome(window: BrowserWindow): void {
  ipcMain.on('dsh-desktop:minimize', () => { window.minimize() })
  ipcMain.on('dsh-desktop:maximize', () => {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on('dsh-desktop:close', () => { window.close() })
}

function attachTitlebar(window: BrowserWindow): void {
  window.webContents.on('dom-ready', () => {
    void window.webContents.insertCSS(titlebarStyles(TITLEBAR_VARIANT))
  })
  window.webContents.on('did-finish-load', () => {
    void window.webContents.executeJavaScript(titlebarInjectScript(TITLEBAR_VARIANT))
  })
}

function fenceNavigation(window: BrowserWindow, origin: string): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(origin) || url.startsWith('data:')) return
    event.preventDefault()
    void shell.openExternal(url)
  })
}

let host: StartedHost | undefined

if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)
// A checkout-launched Electron binary has no bundle icon; claim the whale mark.
if (IS_MAC) app.dock?.setIcon(nativeImage.createFromPath(desktopIconPath()))

function publishWindowsShortcut(): void {
  const desktopRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const shortcut = windowsShortcutPath(join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  if (existsSync(shortcut)) return
  const spec = windowsShortcutSpec({ electronPath: process.execPath, desktopRoot })
  if (!shell.writeShortcutLink(shortcut, 'create', spec)) {
    console.error(`dsh desktop: could not write Start menu shortcut at ${shortcut}`)
  }
}

/** One Host start, handed to {@link presentWindow} for display. */
interface HostLaunch {
  /** Working directory the Host was spawned in. */
  cwd: string
  /** Promise that resolves when the Host prints its readiness URL. */
  ready: Promise<StartedHost>
}

function startHost(memory: LaunchMemory): HostLaunch {
  const cwd = resolveWorkspace(memory)
  return {
    cwd,
    ready: startWebHost({
      cwd,
      extraArgs: extraWebArgs(),
      extraEnv: {
        DSH_PRODUCT_CHANNEL: 'desktop',
        DSH_PRODUCT_VERSION: app.getVersion(),
      },
      ...memory.node === undefined ? {} : { nodePath: memory.node },
      ...memory.port === undefined ? {} : { port: memory.port },
    }),
  }
}

/** Create a window, then mount the launched Host into it (or its failure page). */
async function presentWindow(launch: HostLaunch): Promise<void> {
  const window = createWindow()
  bindWindowChrome(window)
  attachTitlebar(window)
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loadingPage(TITLEBAR_VARIANT))}`)
  window.show()
  try {
    host = await launch.ready
    rememberLaunch(launch.cwd, host.child.spawnfile, host.ready.port)
    fenceNavigation(window, new URL(host.ready.href).origin)
    await window.loadURL(host.ready.href)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
      loadingPage(TITLEBAR_VARIANT, message),
    )}`)
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  const dockIconPng = readFileSync(desktopIconPath())
  let previousCompletedUnread = 0
  const updater = createDesktopUpdater({
    isPackaged: app.isPackaged,
    platform: process.platform,
    execPath: process.execPath,
    userData: app.getPath('userData'),
    pid: process.pid,
    ...process.env.APPIMAGE === undefined || process.env.APPIMAGE === '' ? {} : { appImage: process.env.APPIMAGE },
    sendProgress: (event: DesktopUpdateProgress) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('dsh-desktop:update-progress', event)
      }
    },
    quit: () => { app.quit() },
  })
  bindDesktopUpdateIpc(ipcMain, updater)
  ipcMain.on('dsh-desktop:set-completed-unread', (_event, count: unknown) => {
    const next = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
    applyCompletedDockIcon(
      IS_MAC ? app.dock : undefined,
      IS_MAC ? (png) => { app.dock?.setIcon(nativeImage.createFromBuffer(png)) } : undefined,
      dockIconPng,
      next,
      previousCompletedUnread,
    )
    previousCompletedUnread = next
  })
  app.name = WINDOW_TITLE
  installApplicationMenu()

  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  // Start the Host before Chromium is ready so plugin boot overlaps window creation.
  const firstLaunch = startHost(readLaunchMemory())

  void app.whenReady().then(async () => {
    if (process.platform === 'win32') publishWindowsShortcut()
    await presentWindow(firstLaunch)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length > 0) return
    void presentWindow(startHost(readLaunchMemory()))
  })

  app.on('window-all-closed', () => {
    if (host !== undefined) stopWebHost(host.child)
    host = undefined
    // macOS keeps the dock process alive; the dock icon reopens the window.
    if (!IS_MAC) app.quit()
  })

  app.on('before-quit', () => {
    if (host !== undefined) stopWebHost(host.child)
  })
}
