/**
 * Copy vendored workspace packages that `pnpm deploy --legacy` omits from a
 * Host tree. The workspace overrides cosmokit/schemastery as `link:` paths,
 * and Cordis plugin peers such as group stay off the CLI production graph, so
 * a deployed `@deepseek-ai/dsh` cannot resolve them until they are restored.
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { isEntry } from '../release/process.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const defaultRoot = resolve(scriptDir, '../..')

/** Directory names under `vendor/` that a packaged Host must be able to import. */
export const VENDORED_HOST_DIRECTORIES = [
  'cosmokit',
  'schemastery',
  'cordis',
  'group',
  'hmr',
  'include',
  'loader',
  'logger-console',
  'timer',
] as const

/**
 * Read the scoped package name from a vendored manifest.
 * @param vendorDir - absolute path of one `vendor/<name>` directory.
 * @returns the `@deepseek-ai/...` package name.
 */
export function vendoredPackageName(vendorDir: string): string {
  const parsed: unknown = JSON.parse(readFileSync(join(vendorDir, 'package.json'), 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`restore-vendored-host: ${vendorDir}/package.json is not a JSON object`)
  }
  const name = (parsed as { name?: unknown }).name
  if (typeof name !== 'string' || !name.startsWith('@deepseek-ai/')) {
    throw new Error(`restore-vendored-host: ${vendorDir} must declare a scoped @deepseek-ai name`)
  }
  return name
}

/**
 * Destination of one vendored package inside a deployed Host.
 * @param deployedRoot - `pnpm deploy` target that contains `node_modules`.
 * @param packageName - scoped package name.
 * @returns absolute path under `node_modules/@deepseek-ai`.
 */
export function deployedPackagePath(deployedRoot: string, packageName: string): string {
  const leaf = packageName.slice('@deepseek-ai/'.length)
  if (leaf === '' || leaf.includes('/') || leaf.includes('\\')) {
    throw new Error(`restore-vendored-host: unexpected package name ${packageName}`)
  }
  return join(deployedRoot, 'node_modules', '@deepseek-ai', leaf)
}

/**
 * Whether a deployed Host copy of a vendored package can stay in place.
 * `pnpm deploy --legacy` often leaves a workspace `link:` symlink that
 * resolves inside the build tree and is gone after Docker COPY or Windows pack.
 * @param destination - deployed `node_modules/@deepseek-ai/<name>` path.
 * @returns false when the path is missing, a symlink, or lacks package.json.
 */
export function vendoredHostCopyIsMaterial(destination: string): boolean {
  if (!existsSync(destination)) return false
  try {
    if (lstatSync(destination).isSymbolicLink()) return false
  } catch {
    return false
  }
  return existsSync(join(destination, 'package.json'))
}

/**
 * Copy every required vendored package into a deployed Host when deploy omitted
 * it or left a workspace symlink. Material copies with a package.json stay.
 * @param deployedRoot - `pnpm deploy` target.
 * @param repoRoot - repository root that contains `vendor/`.
 * @returns package names that were copied.
 */
export function restoreVendoredHostPackages(deployedRoot: string, repoRoot: string = defaultRoot): readonly string[] {
  const copied: string[] = []
  for (const directory of VENDORED_HOST_DIRECTORIES) {
    const vendorDir = join(repoRoot, 'vendor', directory)
    const packageName = vendoredPackageName(vendorDir)
    const destination = deployedPackagePath(deployedRoot, packageName)
    if (vendoredHostCopyIsMaterial(destination)) continue
    rmSync(destination, { recursive: true, force: true })
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(vendorDir, destination, {
      recursive: true,
      dereference: true,
      filter: (source) => {
        const relative = source.slice(vendorDir.length).replaceAll('\\', '/')
        if (relative === '/node_modules' || relative.startsWith('/node_modules/')) return false
        if (relative === '/tests' || relative.startsWith('/tests/')) return false
        return true
      },
    })
    copied.push(packageName)
  }
  const stillMissing = VENDORED_HOST_DIRECTORIES
    .map(directory => vendoredPackageName(join(repoRoot, 'vendor', directory)))
    .filter(name => !vendoredHostCopyIsMaterial(deployedPackagePath(deployedRoot, name)))
  if (stillMissing.length > 0) {
    throw new Error(`restore-vendored-host: still missing ${stillMissing.join(', ')}`)
  }
  return copied
}

