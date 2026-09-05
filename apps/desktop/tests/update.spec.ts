import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { bindDesktopUpdateIpc, createDesktopUpdater, type DesktopUpdateProgress } from '../src/update.ts'
import { DEFAULT_DESKTOP_UPDATE_REPO } from '../src/update-url.ts'
import { zipStore } from '../src/update-zip.ts'

const here = dirname(fileURLToPath(import.meta.url))
const TAG = 'desktop-v1.2.4'
const VERSION = '1.2.4'
const WIN_NAME = 'DeepSeek Harness-1.2.4-win.zip'
const LINUX_NAME = 'DeepSeek Harness-1.2.4.AppImage'
const WIN_URL = `https://github.com/${DEFAULT_DESKTOP_UPDATE_REPO}/releases/download/${TAG}/${encodeURIComponent(WIN_NAME)}`
const LINUX_URL = `https://github.com/${DEFAULT_DESKTOP_UPDATE_REPO}/releases/download/${TAG}/${encodeURIComponent(LINUX_NAME)}`

function winPayload(exe = Buffer.from('new-exe')) {
  const zip = zipStore({ 'DeepSeekHarness.exe': exe })
  return {
    zip,
    sha256: createHash('sha256').update(zip).digest('hex'),
    request: {
      tag: TAG,
      version: VERSION,
      artifact: {
        name: WIN_NAME,
        url: WIN_URL,
        sha256: createHash('sha256').update(zip).digest('hex'),
        size: zip.length,
        platform: 'win32' as const,
      },
    },
  }
}

