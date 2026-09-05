import { describe, expect, it } from 'vitest'
import {
  attachDesktopArtifact,
  desktopArtifactName,
  isSupportedDesktopTarget,
  parseGithubReleaseAssets,
  parseSha256Sums,
  pickReleaseAsset,
  releaseWithArtifact,
  type DesktopUpdatePlatform,
  type GithubReleaseAsset,
} from '../src/artifact.ts'
import type { ProductRelease } from '../src/releases.ts'

const REPO = 'StarPivotNet/deepseek-harness'
const TAG = 'desktop-v1.2.4'
const VERSION = '1.2.4'
const WIN_NAME = 'DeepSeek Harness-1.2.4-win.zip'
const HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function asset(name: string, size = 10): GithubReleaseAsset {
  return {
    name,
    browser_download_url: `https://github.com/${REPO}/releases/download/${TAG}/${encodeURIComponent(name)}`,
    size,
  }
}

function release(partial: Partial<ProductRelease> = {}): ProductRelease {
  return {
    tag: TAG,
    version: VERSION,
    url: `https://github.com/${REPO}/releases/tag/${TAG}`,
    notes: 'notes',
    ...partial,
  }
}

describe('desktopArtifactName', () => {
  it('matches the packer archive names', () => {
    expect(desktopArtifactName('1.0.0', 'darwin')).toBe('DeepSeek Harness-1.0.0-mac.zip')
    expect(desktopArtifactName('1.0.0', 'linux')).toBe('DeepSeek Harness-1.0.0.AppImage')
    expect(desktopArtifactName('1.0.0', 'win32')).toBe('DeepSeek Harness-1.0.0-win.zip')
    expect(desktopArtifactName('0.1.2-rc.1', 'win32')).toBe('DeepSeek Harness-0.1.2-rc.1-win.zip')
    expect(() => desktopArtifactName('1.0.0', 'aix' as DesktopUpdatePlatform)).toThrow(/unsupported platform/)
  })
})

describe('isSupportedDesktopTarget', () => {
  it('accepts only the packaged triples', () => {
    expect(isSupportedDesktopTarget('darwin', 'arm64')).toBe(true)
    expect(isSupportedDesktopTarget('linux', 'x64')).toBe(true)
    expect(isSupportedDesktopTarget('win32', 'x64')).toBe(true)
    expect(isSupportedDesktopTarget('darwin', 'x64')).toBe(false)
    expect(isSupportedDesktopTarget('linux', 'arm64')).toBe(false)
    expect(isSupportedDesktopTarget('win32', 'arm64')).toBe(false)
    expect(isSupportedDesktopTarget('freebsd', 'x64')).toBe(false)
  })
})

describe('parseGithubReleaseAssets', () => {
  it('treats missing assets as none and keeps a well-formed row', () => {
    expect(parseGithubReleaseAssets(undefined)).toEqual([])
    expect(parseGithubReleaseAssets([asset(WIN_NAME, 12)])).toEqual([asset(WIN_NAME, 12)])
  })

  it('rejects a malformed assets list', () => {
    expect(parseGithubReleaseAssets('nope')).toBeUndefined()
    expect(parseGithubReleaseAssets([null])).toBeUndefined()
    expect(parseGithubReleaseAssets([{ browser_download_url: 'u', size: 1 }])).toBeUndefined()
    expect(parseGithubReleaseAssets([{ name: '', browser_download_url: 'u', size: 1 }])).toBeUndefined()
    expect(parseGithubReleaseAssets([{ name: WIN_NAME, size: 1 }])).toBeUndefined()
    expect(parseGithubReleaseAssets([{ name: WIN_NAME, browser_download_url: '', size: 1 }])).toBeUndefined()
    expect(parseGithubReleaseAssets([{ name: WIN_NAME, browser_download_url: 'u', size: '1' }])).toBeUndefined()
    expect(parseGithubReleaseAssets([{ name: WIN_NAME, browser_download_url: 'u', size: Number.NaN }])).toBeUndefined()
    expect(parseGithubReleaseAssets([{ name: WIN_NAME, browser_download_url: 'u', size: Infinity }])).toBeUndefined()
    expect(parseGithubReleaseAssets([{ name: WIN_NAME, browser_download_url: 'u', size: -1 }])).toBeUndefined()
    expect(parseGithubReleaseAssets([{ name: WIN_NAME, browser_download_url: 'u', size: 1.5 }])).toBeUndefined()
  })
})

