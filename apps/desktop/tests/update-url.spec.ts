import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESKTOP_UPDATE_REPO,
  desktopArtifactName,
  isGithubReleaseDownloadUrl,
  readInstallRequest,
  type DesktopUpdatePlatform,
} from '../src/update-url.ts'

const TAG = 'desktop-v1.2.4'
const VERSION = '1.2.4'
const NAME = 'DeepSeek Harness-1.2.4-win.zip'
const HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const URL = `https://github.com/${DEFAULT_DESKTOP_UPDATE_REPO}/releases/download/${TAG}/${encodeURIComponent(NAME)}`

describe('desktopArtifactName', () => {
  it('matches the packer archive names', () => {
    expect(desktopArtifactName('1.0.0', 'darwin')).toBe('DeepSeek Harness-1.0.0-mac.zip')
    expect(desktopArtifactName('1.0.0', 'linux')).toBe('DeepSeek Harness-1.0.0.AppImage')
    expect(desktopArtifactName('1.0.0', 'win32')).toBe('DeepSeek Harness-1.0.0-win.zip')
    expect(() => desktopArtifactName('1.0.0', 'aix' as DesktopUpdatePlatform)).toThrow(/unsupported platform/)
  })
})

describe('isGithubReleaseDownloadUrl', () => {
  it('accepts only the GitHub download URL for that repo, tag, and name', () => {
    expect(isGithubReleaseDownloadUrl(URL, DEFAULT_DESKTOP_UPDATE_REPO, TAG, NAME)).toBe(true)
    expect(isGithubReleaseDownloadUrl(URL.replace('https://', 'http://'), DEFAULT_DESKTOP_UPDATE_REPO, TAG, NAME)).toBe(false)
    expect(isGithubReleaseDownloadUrl(`${URL}?raw=1`, DEFAULT_DESKTOP_UPDATE_REPO, TAG, NAME)).toBe(false)
    expect(isGithubReleaseDownloadUrl(`${URL}#x`, DEFAULT_DESKTOP_UPDATE_REPO, TAG, NAME)).toBe(false)
    expect(isGithubReleaseDownloadUrl(
      `https://user@github.com/${DEFAULT_DESKTOP_UPDATE_REPO}/releases/download/${TAG}/${encodeURIComponent(NAME)}`,
      DEFAULT_DESKTOP_UPDATE_REPO,
      TAG,
      NAME,
    )).toBe(false)
    expect(isGithubReleaseDownloadUrl('not-a-url', DEFAULT_DESKTOP_UPDATE_REPO, TAG, NAME)).toBe(false)
  })
})

describe('readInstallRequest', () => {
  const valid = {
    tag: TAG,
    version: VERSION,
    artifact: {
      name: NAME,
      url: URL,
      sha256: HASH,
      size: 12,
      platform: 'win32' as const,
    },
  }

  it('accepts a matching payload for this platform', () => {
    expect(readInstallRequest(valid, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toEqual(valid)
  })

  it('rejects untrusted or mismatched payloads', () => {
    expect(readInstallRequest(null, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest('nope', DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({ ...valid, tag: '' }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({ ...valid, version: '' }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({ ...valid, artifact: null }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({
      ...valid,
      artifact: { ...valid.artifact, sha256: 'nope' },
    }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({
      ...valid,
      artifact: { ...valid.artifact, sha256: HASH.toUpperCase() },
    }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({
      ...valid,
      artifact: { ...valid.artifact, size: 0 },
    }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({
      ...valid,
      artifact: { ...valid.artifact, size: 1.5 },
    }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({
      ...valid,
      artifact: { ...valid.artifact, platform: 'darwin' },
    }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({
      ...valid,
      artifact: { ...valid.artifact, platform: 'aix' },
    }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({
      ...valid,
      artifact: { ...valid.artifact, name: 'other.zip' },
    }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({
      ...valid,
      artifact: { ...valid.artifact, url: 'https://example.test/x.zip' },
    }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({
      ...valid,
      artifact: { ...valid.artifact, name: '' },
    }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
    expect(readInstallRequest({
      ...valid,
      artifact: { ...valid.artifact, url: '' },
    }, DEFAULT_DESKTOP_UPDATE_REPO, 'win32')).toBeUndefined()
  })
})
