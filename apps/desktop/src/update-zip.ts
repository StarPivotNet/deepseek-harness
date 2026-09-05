/**
 * Extract a deflate/store ZIP with zip-slip protection. No extra dependencies.
 * @module @deepseek-ai/dsh-desktop/update-zip
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { inflateRawSync } from 'node:zlib'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
const FLAG_ENCRYPTED = 0x0001
const UNIX_IFMT = 0o170000
const UNIX_IFDIR = 0o040000
const UNIX_IFREG = 0o100000

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

/**
 * CRC-32 of `data` (ZIP / PNG polynomial).
 *
 * @param data - bytes.
 * @returns unsigned CRC-32.
 */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ (data[i] ?? 0)) & 255] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Extract `buffer` into `destDir`. Rejects zip-slip, encryption, zip64, and non-file entries.
 *
 * @param buffer - ZIP bytes.
 * @param destDir - destination directory (created if missing).
 * @returns relative paths of written files.
 */
export function unzipTo(buffer: Buffer, destDir: string): string[] {
  const dest = resolve(destDir)
  mkdirSync(dest, { recursive: true })
  const eocd = findEocd(buffer)
  const count = buffer.readUInt16LE(eocd + 10)
  const cdSize = buffer.readUInt32LE(eocd + 12)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  if (buffer.readUInt16LE(eocd + 4) !== 0 || buffer.readUInt16LE(eocd + 6) !== 0) {
    throw new Error('desktop update: multi-disk zip is not supported')
  }
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error('desktop update: zip64 is not supported')
  }
  if (cdOffset + cdSize > buffer.length) throw new Error('desktop update: truncated zip central directory')
  const written: string[] = []
  let cursor = cdOffset
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > buffer.length) throw new Error('desktop update: truncated zip central directory')
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIG) throw new Error('desktop update: invalid zip central directory')
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const expectedCrc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLen = buffer.readUInt16LE(cursor + 28)
    const extraLen = buffer.readUInt16LE(cursor + 30)
    const commentLen = buffer.readUInt16LE(cursor + 32)
    const extAttr = buffer.readUInt32LE(cursor + 38)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8')
    cursor += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) {
      mkdirSync(resolveEntry(dest, name), { recursive: true })
      continue
    }
    const mode = (extAttr >>> 16) & UNIX_IFMT
    if (mode !== 0 && mode !== UNIX_IFREG && mode !== UNIX_IFDIR) {
      throw new Error(`desktop update: zip entry is not a regular file: ${name}`)
    }
    const data = readLocalFile(buffer, localOffset, flags, method, compressedSize, uncompressedSize)
    if (crc32(data) !== expectedCrc) throw new Error(`desktop update: zip crc mismatch: ${name}`)
    const target = resolveEntry(dest, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data)
    written.push(name.replaceAll('\\', '/'))
  }
  return written
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 22 - 0xffff)
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) !== EOCD_SIG) continue
    const commentLen = buffer.readUInt16LE(i + 20)
    if (i + 22 + commentLen === buffer.length) return i
  }
  throw new Error('desktop update: zip end-of-central-directory not found')
}

function readLocalFile(
  buffer: Buffer,
  offset: number,
  flags: number,
  method: number,
  compressedSize: number,
  uncompressedSize: number,
): Buffer {
  if (offset + 30 > buffer.length) throw new Error('desktop update: truncated zip local header')
  if (buffer.readUInt32LE(offset) !== LOCAL_SIG) throw new Error('desktop update: invalid zip local header')
  if ((flags & FLAG_ENCRYPTED) !== 0) throw new Error('desktop update: encrypted zip is not supported')
  const nameLen = buffer.readUInt16LE(offset + 26)
  const extraLen = buffer.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + nameLen + extraLen
  const dataEnd = dataStart + compressedSize
  if (dataEnd > buffer.length) throw new Error('desktop update: truncated zip entry')
  const compressed = buffer.subarray(dataStart, dataEnd)
  if (method === METHOD_STORE) {
    if (compressed.length !== uncompressedSize) throw new Error('desktop update: stored zip size mismatch')
    return Buffer.from(compressed)
  }
  if (method === METHOD_DEFLATE) {
    const inflated = inflateRawSync(compressed)
    if (inflated.length !== uncompressedSize) throw new Error('desktop update: deflated zip size mismatch')
    return inflated
  }
  throw new Error(`desktop update: unsupported zip method ${String(method)}`)
}

function resolveEntry(dest: string, name: string): string {
  const normalized = name.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`desktop update: zip path is absolute: ${name}`)
  }
  const parts = normalized.split('/')
  if (parts.some(part => part === '..')) {
    throw new Error(`desktop update: zip path escapes destination: ${name}`)
  }
  const target = resolve(dest, ...parts.filter(part => part !== '' && part !== '.'))
  const prefix = dest.endsWith(sep) ? dest : `${dest}${sep}`
  if (target !== dest && !target.startsWith(prefix)) {
    throw new Error(`desktop update: zip path escapes destination: ${name}`)
  }
  return target
}

/**
 * Build a store-only ZIP for tests.
 *
 * @param files - relative path → bytes. Directories end with `/`.
 * @returns ZIP bytes.
 */
export function zipStore(files: Record<string, Buffer | null>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, data] of Object.entries(files)) {
    const body = data ?? Buffer.alloc(0)
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = data === null ? 0 : crc32(body)
    const local = Buffer.alloc(30 + nameBuf.length + body.length)
    local.writeUInt32LE(LOCAL_SIG, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)
    body.copy(local, 30 + nameBuf.length)
    locals.push(local)
    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(CENTRAL_SIG, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centrals.push(central)
    offset += local.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(centrals.length, 8)
  eocd.writeUInt16LE(centrals.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}