describe('pickReleaseAsset', () => {
  const assets = [
    asset('DeepSeek Harness-1.2.4-mac.zip'),
    asset('DeepSeek Harness-1.2.4.AppImage'),
    asset(WIN_NAME),
    asset('SHA256SUMS'),
  ]

  it('picks the archive for the packaged triple', () => {
    expect(pickReleaseAsset(assets, VERSION, 'darwin', 'arm64')?.name).toBe('DeepSeek Harness-1.2.4-mac.zip')
    expect(pickReleaseAsset(assets, VERSION, 'linux', 'x64')?.name).toBe('DeepSeek Harness-1.2.4.AppImage')
    expect(pickReleaseAsset(assets, VERSION, 'win32', 'x64')?.name).toBe(WIN_NAME)
  })

  it('returns undefined when the triple or name does not match', () => {
    expect(pickReleaseAsset(assets, VERSION, 'darwin', 'x64')).toBeUndefined()
    expect(pickReleaseAsset(assets, VERSION, 'linux', 'arm64')).toBeUndefined()
    expect(pickReleaseAsset(assets, '9.9.9', 'win32', 'x64')).toBeUndefined()
    expect(pickReleaseAsset([], VERSION, 'win32', 'x64')).toBeUndefined()
  })
})

describe('parseSha256Sums', () => {
  it('parses GNU text and binary lines and skips noise', () => {
    const text = [
      '# comment',
      `${HASH}  ${WIN_NAME}`,
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB *DeepSeek Harness-1.2.4-mac.zip',
      'not-a-hash  file.zip',
      `${HASH.slice(0, 63)}  short.zip`,
      '',
      '  # indented comment',
    ].join('\n')
    expect(parseSha256Sums(text)).toEqual({
      [WIN_NAME]: HASH,
      'DeepSeek Harness-1.2.4-mac.zip': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })
  })

  it('keeps the last duplicate name and ignores empty names', () => {
    const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    expect(parseSha256Sums(`${HASH}  ${WIN_NAME}\n${other}  ${WIN_NAME}\n${HASH} *\n`)).toEqual({
      [WIN_NAME]: other,
    })
  })

  it('accepts CRLF and a trailing newline from sha256sum', () => {
    expect(parseSha256Sums(`${HASH}  ${WIN_NAME}\r\n`)).toEqual({ [WIN_NAME]: HASH })
  })
})

describe('releaseWithArtifact', () => {
  const sums = `${HASH}  ${WIN_NAME}\n`

  it('attaches the matching archive when the checksum and URL are valid', () => {
    const attached = releaseWithArtifact(release(), [asset(WIN_NAME, 42), asset('SHA256SUMS')], REPO, 'win32', 'x64', sums)
    expect(attached.artifact).toEqual({
      name: WIN_NAME,
      url: asset(WIN_NAME, 42).browser_download_url,
      sha256: HASH,
      size: 42,
      platform: 'win32',
    })
  })

  it('leaves the release unchanged when the archive cannot be trusted', () => {
    expect(releaseWithArtifact(release(), [], REPO, 'win32', 'x64', sums).artifact).toBeUndefined()
    expect(releaseWithArtifact(release(), [asset(WIN_NAME)], REPO, 'darwin', 'x64', sums).artifact).toBeUndefined()
    expect(releaseWithArtifact(release(), [asset(WIN_NAME)], REPO, 'win32', 'x64', `${HASH}  other.zip\n`).artifact).toBeUndefined()
    const badUrl: GithubReleaseAsset = {
      ...asset(WIN_NAME),
      browser_download_url: 'https://example.test/DeepSeek%20Harness-1.2.4-win.zip',
    }
    expect(releaseWithArtifact(release(), [badUrl], REPO, 'win32', 'x64', sums).artifact).toBeUndefined()
  })
})

