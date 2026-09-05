import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  desktopCanInstall,
  readDesktopInstallBridge,
  readDesktopUpdateProgress,
} from '../src/client/desktop-install.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readDesktopInstallBridge', () => {
  it('returns the preload face when present and undefined otherwise', () => {
    expect(readDesktopInstallBridge({})).toBeUndefined()
    expect(readDesktopInstallBridge(undefined)).toBeUndefined()
    const canInstall = (): boolean => true
    expect(readDesktopInstallBridge({ dshDesktop: { canInstall } })?.canInstall).toBe(canInstall)
  })
})

describe('desktopCanInstall', () => {
  it('is false without a packaged preload', () => {
    expect(desktopCanInstall({})).toBe(false)
    expect(desktopCanInstall({ dshDesktop: {} })).toBe(false)
    expect(desktopCanInstall({ dshDesktop: { canInstall: () => false } })).toBe(false)
  })

  it('is true when the preload reports a packaged build', () => {
    expect(desktopCanInstall({ dshDesktop: { canInstall: () => true } })).toBe(true)
  })

  it('swallows a throwing Host call', () => {
    expect(desktopCanInstall({
      dshDesktop: { canInstall: () => { throw new Error('unavailable') } },
    })).toBe(false)
  })
})

describe('readDesktopUpdateProgress', () => {
  it('keeps well-formed phases and rejects the rest', () => {
    expect(readDesktopUpdateProgress({ phase: 'downloading', received: 1, total: 2 }))
      .toEqual({ phase: 'downloading', received: 1, total: 2 })
    expect(readDesktopUpdateProgress({ phase: 'verifying' })).toEqual({ phase: 'verifying' })
    expect(readDesktopUpdateProgress({ phase: 'applying' })).toEqual({ phase: 'applying' })
    expect(readDesktopUpdateProgress({ phase: 'ready' })).toEqual({ phase: 'ready' })
    expect(readDesktopUpdateProgress({ phase: 'error', message: 'nope' }))
      .toEqual({ phase: 'error', message: 'nope' })
    expect(readDesktopUpdateProgress(null)).toBeUndefined()
    expect(readDesktopUpdateProgress({ phase: 'downloading' })).toBeUndefined()
    expect(readDesktopUpdateProgress({ phase: 'error' })).toBeUndefined()
    expect(readDesktopUpdateProgress({ phase: 'other' })).toBeUndefined()
  })
})
