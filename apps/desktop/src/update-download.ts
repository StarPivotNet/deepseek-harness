/**
 * Stream a GitHub Release archive to disk and verify SHA-256 and size.
 * @module @deepseek-ai/dsh-desktop/update-download
 */

import { createHash } from 'node:crypto'
import { createWriteStream, rmSync, type WriteStream } from 'node:fs'

/**
 * Download `url` to `destPath`, hashing bytes as they arrive.
 * A size or digest mismatch deletes the partial file.
 *
 * @param options - URL, destination, expected digest/size, fetch, abort, progress.
 */
export async function downloadVerifiedFile(options: {
  url: string
  destPath: string
  sha256: string
  size: number
  fetchImpl: typeof fetch
  signal: AbortSignal
  onProgress: (received: number, total: number) => void
}): Promise<void> {
  const response = await options.fetchImpl(options.url, {
    redirect: 'follow',
    signal: options.signal,
  })
  if (!response.ok) throw new Error(`desktop update: HTTP ${String(response.status)}`)
  if (response.body === null) throw new Error('desktop update: empty body')
  const hash = createHash('sha256')
  const file = createWriteStream(options.destPath)
  let received = 0
  try {
    for await (const chunk of response.body) {
      const buf: Uint8Array = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      received += buf.byteLength
      if (received > options.size) throw new Error('desktop update: download larger than advertised')
      hash.update(buf)
      await writeChunk(file, buf)
      options.onProgress(received, options.size)
    }
    await closeStream(file)
  } catch (error) {
    file.destroy()
    rmSync(options.destPath, { force: true })
    throw error
  }
  if (received !== options.size) {
    rmSync(options.destPath, { force: true })
    throw new Error('desktop update: download size mismatch')
  }
  if (hash.digest('hex') !== options.sha256.toLowerCase()) {
    rmSync(options.destPath, { force: true })
    throw new Error('desktop update: sha256 mismatch')
  }
}

function writeChunk(stream: WriteStream, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => {
      if (error !== null && error !== undefined) reject(error)
      else resolve()
    })
  })
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((error?: Error | null) => {
      if (error !== null && error !== undefined) reject(error)
      else resolve()
    })
  })
}