describe('attachDesktopArtifact', () => {
  const sums = `${HASH}  ${WIN_NAME}\n`

  function attachOptions(partial: Partial<Parameters<typeof attachDesktopArtifact>[0]> = {}) {
    return {
      release: release(),
      assets: [asset(WIN_NAME, 42), asset('SHA256SUMS')],
      repo: REPO,
      platform: 'win32',
      arch: 'x64',
      fetchImpl: (async () => new Response(sums, { status: 200 })) as typeof fetch,
      timeoutMs: 10_000,
      userAgent: 'dsh-product-update/1.2.3',
      ...partial,
    }
  }

  it('fetches SHA256SUMS and attaches the matching archive', async () => {
    const urls: string[] = []
    const attached = await attachDesktopArtifact(attachOptions({
      fetchImpl: async (input) => {
        urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        return new Response(sums, { status: 200 })
      },
    }))
    expect(urls).toEqual([asset('SHA256SUMS').browser_download_url])
    expect(attached.artifact?.sha256).toBe(HASH)
    expect(attached.artifact?.size).toBe(42)
    const withSignal = await attachDesktopArtifact(attachOptions({
      signal: new AbortController().signal,
    }))
    expect(withSignal.artifact?.sha256).toBe(HASH)
  })

  it('leaves artifact unset when the archive or checksum sidecar cannot be trusted', async () => {
    expect((await attachDesktopArtifact(attachOptions({ assets: [] }))).artifact).toBeUndefined()
    expect((await attachDesktopArtifact(attachOptions({ assets: [asset(WIN_NAME)] }))).artifact).toBeUndefined()
    const badSums: GithubReleaseAsset = {
      ...asset('SHA256SUMS'),
      browser_download_url: 'https://example.test/SHA256SUMS',
    }
    expect((await attachDesktopArtifact(attachOptions({
      assets: [asset(WIN_NAME), badSums],
    }))).artifact).toBeUndefined()
    const badArchive: GithubReleaseAsset = {
      ...asset(WIN_NAME),
      browser_download_url: 'https://example.test/DeepSeek%20Harness-1.2.4-win.zip',
    }
    expect((await attachDesktopArtifact(attachOptions({
      assets: [badArchive, asset('SHA256SUMS')],
    }))).artifact).toBeUndefined()
    expect((await attachDesktopArtifact(attachOptions({
      fetchImpl: async () => { throw new Error('offline') },
    }))).artifact).toBeUndefined()
    expect((await attachDesktopArtifact(attachOptions({
      fetchImpl: async () => new Response('nope', { status: 500 }),
    }))).artifact).toBeUndefined()
    expect((await attachDesktopArtifact(attachOptions({
      fetchImpl: async () => new Response(`${HASH}  other.zip\n`, { status: 200 }),
    }))).artifact).toBeUndefined()
  })

  it('rethrows AbortError from fetch and from reading the body', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    await expect(attachDesktopArtifact(attachOptions({
      fetchImpl: async () => { throw abort },
    }))).rejects.toMatchObject({ name: 'AbortError' })
    await expect(attachDesktopArtifact(attachOptions({
      fetchImpl: async () => ({
        ok: true,
        text: async () => { throw abort },
      }) as unknown as Response,
    }))).rejects.toMatchObject({ name: 'AbortError' })
    expect((await attachDesktopArtifact(attachOptions({
      fetchImpl: async () => ({
        ok: true,
        text: async () => { throw new Error('reset') },
      }) as unknown as Response,
    }))).artifact).toBeUndefined()
  })
})
