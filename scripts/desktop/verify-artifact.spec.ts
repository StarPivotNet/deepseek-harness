import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { asarEntry, bareNpmImports, readAsarHeader } from './verify-artifact.ts'

/** Build a minimal asar archive carrying the checked members. */
function writeProbeAsar(root: string): string {
  const members = new Map<string, string>([
    ['dsh/desktop-runtime.json', '{"schemaVersion":1}'],
    ['lib/main.js', 'import { app } from "electron"\nimport { readFileSync } from "node:fs"\n'],
  ])
  let offset = 0
  const table: Record<string, unknown> = {}
  for (const [path, body] of members) {
    const segments = path.split('/')
    let node = table
    for (const segment of segments.slice(0, -1)) {
      const next = (node[segment] as { files?: Record<string, unknown> } | undefined) ?? { files: {} }
      node[segment] = next
      node = next.files as Record<string, unknown>
    }
    node[segments[segments.length - 1] as string] = { size: body.length, offset: String(offset) }
    offset += body.length
  }
  const json = JSON.stringify({ files: table })
  const jsonPadded = json + '\0'.repeat((4 - (json.length % 4)) % 4)
  const header = Buffer.alloc(8 + jsonPadded.length)
  header.writeUInt32LE(jsonPadded.length, 0)
  header.writeUInt32LE(json.length, 4)
  header.write(jsonPadded, 8, 'utf8')
  const archive = join(root, 'probe.asar')
  const data = Buffer.from([...members.values()].join(''), 'utf8')
  const prefix = Buffer.alloc(8)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(header.length, 4)
  writeFileSync(archive, Buffer.concat([prefix, header, data]))
  return archive
}

const root = mkdtempSync(join(tmpdir(), 'verify-artifact-spec-'))
const archive = writeProbeAsar(root)
afterAll(() => { rmSync(root, { recursive: true, force: true }) })

describe('verify-artifact asar reading', () => {
  it('parses the header and resolves nested members', () => {
    const header = readAsarHeader(archive)
    expect(asarEntry(header.directory, 'dsh/desktop-runtime.json')).toMatchObject({ size: expect.any(Number) })
    expect(asarEntry(header.directory, 'lib/main.js')).toBeDefined()
    expect(asarEntry(header.directory, 'missing/file.js')).toBeUndefined()
    expect(asarEntry(header.directory, 'dsh')).toMatchObject({ files: expect.any(Object) })
  })

  it('flags bare npm imports but keeps builtin and electron specifiers', () => {
    expect(bareNpmImports('import { app } from "electron"\nimport { f } from "node:fs"\n')).toEqual([])
    expect(bareNpmImports('import { valid } from "semver"\nimport electronUpdater from "electron-updater"\n'))
      .toEqual(['electron-updater', 'semver'])
  })
})
