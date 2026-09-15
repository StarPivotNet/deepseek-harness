/**
 * Verify that StarPivot fork customizations survive upstream merges.
 * Every assertion here marks a customization that was lost to a merge at
 * least once (the in-box plugin-catalog row vanished between desktop
 * 0.1.2-alpha.1.1 and .1.2, breaking the marketplace Discover source), so
 * the daily upstream-merge automation runs this gate before pushing.
 *
 * @module scripts/verify-fork-customizations
 */

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isEntry } from './release/process.ts'

const defaultRoot = resolve(import.meta.dirname, '..')

/** One fork customization that must survive every upstream merge. */
interface CustomizationCheck {
  readonly label: string
  readonly check: (repoRoot: string) => boolean
}

function fileContains(path: string, needle: string): boolean {
  if (!existsSync(path)) return false
  return readFileSync(path, 'utf8').includes(needle)
}

/** The assertions. Extend this list when a new merge loses a customization. */
const CHECKS: readonly CustomizationCheck[] = [
  {
    label: 'web-app composition keeps the plugin-catalog row (StarPivot Discover source)',
    check: repoRoot => fileContains(
      join(repoRoot, 'packages', 'bundle', 'web-app', 'cordis.patch.yml'),
      "name: '@deepseek-ai/dsh-host-plugin-catalog'",
    ),
  },
  {
    label: 'web-app composition points the marketplace at the shipped catalog route',
    check: repoRoot => fileContains(
      join(repoRoot, 'packages', 'bundle', 'web-app', 'cordis.patch.yml'),
      '- /plugin-catalog/catalog.json',
    ),
  },
  {
    label: 'web-app manifest still depends on the host catalog package',
    check: repoRoot => fileContains(
      join(repoRoot, 'packages', 'bundle', 'web-app', 'package.json'),
      '"@deepseek-ai/dsh-host-plugin-catalog"',
    ),
  },
  {
    label: 'the StarPivot catalog JSON ships with the host catalog package',
    check: (repoRoot) => {
      const catalog = join(repoRoot, 'packages', 'host', 'plugin-catalog', 'catalog.json')
      if (!existsSync(catalog)) return false
      try {
        const parsed = JSON.parse(readFileSync(catalog, 'utf8')) as { title?: unknown; plugins?: unknown[] }
        return parsed.title === 'StarPivot' && Array.isArray(parsed.plugins) && parsed.plugins.length > 0
      } catch {
        return false
      }
    },
  },
  {
    label: 'Desktop keeps the marketplace rows active (Discover reads the shipped file)',
    check: (repoRoot) => {
      const patch = join(repoRoot, 'apps', 'desktop-host', 'config', 'desktop.cordis.patch.yml')
      return !fileContains(patch, '- id: plugin-marketplace\n  disabled: true')
        && !fileContains(patch, '- id: ui-settings-plugin-marketplace\n  disabled: true')
    },
  },
  {
    label: 'marketplace host can read the shipped catalog without a web server',
    check: repoRoot => fileContains(
      join(repoRoot, 'packages', 'client', 'ui-settings-plugin-marketplace', 'src', 'host', 'index.ts'),
      'readShippedCatalog',
    ),
  },
]

/**
 * Run every customization assertion.
 * @param repoRoot - repository root containing `packages/`.
 * @returns labels of the failed assertions; empty when all hold.
 */
export function verifyForkCustomizations(repoRoot: string = defaultRoot): readonly string[] {
  return CHECKS
    .filter(check => !check.check(repoRoot))
    .map(check => check.label)
}

/** CLI entry: `pnpm exec tsx scripts/verify-fork-customizations.ts`. */
function main(): void {
  parseArgs({ options: {}, allowPositionals: false })
  const failed = verifyForkCustomizations()
  if (failed.length > 0) {
    throw new Error(
      `verify-fork-customizations: lost fork customizations (an upstream merge probably dropped them):\n${failed.map(label => `  - ${label}`).join('\n')}`,
    )
  }
  console.log('verify-fork-customizations: all fork customizations intact')
}

if (isEntry(import.meta.url)) main()
