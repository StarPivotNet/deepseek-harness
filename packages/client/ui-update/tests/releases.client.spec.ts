import { describe, expect, it } from 'vitest'
import { githubReleasesUrl, parseGithubReleases, pickLatestRelease, type GithubRelease } from '../src/releases.ts'

function release(partial: Partial<GithubRelease> & Pick<GithubRelease, 'tag_name'>): GithubRelease {
  return {
    html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/' + partial.tag_name,
    draft: false,
    prerelease: false,
    body: 'notes',
    assets: [],
    ...partial,
  }
}

describe('parseGithubReleases', () => {
  it('accepts a well-formed array and rejects a malformed row', () => {
    expect(parseGithubReleases([release({ tag_name: 'dsh-v1.0.0', body: null })])).toEqual([
      release({ tag_name: 'dsh-v1.0.0', body: null }),
    ])
    expect(parseGithubReleases('nope')).toBeUndefined()
    expect(parseGithubReleases([null])).toBeUndefined()
    expect(parseGithubReleases([{ tag_name: '' }])).toBeUndefined()
    expect(parseGithubReleases([{ tag_name: 'dsh-v1.0.0', html_url: '', draft: false, prerelease: false, body: null }])).toBeUndefined()
    expect(parseGithubReleases([{ tag_name: 'dsh-v1.0.0', html_url: 'u', draft: 'no', prerelease: false, body: null }])).toBeUndefined()
    expect(parseGithubReleases([{ tag_name: 'dsh-v1.0.0', html_url: 'u', draft: false, prerelease: 1, body: null }])).toBeUndefined()
    expect(parseGithubReleases([{ tag_name: 'dsh-v1.0.0', html_url: 'u', draft: false, prerelease: false, body: 1 }])).toBeUndefined()
    expect(parseGithubReleases([{
      tag_name: 'dsh-v1.0.0',
      html_url: 'u',
      draft: false,
      prerelease: false,
      body: null,
      assets: [{ name: 'x.zip' }],
    }])).toBeUndefined()
  })

  it('treats missing assets as none', () => {
    expect(parseGithubReleases([{
      tag_name: 'dsh-v1.0.0',
      html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v1.0.0',
      draft: false,
      prerelease: false,
      body: null,
    }])).toEqual([release({ tag_name: 'dsh-v1.0.0', body: null })])
  })
})

describe('pickLatestRelease', () => {
  it('skips drafts, other prefixes, non-semver remainders, and older tags', () => {
    const picked = pickLatestRelease([
      release({ tag_name: 'dsh-v1.2.4', draft: true }),
      release({ tag_name: 'desktop-v9.9.9' }),
      release({ tag_name: 'dsh-vnot-semver' }),
      release({ tag_name: 'dsh-v1.2.3' }),
      release({ tag_name: 'dsh-v1.2.5' }),
      release({ tag_name: 'dsh-v1.2.6' }),
    ], '1.2.3', 'dsh-v')
    expect(picked?.tag).toBe('dsh-v1.2.6')
    expect(picked?.version).toBe('1.2.6')
  })

  it('skips GitHub prereleases unless the installed version is a prerelease', () => {
    const rows = [
      release({ tag_name: 'dsh-v1.2.4-rc.1', prerelease: true, body: null }),
      release({ tag_name: 'dsh-v1.2.3' }),
    ]
    expect(pickLatestRelease(rows, '1.2.3', 'dsh-v')).toBeUndefined()
    expect(pickLatestRelease(rows, '1.2.3-rc.0', 'dsh-v')?.version).toBe('1.2.4-rc.1')
  })

  it('skips a newer tag whose html_url is not https://github.com', () => {
    expect(pickLatestRelease([
      release({
        tag_name: 'dsh-v1.2.4',
        html_url: 'https://example.test/releases/tag/dsh-v1.2.4',
      }),
    ], '1.2.3', 'dsh-v')).toBeUndefined()
  })
})

describe('githubReleasesUrl', () => {
  it('accepts owner/repo and rejects extra path segments', () => {
    expect(githubReleasesUrl('deepseek-ai/deepseek-harness'))
      .toBe('https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=30')
    expect(githubReleasesUrl('a/b/c')).toBeUndefined()
    expect(githubReleasesUrl('')).toBeUndefined()
  })
})
