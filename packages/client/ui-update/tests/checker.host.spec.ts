import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  checkProductUpdate,
  DEFAULT_CHECK_INTERVAL_MS,
  ProductUpdateCheckError,
  type ProductUpdateCheckerOptions,
} from '../src/checker.ts'
import type { ProductCheckResult, ProductUpdateSettings } from '../src/update-settings.ts'

const NOW = 1_700_000_000_000
const BODY = JSON.stringify([{
  tag_name: 'dsh-v1.2.4',
  html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v1.2.4',
  draft: false,
  prerelease: false,
  body: 'notes',
}])
const HASH = createHash('sha256').update(BODY).digest('hex')

function cached(): ProductCheckResult {
  return {
    available: true,
    currentVersion: '1.2.3',
    latest: {
      tag: 'dsh-v1.2.4',
      version: '1.2.4',
      url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v1.2.4',
      notes: 'notes',
    },
    checkedAt: NOW - 1_000,
    channel: 'dsh',
  }
}

function options(partial: Partial<ProductUpdateCheckerOptions> & {
  settings?: ProductUpdateSettings
  fetchImpl?: typeof fetch
} = {}): ProductUpdateCheckerOptions & { writes: ProductUpdateSettings[] } {
  let settings = partial.settings ?? {}
  const writes: ProductUpdateSettings[] = []
  const next: ProductUpdateCheckerOptions & { writes: ProductUpdateSettings[] } = {
    env: { DSH_PRODUCT_VERSION: '1.2.3' },
    now: () => NOW,
    fetch: partial.fetchImpl ?? (async () => new Response(BODY, {
      status: 200,
      headers: { etag: '"abc"' },
    })),
    readSettings: () => settings,
    writeSettings: async (value) => {
      settings = value
      writes.push(value)
    },
    writes,
    ...partial.fetchImpl === undefined ? {} : { fetch: partial.fetchImpl },
    ...partial.env === undefined ? {} : { env: partial.env },
    ...partial.repo === undefined ? {} : { repo: partial.repo },
    ...partial.channel === undefined ? {} : { channel: partial.channel },
    ...partial.intervalMs === undefined ? {} : { intervalMs: partial.intervalMs },
    ...partial.timeoutMs === undefined ? {} : { timeoutMs: partial.timeoutMs },
    ...partial.requireFn === undefined ? {} : { requireFn: partial.requireFn },
    ...partial.now === undefined ? {} : { now: partial.now },
    ...partial.signal === undefined ? {} : { signal: partial.signal },
  }
  return next
}