describe('createDesktopUpdater', () => {
  it('refuses checkout launches and untrusted payloads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-upd-'))
    const events: DesktopUpdateProgress[] = []
    const updater = createDesktopUpdater({
      isPackaged: false,
      platform: 'win32',
      execPath: join(dir, 'DeepSeekHarness.exe'),
      userData: dir,
      pid: 1,
      sendProgress: (event) => { events.push(event) },
      quit: () => {},
    })
    expect(updater.canInstall()).toBe(false)
    updater.cancel()
    expect(await updater.install(winPayload().request)).toEqual({ ok: false, error: 'not-packaged' })
    const packaged = createDesktopUpdater({
      isPackaged: true,
      platform: 'win32',
      execPath: join(dir, 'DeepSeekHarness.exe'),
      userData: dir,
      pid: 1,
      sendProgress: (event) => { events.push(event) },
      quit: () => {},
    })
    expect(packaged.canInstall()).toBe(true)
    expect(await packaged.install({ tag: TAG })).toEqual({ ok: false, error: 'invalid-artifact' })
  })

  it('downloads, stages, and relaunches a Windows zip', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-upd-win-'))
    const app = join(dir, 'app')
    mkdirSync(app)
    writeFileSync(join(app, 'DeepSeekHarness.exe'), 'old')
    const { zip, request } = winPayload()
    const events: DesktopUpdateProgress[] = []
    const spawned: Array<[string, readonly string[]]> = []
    let quit = 0
    const updater = createDesktopUpdater({
      isPackaged: true,
      platform: 'win32',
      execPath: join(app, 'DeepSeekHarness.exe'),
      userData: join(dir, 'user'),
      pid: 42,
      fetchImpl: async () => new Response(zip, { status: 200 }),
      sendProgress: (event) => { events.push(event) },
      quit: () => { quit += 1 },
      spawnDetached: (command, args) => { spawned.push([command, args]) },
    })
    expect(await updater.install(request)).toEqual({ ok: true })
    expect(events.some(event => event.phase === 'downloading')).toBe(true)
    expect(events.at(-1)).toEqual({ phase: 'ready' })
    expect(existsSync(join(dir, 'user', 'updates', 'staging', 'DeepSeekHarness.exe'))).toBe(true)
    updater.relaunch()
    expect(spawned[0]?.[0]).toBe('cmd.exe')
    expect(quit).toBe(1)
    expect(readFileSync(spawned[0]![1][2]!, 'utf8')).toContain('robocopy')
  })

  it('stages a Linux AppImage and refuses a missing APPIMAGE path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-upd-linux-'))
    const body = Buffer.from('appimage-bytes')
    const sha256 = createHash('sha256').update(body).digest('hex')
    const request = {
      tag: TAG,
      version: VERSION,
      artifact: {
        name: LINUX_NAME,
        url: LINUX_URL,
        sha256,
        size: body.length,
        platform: 'linux' as const,
      },
    }
    const missing = createDesktopUpdater({
      isPackaged: true,
      platform: 'linux',
      execPath: join(dir, 'DeepSeekHarness'),
      userData: dir,
      pid: 1,
      sendProgress: () => {},
      quit: () => {},
    })
    expect(await missing.install(request)).toEqual({ ok: false, error: 'not-appimage' })
    const emptyAppImage = createDesktopUpdater({
      isPackaged: true,
      platform: 'linux',
      execPath: join(dir, 'DeepSeekHarness'),
      userData: dir,
      pid: 1,
      appImage: '',
      sendProgress: () => {},
      quit: () => {},
    })
    expect(await emptyAppImage.install(request)).toEqual({ ok: false, error: 'not-appimage' })
    const events: DesktopUpdateProgress[] = []
    const spawned: Array<[string, readonly string[]]> = []
    const updater = createDesktopUpdater({
      isPackaged: true,
      platform: 'linux',
      execPath: join(dir, 'DeepSeekHarness'),
      userData: join(dir, 'user'),
      pid: 7,
      appImage: join(dir, 'current.AppImage'),
      fetchImpl: async () => new Response(body, { status: 200 }),
      sendProgress: (event) => { events.push(event) },
      quit: () => {},
      spawnDetached: (command, args) => { spawned.push([command, args]) },
    })
    expect(await updater.install(request)).toEqual({ ok: true })
    expect(existsSync(join(dir, 'user', 'updates', 'staging', 'DeepSeekHarness.AppImage'))).toBe(true)
    updater.relaunch()
    expect(spawned[0]?.[0]).toBe('/bin/sh')
    expect(events.some(event => event.phase === 'applying')).toBe(true)
  })

  it('cancels an in-flight download and rejects a second install while busy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-upd-busy-'))
    const { zip, request } = winPayload()
    let releaseFetch: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { releaseFetch = resolve })
    const updater = createDesktopUpdater({
      isPackaged: true,
      platform: 'win32',
      execPath: join(dir, 'DeepSeekHarness.exe'),
      userData: dir,
      pid: 1,
      fetchImpl: async (_input, init) => {
        await gate
        if (init?.signal?.aborted === true) {
          const err = Object.assign(new Error('aborted'), { name: 'AbortError' })
          throw err
        }
        return new Response(zip, { status: 200 })
      },
      sendProgress: () => {},
      quit: () => {},
    })
    const pending = updater.install(request)
    expect(await updater.install(request)).toEqual({ ok: false, error: 'busy' })
    updater.cancel()
    releaseFetch?.()
    expect(await pending).toEqual({ ok: false, error: 'cancelled' })
  })

  it('maps a download failure and ignores relaunch before ready', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-upd-fail-'))
    const { request } = winPayload()
    const quit = vi.fn()
    const updater = createDesktopUpdater({
      isPackaged: true,
      platform: 'win32',
      execPath: join(dir, 'DeepSeekHarness.exe'),
      userData: dir,
      pid: 1,
      fetchImpl: async () => new Response('nope', { status: 500 }),
      sendProgress: () => {},
      quit,
    })
    updater.relaunch()
    expect(quit).not.toHaveBeenCalled()
    expect(await updater.install(request)).toMatchObject({ ok: false, error: expect.stringMatching(/HTTP 500/) })
    const thrown = createDesktopUpdater({
      isPackaged: true,
      platform: 'win32',
      execPath: join(dir, 'DeepSeekHarness.exe'),
      userData: dir,
      pid: 1,
      fetchImpl: async () => { throw 'offline' },
      sendProgress: () => {},
      quit,
    })
    expect(await thrown.install(request)).toEqual({ ok: false, error: 'offline' })
  })

  it('downloads a macOS zip and errors if staging disappears before relaunch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-upd-mac-'))
    const nested = join(dir, 'DeepSeek Harness.app', 'Contents', 'MacOS')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'DeepSeekHarness'), 'old')
    const zip = zipStore({
      'DeepSeek Harness.app/Contents/MacOS/DeepSeekHarness': Buffer.from('new'),
    })
    const request = {
      tag: TAG,
      version: VERSION,
      artifact: {
        name: 'DeepSeek Harness-1.2.4-mac.zip',
        url: `https://github.com/${DEFAULT_DESKTOP_UPDATE_REPO}/releases/download/${TAG}/${encodeURIComponent('DeepSeek Harness-1.2.4-mac.zip')}`,
        sha256: createHash('sha256').update(zip).digest('hex'),
        size: zip.length,
        platform: 'darwin' as const,
      },
    }
    const events: DesktopUpdateProgress[] = []
    const spawned: Array<[string, readonly string[]]> = []
    const quit = vi.fn()
    const updater = createDesktopUpdater({
      isPackaged: true,
      platform: 'darwin',
      execPath: join(nested, 'DeepSeekHarness'),
      userData: join(dir, 'user'),
      pid: 11,
      fetchImpl: async () => new Response(zip, { status: 200 }),
      sendProgress: (event) => { events.push(event) },
      quit,
      spawnDetached: (command, args) => { spawned.push([command, args]) },
    })
    expect(await updater.install(request)).toEqual({ ok: true })
    updater.relaunch()
    expect(spawned[0]?.[0]).toBe('/bin/sh')
    expect(quit).toHaveBeenCalledOnce()
    const incomplete = createDesktopUpdater({
      isPackaged: true,
      platform: 'darwin',
      execPath: join(nested, 'DeepSeekHarness'),
      userData: join(dir, 'user2'),
      pid: 11,
      fetchImpl: async () => new Response(zipStore({ 'readme.txt': Buffer.from('x') }), { status: 200 }),
      sendProgress: (event) => { events.push(event) },
      quit,
    })
    const emptyZip = zipStore({ 'readme.txt': Buffer.from('x') })
    expect(await incomplete.install({
      ...request,
      artifact: {
        ...request.artifact,
        sha256: createHash('sha256').update(emptyZip).digest('hex'),
        size: emptyZip.length,
      },
    })).toEqual({ ok: false, error: 'incomplete-staging' })
  })

  it('errors on relaunch when staging disappears after ready', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-upd-gone-'))
    const app = join(dir, 'app')
    mkdirSync(app)
    writeFileSync(join(app, 'DeepSeekHarness.exe'), 'old')
    const { zip, request } = winPayload()
    const events: DesktopUpdateProgress[] = []
    const spawned: Array<[string, readonly string[]]> = []
    let quit = 0
    const updater = createDesktopUpdater({
      isPackaged: true,
      platform: 'win32',
      execPath: join(app, 'DeepSeekHarness.exe'),
      userData: join(dir, 'user'),
      pid: 42,
      fetchImpl: async () => new Response(zip, { status: 200 }),
      sendProgress: (event) => { events.push(event) },
      quit: () => { quit += 1 },
      spawnDetached: (command, args) => { spawned.push([command, args]) },
    })
    expect(await updater.install(request)).toEqual({ ok: true })
    rmSync(join(dir, 'user', 'updates', 'staging'), { recursive: true, force: true })
    updater.relaunch()
    expect(events.at(-1)).toEqual({ phase: 'error', message: 'incomplete-staging' })
    expect(quit).toBe(0)
    expect(spawned).toEqual([])
  })
})

