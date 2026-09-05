/**
 * GitHub Releases download URL guard used before Electron fetches an archive.
 * @module @deepseek-ai/dsh-desktop/update-url
 */

/** Default GitHub `owner/repo` for packaged desktop (`desktop-v*`) releases. */
export const DEFAULT_DESKTOP_UPDATE_REPO = 'StarPivotNet/deepseek-harness'

/**
 * Whether `url` is the GitHub Releases download URL for one asset.
 *
 * Accepts only `https://github.com/<repo>/releases/download/<tag>/<name>`
 * with no userinfo, port, query, hash, or extra path. Malformed strings fail closed.
 *
 * @param url - candidate download URL.
 * @param repo - `owner/repo`.
 * @param tag - GitHub release tag.
 * @param name - asset filename (decoded).
 * @returns `true` only for that exact download URL.
 */
export function isGithubReleaseDownloadUrl(
  url: string,
  repo: string,
  tag: string,
  name: string,
): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (parsed.hostname !== 'github.com') return false
    if (parsed.username !== '' || parsed.password !== '') return false
    if (parsed.port !== '') return false
    if (parsed.search !== '') return false
    if (parsed.hash !== '') return false
    const parts = parsed.pathname.split('/')
    if (parts.length !== 7 || parts[0] !== '') return false
    if (parts[3] !== 'releases' || parts[4] !== 'download') return false
    const owner = decodeURIComponent(parts[1] ?? '')
    const repoName = decodeURIComponent(parts[2] ?? '')
    if (`${owner}/${repoName}` !== repo) return false
    if (decodeURIComponent(parts[5] ?? '') !== tag) return false
    if (decodeURIComponent(parts[6] ?? '') !== name) return false
    return true
  } catch {
    // TypeError: `url` is not a valid absolute URL, or a path segment is not decodable.
    return false
  }
}

/** Platforms this updater can install. */
export const DESKTOP_UPDATE_PLATFORMS = ['darwin', 'linux', 'win32'] as const

/** One packaged desktop OS. */
export type DesktopUpdatePlatform = (typeof DESKTOP_UPDATE_PLATFORMS)[number]

/** Trusted archive the packaged desktop window may download. */
export interface DesktopUpdateArtifact {
  name: string
  url: string
  sha256: string
  size: number
  platform: DesktopUpdatePlatform
}

/** Renderer → main install request. */
export interface DesktopInstallRequest {
  tag: string
  version: string
  artifact: DesktopUpdateArtifact
}

const SHA256_HEX = /^[0-9a-f]{64}$/

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
 * Narrow unknown IPC payload to an install request for this Host.
 *
 * @param value - renderer payload.
 * @param repo - pinned GitHub `owner/repo`.
 * @param platform - this process's platform.
 * @returns the request, or `undefined` when it cannot be trusted.
 */
export function readInstallRequest(
  value: unknown,
  repo: string,
  platform: string,
): DesktopInstallRequest | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const rec = value as Record<string, unknown>
  if (typeof rec.tag !== 'string' || rec.tag === '') return undefined
  if (typeof rec.version !== 'string' || rec.version === '') return undefined
  if (rec.artifact === null || typeof rec.artifact !== 'object') return undefined
  const artifact = rec.artifact as Record<string, unknown>
  if (typeof artifact.name !== 'string' || artifact.name === '') return undefined
  if (typeof artifact.url !== 'string' || artifact.url === '') return undefined
  if (typeof artifact.sha256 !== 'string' || !SHA256_HEX.test(artifact.sha256)) return undefined
  if (typeof artifact.size !== 'number' || !Number.isInteger(artifact.size) || artifact.size <= 0) return undefined
  if (artifact.platform !== 'darwin' && artifact.platform !== 'linux' && artifact.platform !== 'win32') {
    return undefined
  }
  if (artifact.platform !== platform) return undefined
  if (artifact.name !== desktopArtifactName(rec.version, artifact.platform)) return undefined
  if (!isGithubReleaseDownloadUrl(artifact.url, repo, rec.tag, artifact.name)) return undefined
  return {
    tag: rec.tag,
    version: rec.version,
    artifact: {
      name: artifact.name,
      url: artifact.url,
      sha256: artifact.sha256,
      size: artifact.size,
      platform: artifact.platform,
    },
  }
}