/**
 * Read the scoped package name a deployed tree installs as the application.
 * @param deployedRoot - `pnpm deploy` target whose manifest names the deployed package.
 * @returns the `@deepseek-ai/...` name, or undefined when the manifest has none.
 */
export function deployedPackageName(deployedRoot: string): string | undefined {
  const parsed: unknown = JSON.parse(readFileSync(join(deployedRoot, 'package.json'), 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const name = (parsed as { name?: unknown }).name
  return typeof name === 'string' ? name : undefined
}

/**
 * Copy every deployed `node_modules/@deepseek-ai` entry that `pnpm deploy --legacy`
 * left as a workspace symlink, so the deployed tree carries no link into the
 * build checkout. A peer-only workspace dependency stays off the production
 * dependency graph — `dsh-atomic-write` declares `@deepseek-ai/dsh-error` as a
 * peer — so deploy only links it, and the link dangles once `docker COPY` takes
 * the deployed tree alone: the Host then fails with ERR_MODULE_NOT_FOUND.
 *
 * The deployed package's own entry is dropped rather than copied: it names the
 * deploy root, so copying it would place a second copy of the application
 * inside its own `node_modules`.
 * @param deployedRoot - `pnpm deploy` target that contains `node_modules`.
 * @returns scoped names of the packages materialized or dropped.
 */
export function materializeWorkspaceLinks(deployedRoot: string): readonly string[] {
  const scope = join(deployedRoot, 'node_modules', '@deepseek-ai')
  if (!existsSync(scope)) return []
  const payload = realpathSync(deployedRoot)
  const self = deployedPackageName(deployedRoot)
  const materialized: string[] = []
  for (const leaf of readdirSync(scope)) {
    const destination = join(scope, leaf)
    if (!lstatSync(destination).isSymbolicLink()) continue
    const name = `@deepseek-ai/${leaf}`
    if (name === self) {
      rmSync(destination, { force: true })
      materialized.push(name)
      continue
    }
    if (!existsSync(destination)) {
      throw new Error(`restore-vendored-host: ${name} is a dangling symlink; deploy it or remove the link`)
    }
    const source = realpathSync(destination)
    rmSync(destination, { force: true })
    materialized.push(name)
    if (payload === source || payload.startsWith(source + sep)) continue
    cpSync(source, destination, {
      recursive: true,
      dereference: true,
      filter: (entry) => {
        const relative = entry.slice(source.length).replaceAll('\\', '/')
        if (relative === '/node_modules' || relative.startsWith('/node_modules/')) return false
        if (relative === '/tests' || relative.startsWith('/tests/')) return false
        return true
      },
    })
  }
  return materialized
}

/** CLI entry: `pnpm exec tsx scripts/docker/restore-vendored-host.ts --deployed <dir>`. */
function main(): void {
  const { values } = parseArgs({
    options: {
      deployed: { type: 'string' },
      root: { type: 'string' },
    },
    allowPositionals: false,
  })
  if (values.deployed === undefined || values.deployed === '') {
    throw new Error('restore-vendored-host: --deployed is required')
  }
  const copied = restoreVendoredHostPackages(values.deployed, values.root ?? defaultRoot)
  if (copied.length === 0) console.log('restore-vendored-host: vendored Host packages already present')
  else console.log(`restore-vendored-host: copied ${copied.join(', ')}`)
  const materialized = materializeWorkspaceLinks(values.deployed)
  if (materialized.length > 0) console.log(`restore-vendored-host: materialized ${materialized.join(', ')}`)
}

if (isEntry(import.meta.url)) main()
