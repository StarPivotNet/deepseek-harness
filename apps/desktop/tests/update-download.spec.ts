import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { downloadVerifiedFile } from '../src/update-download.ts'

const payload = Buffer.from('desktop-archive-bytes')
const digest = createHash('sha256').update(payload).digest('hex')

describe('downloadVerifiedFile', () => {
  it('writes the file when size and sha256 match', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-dl-'))
    const dest = join(dir, 'out.bin')
    const progress: Array<[number, number]> = []
    await downloadVerifiedFile({
      url: 'https://example.test/a.bin',
      destPath: dest,
      sha256: digest,
      size: payload.length,
      fetchImpl: async () => new Response(payload, { status: 200 }),
      signal: new AbortController().signal,
      onProgress: (received, total) => { progress.push([received, total]) },
    })
    expect(readFileSync(dest)).toEqual(payload)
    expect(progress.at(-1)).toEqual([payload.length, payload.length])
    const destUpper = join(dir, 'out-upper.bin')
    await downloadVerifiedFile({
      url: 'https://example.test/a.bin',
      destPath: destUpper,
      sha256: digest.toUpperCase(),
      size: payload.length,
      fetchImpl: async () => new Response(payload, { status: 200 }),
      signal: new AbortController().signal,
      onProgress: () => {},
    })
    expect(readFileSync(destUpper)).toEqual(payload)
  })

  it('deletes a partial file on HTTP, size, and digest failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-dl-bad-'))
    const dest = join(dir, 'out.bin')
    await expect(downloadVerifiedFile({
      url: 'https://example.test/a.bin',
      destPath: dest,
      sha256: digest,
      size: payload.length,
      fetchImpl: async () => new Response('nope', { status: 500 }),
      signal: new AbortController().signal,
      onProgress: () => {},
    })).rejects.toThrow(/HTTP 500/)
    expect(existsSync(dest)).toBe(false)

    await expect(downloadVerifiedFile({
      url: 'https://example.test/a.bin',
      destPath: dest,
      sha256: digest,
      size: payload.length,
      fetchImpl: async () => ({ ok: true, body: null }) as Response,
      signal: new AbortController().signal,
      onProgress: () => {},
    })).rejects.toThrow(/empty body/)

    await expect(downloadVerifiedFile({
      url: 'https://example.test/a.bin',
      destPath: dest,
      sha256: digest,
      size: 2,
      fetchImpl: async () => new Response(payload, { status: 200 }),
      signal: new AbortController().signal,
      onProgress: () => {},
    })).rejects.toThrow(/larger than advertised/)
    expect(existsSync(dest)).toBe(false)

    await expect(downloadVerifiedFile({
      url: 'https://example.test/a.bin',
      destPath: dest,
      sha256: digest,
      size: payload.length + 8,
      fetchImpl: async () => new Response(payload, { status: 200 }),
      signal: new AbortController().signal,
      onProgress: () => {},
    })).rejects.toThrow(/size mismatch/)
    expect(existsSync(dest)).toBe(false)

    await expect(downloadVerifiedFile({
      url: 'https://example.test/a.bin',
      destPath: dest,
      sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      size: payload.length,
      fetchImpl: async () => new Response(payload, { status: 200 }),
      signal: new AbortController().signal,
      onProgress: () => {},
    })).rejects.toThrow(/sha256 mismatch/)
    expect(existsSync(dest)).toBe(false)
  })
})
