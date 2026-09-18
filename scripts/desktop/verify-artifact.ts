/**
 * Liveness gate for one packaged Desktop archive.
 *
 * Green CI and complete assets do not prove an archive starts: every broken
 * Desktop release shipped that way (0.1.3-alpha.2.1 through 0.1.6-alpha.1).
 * This gate proves the two failure classes CI cannot see — a main bundle the
 * asar cannot resolve and a runtime layout the main process cannot read —
 * and, with `--boot`, that the packaged app actually reaches the application
 * page.
 *
 * CLI: `pnpm exec tsx scripts/desktop/verify-artifact.ts <archive-mac.zip> [--boot] [--timeout <seconds>]`
 */

import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import { isEntry } from '../release/process.ts'

/** macOS archive inner bundle directory (the packer stages the no-space name). */
const MAC_APP_DIR = 'DeepSeekHarness.app'

/** The parsed asar header: its file table plus the byte length of that table. */
interface AsarHeader {
  readonly directory: Record<string, unknown>
  readonly headerSize: number
}

/** Read the asar header directory without unpacking the archive. */
export function readAsarHeader(archive: string): AsarHeader {
  const descriptor = openSync(archive, 'r')
  try {
    const prefix = Buffer.alloc(8)
    if (readSync(descriptor, prefix, 0, 8, 0) !== 8) throw new Error('verify-artifact: asar header too short')
    const headerSize = prefix.readUInt32LE(4)
    const header = Buffer.alloc(headerSize)
    if (readSync(descriptor, header, 0, headerSize, 8) !== headerSize) throw new Error('verify-artifact: asar header truncated')
    // Layout: [4]=pickle size, then [8..11]=padded JSON length, [12..15]=JSON
    // byte length, JSON at file offset 16, member data after the pickle.
    const jsonLength = header.readUInt32LE(4)
    if (jsonLength <= 0 || jsonLength > headerSize - 8) throw new Error('verify-artifact: asar header length field is out of range')
    const parsed: unknown = JSON.parse(header.subarray(8, 8 + jsonLength).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object'
      || typeof (parsed as { files?: unknown }).files !== 'object' || (parsed as { files?: unknown }).files === null) {
      throw new Error('verify-artifact: asar header has no file table')
    }
    return { directory: parsed as Record<string, unknown>, headerSize }
  } finally {
    closeSync(descriptor)
  }
}

/** Resolve one `a/b/c` path inside an asar directory tree. */
export function asarEntry(directory: Record<string, unknown>, path: string): Record<string, unknown> | undefined {
  let current: unknown = directory
  for (const segment of path.split('/')) {
    if (current === null || typeof current !== 'object') return undefined
    const files = (current as { files?: Record<string, unknown> }).files
    if (files === undefined || !Object.hasOwn(files, segment)) return undefined
    current = files[segment]
  }
  return current === null || typeof current !== 'object' ? undefined : current as Record<string, unknown>
}

/** Bare npm imports the bundled main process must not keep. */
export function bareNpmImports(mainSource: string): readonly string[] {
  const found = new Set<string>()
  for (const match of mainSource.matchAll(/from\s+"([^."][^"]*)"/gu)) {
    const specifier = match[1]
    if (specifier === undefined || specifier.startsWith('node:') || specifier === 'electron') continue
    found.add(specifier)
  }
  return [...found].sort()
}

/** Read one asar member's bytes through its header offset and size. */
export function readAsarMember(archive: string, header: AsarHeader, path: string): Buffer {
  const entry = asarEntry(header.directory, path)
  if (entry === undefined || typeof entry.offset !== 'string' || typeof entry.size !== 'number') {
    throw new Error(`verify-artifact: asar member ${path} is not a regular file`)
  }
  const start = 8 + header.headerSize + Number(entry.offset)
  const descriptor = openSync(archive, 'r')
  try {
    const body = Buffer.alloc(entry.size)
    if (readSync(descriptor, body, 0, entry.size, start) !== entry.size) throw new Error(`verify-artifact: asar member ${path} truncated`)
    return body
  } finally {
    closeSync(descriptor)
  }
}

function fail(message: string): never {
  throw new Error(`verify-artifact: ${message}`)
}