describe('checkProductUpdate', () => {
  it('picks the newest applicable release and persists etag plus body hash', async () => {
    const opts = options()
    const result = await checkProductUpdate(opts)
    expect(result.available).toBe(true)
    expect(result.latest?.version).toBe('1.2.4')
    expect(opts.writes[0]?.lastCheckEtag).toBe('"abc"')
    expect(opts.writes[0]?.lastCheckBodyHash).toBe(HASH)
  })

  it('omits lastCheckEtag when GitHub sends none and none was cached', async () => {
    const opts = options({
      fetchImpl: async () => new Response(BODY, { status: 200 }),
    })
    await checkProductUpdate(opts)
    expect(opts.writes[0]).not.toHaveProperty('lastCheckEtag')
    expect(opts.writes[0]?.lastCheckBodyHash).toBe(HASH)
  })

  it('reuses lastResult inside the interval unless force is set', async () => {
    let fetched = 0
    const opts = options({
      settings: { lastCheckAt: NOW - 1_000, lastResult: cached() },
      fetchImpl: async () => {
        fetched += 1
        return new Response(BODY, { status: 200 })
      },
    })
    const reused = await checkProductUpdate(opts)
    expect(reused.available).toBe(true)
    expect(fetched).toBe(0)
    const forced = await checkProductUpdate(opts, true)
    expect(forced.available).toBe(true)
    expect(fetched).toBe(1)
  })

  it('treats 304 as a cache hit and writes a refreshed checkedAt', async () => {
    const opts = options({
      settings: {
        lastCheckAt: NOW - DEFAULT_CHECK_INTERVAL_MS - 1,
        lastCheckEtag: '"abc"',
        lastCheckBodyHash: HASH,
        lastResult: cached(),
      },
      fetchImpl: async () => new Response(null, { status: 304 }),
    })
    const result = await checkProductUpdate(opts)
    expect(result.checkedAt).toBe(NOW)
    expect(result.available).toBe(true)
    expect(opts.writes[0]?.lastCheckEtag).toBe('"abc"')
    expect(opts.writes[0]?.lastCheckBodyHash).toBe(HASH)
  })

  it('throws when GitHub returns 304 without a cached result', async () => {
    const opts = options({ fetchImpl: async () => new Response(null, { status: 304 }) })
    await expect(checkProductUpdate(opts)).rejects.toThrow(ProductUpdateCheckError)
  })

  it('reuses lastResult on a 403 remaining=0 rate limit', async () => {
    const opts = options({
      settings: { lastCheckAt: NOW - DEFAULT_CHECK_INTERVAL_MS - 1, lastResult: cached() },
      fetchImpl: async () => new Response('limited', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      }),
    })
    expect((await checkProductUpdate(opts)).available).toBe(true)
  })

  it('throws on a rate limit without a cached result', async () => {
    const opts = options({
      fetchImpl: async () => new Response('limited', {
        status: 429,
        headers: { 'x-ratelimit-remaining': '0' },
      }),
    })
    await expect(checkProductUpdate(opts)).rejects.toMatchObject({ message: 'GitHub rate limit exceeded' })
  })

  it('falls back to lastResult on a network error inside 24h', async () => {
    const opts = options({
      settings: { lastCheckAt: NOW - 1_000, lastResult: cached() },
      intervalMs: 1,
      fetchImpl: async () => { throw new Error('offline') },
    })
    expect((await checkProductUpdate(opts)).available).toBe(true)
  })

  it('throws on a network error without a fresh cache', async () => {
    const opts = options({ fetchImpl: async () => { throw new Error('offline') } })
    await expect(checkProductUpdate(opts)).rejects.toMatchObject({ message: 'offline' })
  })

  it('throws on a non-Error network failure without a cache', async () => {
    const opts = options({ fetchImpl: async () => { throw 'offline' } })
    await expect(checkProductUpdate(opts)).rejects.toMatchObject({ message: 'offline' })
  })

  it('reuses lastResult when the body hash matches', async () => {
    const opts = options({
      settings: {
        lastCheckAt: NOW - DEFAULT_CHECK_INTERVAL_MS - 1,
        lastCheckBodyHash: HASH,
        lastResult: cached(),
      },
    })
    const result = await checkProductUpdate(opts)
    expect(result.checkedAt).toBe(NOW)
    expect(opts.writes[0]?.lastCheckBodyHash).toBe(HASH)
  })

  it('throws on an invalid repo and on a malformed JSON body without a cache', async () => {
    await expect(checkProductUpdate(options({ repo: 'not-a-repo' }))).rejects.toMatchObject({
      message: 'invalid update repository',
    })
    const badJson = options({ fetchImpl: async () => new Response('{', { status: 200 }) })
    await expect(checkProductUpdate(badJson)).rejects.toMatchObject({
      message: 'GitHub releases body is not JSON',
    })
    const badList = options({ fetchImpl: async () => new Response('{}', { status: 200 }) })
    await expect(checkProductUpdate(badList)).rejects.toMatchObject({
      message: 'GitHub releases body is not a release list',
    })
  })

  it('falls back to lastResult on HTTP and parse failures inside 24h', async () => {
    const http = options({
      settings: { lastCheckAt: NOW - 1_000, lastResult: cached() },
      intervalMs: 1,
      fetchImpl: async () => new Response('nope', { status: 500 }),
    })
    expect((await checkProductUpdate(http)).available).toBe(true)
    const parse = options({
      settings: { lastCheckAt: NOW - 1_000, lastResult: cached() },
      intervalMs: 1,
      fetchImpl: async () => new Response('{', { status: 200 }),
    })
    expect((await checkProductUpdate(parse)).available).toBe(true)
  })

  it('clears available when the latest tag was dismissed', async () => {
    const opts = options({ settings: { dismissedTag: 'dsh-v1.2.4' } })
    expect((await checkProductUpdate(opts)).available).toBe(false)
    expect((await checkProductUpdate(opts)).latest?.tag).toBe('dsh-v1.2.4')
  })

  it('polls the StarPivot feed when the channel is desktop', async () => {
    const urls: string[] = []
    const body = JSON.stringify([{
      tag_name: 'desktop-v1.2.4',
      html_url: 'https://github.com/StarPivotNet/deepseek-harness/releases/tag/desktop-v1.2.4',
      draft: false,
      prerelease: false,
      body: 'notes',
    }])
    const opts = options({
      env: { DSH_PRODUCT_VERSION: '1.2.3', DSH_PRODUCT_CHANNEL: 'desktop' },
      fetchImpl: async (input) => {
        urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        return new Response(body, { status: 200 })
      },
    })
    const result = await checkProductUpdate(opts)
    expect(urls[0]).toContain('StarPivotNet/deepseek-harness')
    expect(result.channel).toBe('desktop')
    expect(result.latest?.tag).toBe('desktop-v1.2.4')
    expect(result.latest?.artifact).toBeUndefined()
  })

  it('attaches the matching desktop archive when SHA256SUMS verifies', async () => {
    const hash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const name = 'DeepSeek Harness-1.2.4-win.zip'
    const download = (file: string): string =>
      `https://github.com/StarPivotNet/deepseek-harness/releases/download/desktop-v1.2.4/${encodeURIComponent(file)}`
    const body = JSON.stringify([{
      tag_name: 'desktop-v1.2.4',
      html_url: 'https://github.com/StarPivotNet/deepseek-harness/releases/tag/desktop-v1.2.4',
      draft: false,
      prerelease: false,
      body: 'notes',
      assets: [
        { name, browser_download_url: download(name), size: 42 },
        { name: 'SHA256SUMS', browser_download_url: download('SHA256SUMS'), size: 80 },
      ],
    }])
    const urls: string[] = []
    const opts = options({
      env: { DSH_PRODUCT_VERSION: '1.2.3', DSH_PRODUCT_CHANNEL: 'desktop' },
      fetchImpl: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        urls.push(url)
        if (url.endsWith('/SHA256SUMS')) return new Response(`${hash}  ${name}\n`, { status: 200 })
        return new Response(body, { status: 200 })
      },
    })
    const result = await checkProductUpdate({ ...opts, platform: 'win32', arch: 'x64' })
    expect(urls.some(url => url.endsWith('/SHA256SUMS'))).toBe(true)
    expect(result.latest?.artifact).toEqual({
      name,
      url: download(name),
      sha256: hash,
      size: 42,
      platform: 'win32',
    })
  })

  it('keeps the desktop tag available when SHA256SUMS cannot be fetched', async () => {
    const name = 'DeepSeek Harness-1.2.4-win.zip'
    const download = (file: string): string =>
      `https://github.com/StarPivotNet/deepseek-harness/releases/download/desktop-v1.2.4/${encodeURIComponent(file)}`
    const body = JSON.stringify([{
      tag_name: 'desktop-v1.2.4',
      html_url: 'https://github.com/StarPivotNet/deepseek-harness/releases/tag/desktop-v1.2.4',
      draft: false,
      prerelease: false,
      body: 'notes',
      assets: [
        { name, browser_download_url: download(name), size: 42 },
        { name: 'SHA256SUMS', browser_download_url: download('SHA256SUMS'), size: 80 },
      ],
    }])
    const opts = options({
      env: { DSH_PRODUCT_VERSION: '1.2.3', DSH_PRODUCT_CHANNEL: 'desktop' },
      fetchImpl: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.endsWith('/SHA256SUMS')) return new Response('nope', { status: 500 })
        return new Response(body, { status: 200 })
      },
    })
    const result = await checkProductUpdate({ ...opts, platform: 'win32', arch: 'x64' })
    expect(result.available).toBe(true)
    expect(result.latest?.tag).toBe('desktop-v1.2.4')
    expect(result.latest?.artifact).toBeUndefined()
  })

  it('does not attach an archive on the CLI channel', async () => {
    const name = 'DeepSeek Harness-1.2.4-win.zip'
    const body = JSON.stringify([{
      tag_name: 'dsh-v1.2.4',
      html_url: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v1.2.4',
      draft: false,
      prerelease: false,
      body: 'notes',
      assets: [
        {
          name,
          browser_download_url: `https://github.com/deepseek-ai/deepseek-harness/releases/download/dsh-v1.2.4/${encodeURIComponent(name)}`,
          size: 42,
        },
      ],
    }])
    const opts = options({
      fetchImpl: async () => new Response(body, { status: 200 }),
    })
    const result = await checkProductUpdate({ ...opts, platform: 'win32', arch: 'x64' })
    expect(result.latest?.artifact).toBeUndefined()
  })

  it('rethrows when SHA256SUMS fetch is aborted', async () => {
    const name = 'DeepSeek Harness-1.2.4-win.zip'
    const download = (file: string): string =>
      `https://github.com/StarPivotNet/deepseek-harness/releases/download/desktop-v1.2.4/${encodeURIComponent(file)}`
    const body = JSON.stringify([{
      tag_name: 'desktop-v1.2.4',
      html_url: 'https://github.com/StarPivotNet/deepseek-harness/releases/tag/desktop-v1.2.4',
      draft: false,
      prerelease: false,
      body: 'notes',
      assets: [
        { name, browser_download_url: download(name), size: 42 },
        { name: 'SHA256SUMS', browser_download_url: download('SHA256SUMS'), size: 80 },
      ],
    }])
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const opts = options({
      env: { DSH_PRODUCT_VERSION: '1.2.3', DSH_PRODUCT_CHANNEL: 'desktop' },
      fetchImpl: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.endsWith('/SHA256SUMS')) throw abort
        return new Response(body, { status: 200 })
      },
    })
    await expect(checkProductUpdate({ ...opts, platform: 'win32', arch: 'x64' }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(opts.writes).toEqual([])
  })

  it('throws when the caller aborts before fetch', async () => {
    const controller = new AbortController()
    controller.abort()
    const opts = options({
      signal: controller.signal,
      fetchImpl: async () => {
        throw new Error('must not fetch')
      },
    })
    await expect(checkProductUpdate(opts)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('throws when the caller aborts during fetch', async () => {
    const controller = new AbortController()
    const opts = options({
      signal: controller.signal,
      fetchImpl: async (_input, init) => {
        controller.abort()
        const err = new Error('aborted')
        err.name = 'AbortError'
        init?.signal?.throwIfAborted?.()
        throw err
      },
    })
    await expect(checkProductUpdate(opts)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not write settings after aborting a completed fetch', async () => {
    const controller = new AbortController()
    const opts = options({
      signal: controller.signal,
      fetchImpl: async () => {
        controller.abort()
        return new Response(BODY, { status: 200 })
      },
    })
    await expect(checkProductUpdate(opts)).rejects.toMatchObject({ name: 'AbortError' })
    expect(opts.writes).toEqual([])
  })

  it('reports no update when the feed has nothing newer', async () => {
    const body = JSON.stringify([{
      tag_name: 'dsh-v1.2.3',
      html_url: 'https://example.test/1.2.3',
      draft: false,
      prerelease: false,
      body: '',
    }])
    const opts = options({ fetchImpl: async () => new Response(body, { status: 200 }) })
    const result = await checkProductUpdate(opts)
    expect(result.available).toBe(false)
    expect(result.latest).toBeUndefined()
  })
})
