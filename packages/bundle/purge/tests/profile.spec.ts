import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import * as plugin from '../src/index.ts'
import { readPresetDefinition } from '../../redteam/src/preset-composition.ts'
import { builtinPackageRoot, shouldDeletePluginTree } from '../runtime/uninstall.js'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

describe('organization Purge bundle', () => {
  it('declares the default-on layer and keeps every red-team entry in the package', () => {
    const patch = yaml.load(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as {
      insert?: { id?: string; name?: string; config?: Record<string, unknown> }[]
    }[]
    const rows = patch.flatMap(row => row.insert ?? [])
    expect(rows.find(row => row.id === 'dsh-purge')).toMatchObject({
      name: '@deepseek-ai/dsh-purge',
      config: { enabled: true, autoApplyOnStart: true },
    })
    for (const id of ['dsh-purge-redteam', 'dsh-purge-redteam-store', 'dsh-purge-redteam-ui']) {
      expect(rows.find(row => row.id === id)?.name).toMatch(/^@deepseek-ai\/dsh-redteam/)
    }
    const preset = readPresetDefinition('redteam', join(root, '../redteam/presets/redteam'))
    expect(preset.plugins.find((entry: { name?: string }) => entry.name === '@deepseek-ai/dsh-redteam/tools')).toBeDefined()
  })

  it('preserves Loader export metadata and does not load a deleted external updater', () => {
    expect('default' in plugin).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(plugin) as Record<string, unknown>
    expect(unwrapped).toBe(plugin)
    expect(unwrapped.name).toBe('dsh-purge')
    expect(unwrapped.inject).toEqual(['systemPrompt', 'tools'])
    expect(typeof unwrapped.apply).toBe('function')
    expect(existsSync(join(root, 'runtime/update.js'))).toBe(false)
    const runtime = readFileSync(join(root, 'runtime/index.js'), 'utf8')
    expect(runtime).not.toContain('/dsh-purge/update')
    expect(runtime).toContain('distribution: "organization-builtin"')
    expect(runtime).not.toContain('autoUpdateOnStart')
    const client = readFileSync(join(root, 'client.js'), 'utf8')
    expect(client).toContain('id: "@deepseek-ai/dsh-purge"')
    expect(client).not.toContain('/dsh-purge/update')
  })

  it('never deletes the organization-owned package during uninstall cleanup', () => {
    expect(shouldDeletePluginTree(builtinPackageRoot())).toBe(false)
    expect(shouldDeletePluginTree(join(root, 'lib/runtime'))).toBe(false)
  })
})
