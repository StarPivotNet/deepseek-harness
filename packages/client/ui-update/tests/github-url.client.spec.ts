import { describe, expect, it } from 'vitest'
import { isGithubHttpsUrl, isGithubReleaseDownloadUrl } from '../src/github-url.ts'

describe('isGithubHttpsUrl', () => {
  it('accepts only https://github.com/...', () => {
    expect(isGithubHttpsUrl('https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v1.2.4')).toBe(true)
    expect(isGithubHttpsUrl('http://github.com/deepseek-ai/deepseek-harness')).toBe(false)
    expect(isGithubHttpsUrl('https://www.github.com/deepseek-ai/deepseek-harness')).toBe(false)
    expect(isGithubHttpsUrl('https://github.example/deepseek-ai/deepseek-harness')).toBe(false)
    expect(isGithubHttpsUrl('https://github.com.evil.test/x')).toBe(false)
    expect(isGithubHttpsUrl('not-a-url')).toBe(false)
  })
})

describe('isGithubReleaseDownloadUrl', () => {
  const repo = 'StarPivotNet/deepseek-harness'
  const tag = 'desktop-v1.2.4'
  const name = 'DeepSeek Harness-1.2.4-win.zip'
  const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`

  it('accepts the GitHub download URL for that repo, tag, and name', () => {
    expect(isGithubReleaseDownloadUrl(url, repo, tag, name)).toBe(true)
  })

  it('rejects lookalikes and mismatched fields', () => {
    expect(isGithubReleaseDownloadUrl(url.replace('https://', 'http://'), repo, tag, name)).toBe(false)
    expect(isGithubReleaseDownloadUrl(url.replace('github.com', 'www.github.com'), repo, tag, name)).toBe(false)
    expect(isGithubReleaseDownloadUrl(`${url}?raw=1`, repo, tag, name)).toBe(false)
    expect(isGithubReleaseDownloadUrl(`${url}#x`, repo, tag, name)).toBe(false)
    expect(isGithubReleaseDownloadUrl(`${url}/extra`, repo, tag, name)).toBe(false)
    expect(isGithubReleaseDownloadUrl(url, 'other/repo', tag, name)).toBe(false)
    expect(isGithubReleaseDownloadUrl(url, repo, 'desktop-v9.9.9', name)).toBe(false)
    expect(isGithubReleaseDownloadUrl(url, repo, tag, 'other.zip')).toBe(false)
    expect(isGithubReleaseDownloadUrl('https://example.test/x', repo, tag, name)).toBe(false)
    expect(isGithubReleaseDownloadUrl('not-a-url', repo, tag, name)).toBe(false)
    expect(isGithubReleaseDownloadUrl(
      `https://user@github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`,
      repo,
      tag,
      name,
    )).toBe(false)
    expect(isGithubReleaseDownloadUrl(
      `https://github.com:80/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`,
      repo,
      tag,
      name,
    )).toBe(false)
    expect(isGithubReleaseDownloadUrl(
      `https://github.com/${repo}/releases/download/${tag}/%ZZ`,
      repo,
      tag,
      name,
    )).toBe(false)
  })
})
