/** Desktop GitHub Release archive names, SHA256SUMS, and artifact attachment. */

import { isGithubReleaseDownloadUrl } from './github-url.ts'
import type { ProductRelease } from './releases.ts'

/** Platforms this updater can install. */
export const DESKTOP_UPDATE_PLATFORMS = ['darwin', 'linux', 'win32'] as const

/** One packaged desktop OS. */
export type DesktopUpdatePlatform = (typeof DESKTOP_UPDATE_PLATFORMS)[number]

/** Checksum sidecar uploaded beside the desktop archives. */
export const SHA256SUMS_NAME = 'SHA256SUMS'

/** One GitHub Release asset the installer may download. */
export interface GithubReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

/** Trusted archive the packaged desktop window may download. */
export interface ProductReleaseArtifact {
  name: string
  url: string
  sha256: string
  size: number
  platform: DesktopUpdatePlatform
}

/**
 * Archive filename electron-builder writes for one version and platform.
 *
 * @param version - desktop package version.
 * @param platform - packaged OS.
 * @returns the GitHub Release asset name.
 */
export function desktopArtifactName(version: string, platform: DesktopUpdatePlatform): string {
  switch (platform) {
    case 'darwin':
      return `DeepSeek Harness-${version}-mac.zip`
    case 'linux':
      return `DeepSeek Harness-${version}.AppImage`
    case 'win32':
      return `DeepSeek Harness-${version}-win.zip`
    default: {
      const exhaustive: never = platform
      throw new Error(`desktop update: unsupported platform ${String(exhaustive)}`)
    }
  }
}

/**
 * Whether this Host can install a packaged desktop archive for `platform`/`arch`.
 *
 * @param platform - Node platform string.
 * @param arch - Node arch string.
 * @returns `true` only for darwin/arm64, linux/x64, and win32/x64.
 */
export function isSupportedDesktopTarget(platform: string, arch: string): boolean {
  if (platform === 'darwin') return arch === 'arm64'
  if (platform === 'linux') return arch === 'x64'
  if (platform === 'win32') return arch === 'x64'
  return false
}

/**
 * Narrow unknown JSON to GitHub Release assets.
 *
 * Missing `assets` is an empty list. A present but malformed list fails closed.
 *
 * @param json - `assets` field from one GitHub Releases row.
 * @returns the narrowed assets, or `undefined` when the shape is invalid.
 */
export function parseGithubReleaseAssets(json: unknown): GithubReleaseAsset[] | undefined {
  if (json === undefined) return []
  if (!Array.isArray(json)) return undefined
  const out: GithubReleaseAsset[] = []
  for (const row of json) {
    if (row === null || typeof row !== 'object') return undefined
    const rec = row as Record<string, unknown>
    if (typeof rec.name !== 'string' || rec.name === '') return undefined
    if (typeof rec.browser_download_url !== 'string' || rec.browser_download_url === '') return undefined
    if (typeof rec.size !== 'number' || !Number.isInteger(rec.size) || rec.size < 0) return undefined
    out.push({
      name: rec.name,
      browser_download_url: rec.browser_download_url,
      size: rec.size,
    })
  }
  return out
}

/**
 * Pick the archive for this Host's packaged triple.
 *
 * @param assets - GitHub Release assets.
 * @param version - release version (no `desktop-v` prefix).
 * @param platform - Node platform.
 * @param arch - Node arch.
 * @returns the matching asset, or `undefined`.
 */
export function pickReleaseAsset(
  assets: readonly GithubReleaseAsset[],
  version: string,
  platform: string,
  arch: string,
): GithubReleaseAsset | undefined {
  if (!isSupportedDesktopTarget(platform, arch)) return undefined
  const name = desktopArtifactName(version, platform as DesktopUpdatePlatform)
  return assets.find(asset => asset.name === name)
}

/**
 * Parse GNU `sha256sum` text (`HASH  name` or `HASH *name`).
 *
 * Comment and malformed lines are skipped. Duplicate names keep the last hash.
 *
 * @param text - SHA256SUMS body.
 * @returns filename → lowercase hex digest.
 */
export function parseSha256Sums(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^([0-9a-fA-F]{64}) (?: |\*)(.*)$/.exec(line)
    if (match === null) continue
    const digest = match[1]
    const name = match[2]
    if (digest === undefined || name === undefined || name === '') continue
    out[name] = digest.toLowerCase()
  }
  return out
}

/**
 * Attach a trusted artifact when the archive name, download URL, and checksum match.
 *
 * @param release - product release without an artifact.
 * @param assets - GitHub assets for that tag.
 * @param repo - `owner/repo` the URL must name.
 * @param platform - Node platform.
 * @param arch - Node arch.
 * @param sumsText - SHA256SUMS body.
 * @returns the release, with `artifact` only when every check passes.
 */
export function releaseWithArtifact(
  release: ProductRelease,
  assets: readonly GithubReleaseAsset[],
  repo: string,
  platform: string,
  arch: string,
  sumsText: string,
): ProductRelease {
  const picked = pickReleaseAsset(assets, release.version, platform, arch)
  if (picked === undefined) return release
  if (!isGithubReleaseDownloadUrl(picked.browser_download_url, repo, release.tag, picked.name)) {
    return release
  }
  const sha256 = parseSha256Sums(sumsText)[picked.name]
  if (sha256 === undefined) return release
  return {
    ...release,
    artifact: {
      name: picked.name,
      url: picked.browser_download_url,
      sha256,
      size: picked.size,
      platform: platform as DesktopUpdatePlatform,
    },
  }
}

/**
 * Fetch SHA256SUMS and attach the matching archive. Any failure leaves `artifact` unset.
 * Caller abort still throws.
 *
 * @param options - release row, fetch seam, and Host platform.
 * @returns the release, possibly with `artifact`.
 */
export async function attachDesktopArtifact(options: {
  release: ProductRelease
  assets: readonly GithubReleaseAsset[]
  repo: string
  platform: string
  arch: string
  fetchImpl: typeof fetch
  timeoutMs: number
  signal?: AbortSignal
  userAgent: string
}): Promise<ProductRelease> {
  const picked = pickReleaseAsset(options.assets, options.release.version, options.platform, options.arch)
  if (picked === undefined) return options.release
  const sumsAsset = options.assets.find(asset => asset.name === SHA256SUMS_NAME)
  if (sumsAsset === undefined) return options.release
  if (!isGithubReleaseDownloadUrl(sumsAsset.browser_download_url, options.repo, options.release.tag, SHA256SUMS_NAME)) {
    return options.release
  }
  if (!isGithubReleaseDownloadUrl(picked.browser_download_url, options.repo, options.release.tag, picked.name)) {
    return options.release
  }
  let response: Response
  try {
    response = await options.fetchImpl(sumsAsset.browser_download_url, {
      headers: {
        Accept: 'text/plain',
        'User-Agent': options.userAgent,
      },
      signal: options.signal === undefined
        ? AbortSignal.timeout(options.timeoutMs)
        : AbortSignal.any([AbortSignal.timeout(options.timeoutMs), options.signal]),
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    return options.release
  }
  if (!response.ok) return options.release
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    if (isAbortError(error)) throw error
    return options.release
  }
  return releaseWithArtifact(
    options.release,
    options.assets,
    options.repo,
    options.platform,
    options.arch,
    text,
  )
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
