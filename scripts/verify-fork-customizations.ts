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
      const webApp = join(repoRoot, 'packages', 'bundle', 'web-app', 'cordis.patch.yml')
      // Official 0.1.6-alpha.2 Desktop boots the web profile directly and no
      // longer ships a desktop.cordis.patch.yml that could disable marketplace
      // rows. The web-app composition must keep both marketplace halves.
      return fileContains(webApp, "name: '@deepseek-ai/dsh-client-ui-settings-plugin-marketplace'")
        && fileContains(webApp, "name: '@deepseek-ai/dsh-client-ui-settings-plugin-marketplace/host'")
        && !fileContains(patch, '- id: plugin-marketplace\n  disabled: true')
        && !fileContains(patch, '- id: ui-settings-plugin-marketplace\n  disabled: true')
    },
  },
  {
    label: 'desktop pack ships the dsh runtime inside the asar (0.1.6 layout)',
    check: (repoRoot) => {
      const pack = join(repoRoot, 'scripts', 'desktop', 'pack.ts')
      const builder = join(repoRoot, 'apps', 'desktop', 'scripts', 'electron-builder-config.mjs')
      return fileContains(pack, "{ from: prepared.dsh, to: 'dsh', filter: ['**/*'] }")
        || fileContains(builder, "to: 'dsh'")
    },
  },
  {
    label: 'marketplace host can read the shipped catalog without a web server',
    check: repoRoot => fileContains(
      join(repoRoot, 'packages', 'client', 'ui-settings-plugin-marketplace', 'src', 'host', 'index.ts'),
      'readShippedCatalog',
    ),
  },
  {
    label: 'Chat user bubbles keep same-session rewriteAt wiring',
    check: repoRoot => fileContains(
      join(repoRoot, 'packages', 'client', 'ui-chat', 'src', 'client', 'chat', 'MessageItem.tsx'),
      'rewriteAt(data.seq, next)',
    )
      && fileContains(
        join(repoRoot, 'packages', 'client', 'ui-chat', 'src', 'client', 'apply.ts'),
        'rewriteAt: (seq, text) => {',
      )
      && fileContains(
        join(repoRoot, 'packages', 'api', 'session-controller', 'src', 'commands.ts'),
        'async rewrite(request: SessionRewriteRequest)',
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
