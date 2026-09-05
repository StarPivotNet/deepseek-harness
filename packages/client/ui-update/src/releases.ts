/** GitHub Releases JSON → the newest applicable product release. */

import { parseGithubReleaseAssets, type GithubReleaseAsset, type ProductReleaseArtifact } from './artifact.ts'
import { isGithubHttpsUrl } from './github-url.ts'
import { isNewer, isPrereleaseVersion, parseSemver } from './semver.ts'

export type { GithubReleaseAsset, ProductReleaseArtifact }

/** One GitHub Releases API row, narrowed to the fields the picker reads. */
export interface GithubRelease {
  tag_name: string
  html_url: string
  draft: boolean
  prerelease: boolean
  body: string | null
  assets: GithubReleaseAsset[]
}

/** Product-facing release the checker persists and the UI renders. */
export interface ProductRelease {
  tag: string
  version: string
  url: string
  notes: string
  artifact?: ProductReleaseArtifact
}

/**
 * Narrow unknown JSON to a GitHub Releases array.
 *
 * @param json - parsed response body.
 * @returns the narrowed rows, or `undefined` when the shape is not an array of releases.
 */
export function parseGithubReleases(json: unknown): GithubRelease[] | undefined {
  if (!Array.isArray(json)) return undefined
  const out: GithubRelease[] = []
  for (const row of json) {
    if (row === null || typeof row !== 'object') return undefined
    const rec = row as Record<string, unknown>
    if (typeof rec.tag_name !== 'string' || rec.tag_name === '') return undefined
    if (typeof rec.html_url !== 'string' || rec.html_url === '') return undefined
    if (typeof rec.draft !== 'boolean') return undefined
    if (typeof rec.prerelease !== 'boolean') return undefined
    if (rec.body !== null && typeof rec.body !== 'string') return undefined
    const assets = parseGithubReleaseAssets(rec.assets)
    if (assets === undefined) return undefined
    out.push({
      tag_name: rec.tag_name,
      html_url: rec.html_url,
      draft: rec.draft,
      prerelease: rec.prerelease,
      body: rec.body,
      assets,
    })
  }
  return out
}

/**
 * Pick the newest applicable release for the installed version and tag prefix.
 *
 * Skips drafts, tags that do not start with `prefix`, non-SemVer remainders,
 * GitHub prereleases unless the installed version is itself a prerelease,
 * html_url values that are not `https://github.com/...`, and versions that
 * are not strictly newer than `currentVersion`.
 *
 * @param releases - narrowed GitHub rows.
 * @param currentVersion - installed product version.
 * @param prefix - `dsh-v` or `desktop-v`.
 * @returns the newest matching release, or `undefined` when none apply.
 */
export function pickLatestRelease(
  releases: readonly GithubRelease[],
  currentVersion: string,
  prefix: string,
): ProductRelease | undefined {
  const currentIsPre = isPrereleaseVersion(currentVersion)
  let best: ProductRelease | undefined
  for (const release of releases) {
    if (release.draft) continue
    if (!release.tag_name.startsWith(prefix)) continue
    const version = release.tag_name.slice(prefix.length)
    if (parseSemver(version) === undefined) continue
    if (release.prerelease && !currentIsPre) continue
    if (!isGithubHttpsUrl(release.html_url)) continue
    if (!isNewer(version, currentVersion)) continue
    if (best === undefined || isNewer(version, best.version)) {
      best = {
        tag: release.tag_name,
        version,
        url: release.html_url,
        notes: release.body ?? '',
      }
    }
  }
  return best
}

/** Owner/repo shape accepted by the GitHub Releases URL. */
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/**
 * Build the GitHub Releases list URL for a `owner/repo` string.
 *
 * @param repo - `owner/repo`.
 * @returns the URL, or `undefined` when `repo` is not a single owner/name pair.
 */
export function githubReleasesUrl(repo: string): string | undefined {
  if (!REPO_PATTERN.test(repo)) return undefined
  return `https://api.github.com/repos/${repo}/releases?per_page=30`
}
