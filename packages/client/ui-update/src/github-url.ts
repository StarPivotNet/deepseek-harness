/** Shared https://github.com URL guard for persisted release links and window.open. */

/**
 * Whether `url` is an https GitHub link the Settings row may open.
 *
 * Only the exact `github.com` host is accepted: no http, no www, no lookalike
 * hostnames. Malformed strings fail closed.
 *
 * @param url - candidate release URL.
 * @returns `true` only for `https://github.com/...`.
 */
export function isGithubHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com'
  } catch {
    // TypeError: `url` is not a valid absolute URL.
    return false
  }
}

/**
 * Whether `url` is the GitHub Releases download URL for one asset.
 *
 * Accepts only `https://github.com/<repo>/releases/download/<tag>/<name>`
 * with no userinfo, port, query, hash, or extra path. Malformed strings fail closed.
 *
 * @param url - candidate `browser_download_url`.
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