/** Structural checks over the unpacked macOS archive; returns the passed steps. */
export function verifyArchiveStructure(extractRoot: string): readonly string[] {
  const steps: string[] = []
  const resources = join(extractRoot, MAC_APP_DIR, 'Contents', 'Resources')
  const asarPath = join(resources, 'app.asar')
  const header = readAsarHeader(asarPath)
  steps.push('asar header readable')

  if (asarEntry(header.directory, 'dsh/desktop-runtime.json') === undefined) {
    fail('dsh/desktop-runtime.json is missing inside app.asar (runtime layout mismatch — is scripts/desktop/pack.ts in step with the main process?)')
  }
  steps.push('dsh runtime inside asar')

  if (!existsSync(join(resources, 'runtime', 'versions.json'))) fail('Resources/runtime/versions.json is missing')
  if (!existsSync(join(resources, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'))) fail('Resources/runtime/pnpm/bin/pnpm.mjs is missing')
  steps.push('runtime pnpm staged')

  if (!existsSync(join(resources, 'app.asar.unpacked', 'dsh'))) fail('app.asar.unpacked/dsh is missing (native payload not unpacked)')
  steps.push('native payload unpacked')

  if (asarEntry(header.directory, 'renderer/mandatory-update.html') === undefined) {
    fail('renderer/mandatory-update.html is missing inside app.asar')
  }
  if (asarEntry(header.directory, 'renderer/update-dialog.html') === undefined) {
    fail('renderer/update-dialog.html is missing inside app.asar')
  }
  if (asarEntry(header.directory, 'package.json') === undefined) fail('package.json is missing inside app.asar')
  steps.push('renderer shell inside asar')

  const bare = bareNpmImports(readAsarMember(asarPath, header, 'lib/main.js').toString('utf8'))
  if (bare.length > 0) fail(`lib/main.js keeps bare npm imports the asar cannot resolve: ${bare.join(', ')}`)
  steps.push('main bundle self-contained')
  return steps
}

/** Boot the unpacked app and wait for the application page over CDP. */
async function verifyBoot(appDir: string, homeDir: string, port: number, timeoutSeconds: number): Promise<string> {
  const resign = spawnSync('codesign', ['--force', '--deep', '--sign', '-', appDir])
  if (resign.status !== 0) fail(`ad-hoc resign failed: ${resign.stderr}`)
  // A throwaway DSH_HOME keeps the boot probe from touching the user's real
  // Desktop profile; the single-instance lock stays global, so a running
  // instance must be closed first (the error below names it).
  const child = spawn(join(appDir, 'Contents', 'MacOS', 'DeepSeekHarness'), [`--remote-debugging-port=${String(port)}`], {
    stdio: 'ignore',
    env: { ...process.env, DSH_HOME: homeDir },
  })
  const deadline = Date.now() + timeoutSeconds * 1000
  try {
    for (;;) {
      if (child.exitCode !== null) {
        fail(child.exitCode === 0
          ? 'app quit immediately (the single-instance lock refused it — close the running DeepSeek Harness and retry --boot)'
          : `app exited with ${String(child.exitCode)} before the application page`)
      }
      if (Date.now() > deadline) fail(`application page not ready within ${String(timeoutSeconds)}s`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      try {
        const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`)
        if (!response.ok) continue
        const targets = await response.json() as readonly { type?: string; url?: string }[]
        const page = targets.find(target => target.type === 'page')
        if (page !== undefined && (page.url ?? '').startsWith('dsh-app://app/index.html')) {
          return `application page served at ${page.url ?? ''}`
        }
      } catch { /* CDP not accepting yet */ }
    }
  } finally {
    child.kill('SIGKILL')
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      boot: { type: 'boolean', default: false },
      timeout: { type: 'string', default: '240' },
    },
    allowPositionals: true,
  })
  const archive = positionals[0]
  if (archive === undefined || !archive.endsWith('-mac.zip')) {
    throw new Error('verify-artifact: pass one macOS archive path ending in -mac.zip')
  }
  const timeout = Number(values.timeout)
  if (!Number.isSafeInteger(timeout) || timeout < 1) throw new Error('verify-artifact: --timeout must be positive seconds')

  const extractRoot = mkdtempSync(join(tmpdir(), 'dsh-verify-artifact-'))
  try {
    const unzip = spawnSync('unzip', ['-q', archive, '-d', extractRoot])
    if (unzip.status !== 0) fail(`unzip failed: ${unzip.stderr}`)
    for (const step of verifyArchiveStructure(extractRoot)) console.log(`verify-artifact: ${step}`)
    if (values.boot) {
      const booted = await verifyBoot(join(extractRoot, MAC_APP_DIR), join(extractRoot, 'dsh-home'), 9223, timeout)
      console.log(`verify-artifact: boot ok — ${booted}`)
    }
    console.log(`verify-artifact: OK ${basename(archive)}${values.boot ? ' (booted)' : ''}`)
  } finally {
    rmSync(extractRoot, { recursive: true, force: true })
  }
}

if (isEntry(import.meta.url)) await main()
