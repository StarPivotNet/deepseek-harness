import { deflateRawSync } from 'node:zlib'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { crc32, unzipTo, zipStore } from '../src/update-zip.ts'

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

function zipFile(opts: {
  name: string
  data: Buffer
  method?: number
  flags?: number
  extAttr?: number
  uncompressedSize?: number
  compressedSize?: number
  payload?: Buffer
  comment?: Buffer
  extra?: Buffer
  localExtra?: Buffer
  disk?: number
  cdCount?: number
  cdSize?: number
  cdOffset?: number
  localOffset?: number
}): Buffer {
  const nameBuf = Buffer.from(opts.name, 'utf8')
  const method = opts.method ?? 0
  const payload = opts.payload ?? (method === 8 ? deflateRawSync(opts.data) : opts.data)
  const digest = crc32(opts.data)
  const uncomp = opts.uncompressedSize ?? opts.data.length
  const comp = opts.compressedSize ?? payload.length
  const flags = opts.flags ?? 0
  const extra = opts.extra ?? Buffer.alloc(0)
  const localExtra = opts.localExtra ?? extra
  const local = Buffer.alloc(30 + nameBuf.length + localExtra.length + payload.length)
  local.writeUInt32LE(LOCAL_SIG, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(flags, 6)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(digest, 14)
  local.writeUInt32LE(comp, 18)
  local.writeUInt32LE(uncomp, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(localExtra.length, 28)
  nameBuf.copy(local, 30)
  localExtra.copy(local, 30 + nameBuf.length)
  payload.copy(local, 30 + nameBuf.length + localExtra.length)
  const central = Buffer.alloc(46 + nameBuf.length + extra.length)
  central.writeUInt32LE(CENTRAL_SIG, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(flags, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(digest, 16)
  central.writeUInt32LE(comp, 20)
  central.writeUInt32LE(uncomp, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt16LE(extra.length, 30)
  central.writeUInt32LE(opts.extAttr ?? 0, 38)
  central.writeUInt32LE(opts.localOffset ?? 0, 42)
  nameBuf.copy(central, 46)
  extra.copy(central, 46 + nameBuf.length)
  const comment = opts.comment ?? Buffer.alloc(0)
  const eocd = Buffer.alloc(22 + comment.length)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(opts.disk ?? 0, 4)
  eocd.writeUInt16LE(opts.disk ?? 0, 6)
  const count = opts.cdCount ?? 1
  eocd.writeUInt16LE(count, 8)
  eocd.writeUInt16LE(count, 10)
  eocd.writeUInt32LE(opts.cdSize ?? central.length, 12)
  eocd.writeUInt32LE(opts.cdOffset ?? local.length, 16)
  eocd.writeUInt16LE(comment.length, 20)
  comment.copy(eocd, 22)
  return Buffer.concat([local, central, eocd])
}

describe('unzipTo', () => {
  it('extracts stored files and directories', () => {
    const dest = mkdtempSync(join(tmpdir(), 'dsh-unzip-'))
    expect(unzipTo(zipStore({
      'dir/': null,
      'dir/hello.txt': Buffer.from('hi'),
      './dot.txt': Buffer.from('dot'),
      'win\\slash.txt': Buffer.from('slash'),
    }), dest).sort()).toEqual(['./dot.txt', 'dir/hello.txt', 'win/slash.txt'])
    expect(readFileSync(join(dest, 'dir', 'hello.txt'), 'utf8')).toBe('hi')
    expect(readFileSync(join(dest, 'dot.txt'), 'utf8')).toBe('dot')
    expect(readFileSync(join(dest, 'win', 'slash.txt'), 'utf8')).toBe('slash')
  })

  it('extracts a deflated entry and an EOCD comment', () => {
    const dest = mkdtempSync(join(tmpdir(), 'dsh-unzip-deflate-'))
    const data = Buffer.from('deflated-bytes')
    const zip = zipFile({
      name: 'file.txt',
      data,
      method: 8,
      comment: Buffer.from('note'),
      extra: Buffer.from('EX'),
      extAttr: (0o100000 << 16) >>> 0,
    })
    expect(unzipTo(zip, dest)).toEqual(['file.txt'])
    expect(readFileSync(join(dest, 'file.txt'))).toEqual(data)
    const dirMode = mkdtempSync(join(tmpdir(), 'dsh-unzip-dirmode-'))
    expect(unzipTo(zipFile({
      name: 'plain.txt',
      data: Buffer.from('ok'),
      extAttr: (0o040000 << 16) >>> 0,
    }), dirMode)).toEqual(['plain.txt'])
  })

  it('rejects zip-slip, absolute paths, encryption, and bad checksums', () => {
    const dest = mkdtempSync(join(tmpdir(), 'dsh-unzip-bad-'))
    expect(() => unzipTo(zipStore({ '../escape.txt': Buffer.from('x') }), dest)).toThrow(/escapes/)
    expect(() => unzipTo(zipFile({ name: '/tmp/x', data: Buffer.from('x') }), dest)).toThrow(/absolute/)
    expect(() => unzipTo(zipFile({ name: 'C:/x', data: Buffer.from('x') }), dest)).toThrow(/absolute/)
    expect(() => unzipTo(zipFile({ name: 'a.txt', data: Buffer.from('x'), flags: 1 }), dest)).toThrow(/encrypted/)
    expect(() => unzipTo(zipFile({
      name: 'a.txt',
      data: Buffer.from('x'),
      uncompressedSize: 99,
    }), dest)).toThrow(/stored zip size/)
    expect(() => unzipTo(zipFile({ name: 'a.txt', data: Buffer.from('x'), method: 9, payload: Buffer.from('x') }), dest))
      .toThrow(/unsupported zip method/)
    const badCrc = zipFile({ name: 'a.txt', data: Buffer.from('x') })
    badCrc.writeUInt32LE(1, 30 + 5 + 1 + 16)
    expect(() => unzipTo(badCrc, dest)).toThrow(/crc mismatch/)
    expect(() => unzipTo(zipFile({
      name: 'a.txt',
      data: Buffer.from('hello'),
      method: 8,
      uncompressedSize: 1,
    }), dest)).toThrow(/deflated zip size/)
    expect(() => unzipTo(zipFile({
      name: 'link',
      data: Buffer.from('x'),
      extAttr: (0o120000 << 16) >>> 0,
    }), dest)).toThrow(/not a regular file/)
  })

  it('rejects truncated, zip64, and multi-disk archives', () => {
    const dest = mkdtempSync(join(tmpdir(), 'dsh-unzip-trunc-'))
    expect(() => unzipTo(Buffer.from('nope'), dest)).toThrow(/end-of-central-directory/)
    expect(() => unzipTo(zipFile({ name: 'a.txt', data: Buffer.from('x') }).subarray(0, 40), dest))
      .toThrow(/end-of-central-directory|truncated/)
    expect(() => unzipTo(zipFile({ name: 'a.txt', data: Buffer.from('x'), cdCount: 0xffff }), dest)).toThrow(/zip64/)
    expect(() => unzipTo(zipFile({ name: 'a.txt', data: Buffer.from('x'), cdSize: 0xffffffff }), dest)).toThrow(/zip64/)
    expect(() => unzipTo(zipFile({ name: 'a.txt', data: Buffer.from('x'), cdOffset: 0xffffffff }), dest)).toThrow(/zip64/)
    expect(() => unzipTo(zipFile({ name: 'a.txt', data: Buffer.from('x'), disk: 1 }), dest)).toThrow(/multi-disk/)
    expect(() => unzipTo(zipFile({ name: 'a.txt', data: Buffer.from('x'), cdSize: 4_000_000_000 }), dest))
      .toThrow(/truncated zip central directory/)
    expect(() => unzipTo(zipFile({ name: 'a.txt', data: Buffer.from('x'), cdCount: 2 }), dest))
      .toThrow(/truncated zip central directory/)
    const badCentral = zipFile({ name: 'a.txt', data: Buffer.from('x') })
    const centralAt = badCentral.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    badCentral.writeUInt32LE(0, centralAt)
    expect(() => unzipTo(badCentral, dest)).toThrow(/invalid zip central directory/)
    expect(() => unzipTo(zipFile({
      name: 'a.txt',
      data: Buffer.from('x'),
      localOffset: 4_000_000_000,
    }), dest)).toThrow(/truncated zip local header/)
    const badLocal = zipFile({ name: 'a.txt', data: Buffer.from('x') })
    badLocal.writeUInt32LE(0, 0)
    expect(() => unzipTo(badLocal, dest)).toThrow(/invalid zip local header/)
    expect(() => unzipTo(zipFile({
      name: 'a.txt',
      data: Buffer.from('x'),
      compressedSize: 4_000_000_000,
    }), dest)).toThrow(/truncated zip entry/)
  })
})