describe('bindDesktopUpdateIpc', () => {
  it('wires canInstall, install, cancel, and relaunch', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipc = {
      handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(`handle:${channel}`, listener)
      },
      on: (channel: string, listener: (...args: unknown[]) => unknown) => {
        handlers.set(`on:${channel}`, listener)
      },
    }
    const updater = {
      canInstall: () => true,
      install: vi.fn(async () => ({ ok: true as const })),
      cancel: vi.fn(),
      relaunch: vi.fn(),
    }
    bindDesktopUpdateIpc(ipc, updater)
    const sync = { returnValue: undefined as unknown }
    handlers.get('on:dsh-desktop:update-can-install')!(sync)
    expect(sync.returnValue).toBe(true)
    await handlers.get('handle:dsh-desktop:update-install')!({}, { tag: TAG })
    expect(updater.install).toHaveBeenCalledWith({ tag: TAG })
    handlers.get('on:dsh-desktop:update-cancel')!({})
    handlers.get('on:dsh-desktop:update-relaunch')!({})
    expect(updater.cancel).toHaveBeenCalledOnce()
    expect(updater.relaunch).toHaveBeenCalledOnce()
  })
})

describe('desktop update wiring', () => {
  it('exposes install methods from the isolated preload', () => {
    const preload = readFileSync(join(here, '../src/preload.ts'), 'utf8')
    expect(preload).toContain("canInstall: () => ipcRenderer.sendSync('dsh-desktop:update-can-install') === true")
    expect(preload).toContain("ipcRenderer.invoke('dsh-desktop:update-install'")
    expect(preload).toContain("ipcRenderer.send('dsh-desktop:update-cancel')")
    expect(preload).toContain("ipcRenderer.send('dsh-desktop:update-relaunch')")
  })

  it('binds the updater from the main process', () => {
    const main = readFileSync(join(here, '../src/main.ts'), 'utf8')
    expect(main).toContain('createDesktopUpdater(')
    expect(main).toContain('bindDesktopUpdateIpc(ipcMain, updater)')
    expect(main).toContain("window.webContents.send('dsh-desktop:update-progress'")
  })
})
