/**
 * The built-in Grok Code preset bundle: its composition must be readable with
 * the Loader's own YAML dialect, every package row must name a workspace
 * package, every file row must exist inside the package, and the entry must
 * turn that composition into a registry declaration pointing at this package.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'
import { buildDefinition, packagePaths } from '../src/index.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const REPO = resolve(ROOT, '..', '..', '..')

interface Row {
  id?: string
  name: string
  group?: boolean
  config?: unknown
  disabled?: unknown
}

function collect(rows: readonly Row[], out: Row[] = []): Row[] {
  for (const row of rows) {
    out.push(row)
    if (row.group === true) collect(row.config as Row[], out)
  }
  return out
}

function workspacePackageNames(): Set<string> {
  const names = new Set<string>()
  for (const group of readdirSync(join(REPO, 'packages'))) {
    const groupDir = join(REPO, 'packages', group)
    if (!statSync(groupDir).isDirectory()) continue
    for (const directory of readdirSync(groupDir)) {
      const manifest = join(groupDir, directory, 'package.json')
      if (!existsSync(manifest)) continue
      try {
        names.add((JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name ?? '')
      } catch {
        // A directory without a readable manifest is not a workspace package.
      }
    }
  }
  return names
}

describe('dsh-grok-code bundle', () => {
  it('reads its own composition as a registry declaration', () => {
    const definition = buildDefinition()
    expect(definition.id).toBe('grok-code')
    expect(definition.name).toBe('Grok Code')
    expect(definition.plugins.length).toBeGreaterThan(0)
  })

  it('points every relative row and the skill directory inside the package', () => {
    const paths = packagePaths()
    const rows = collect(buildDefinition().plugins as Row[])
    const files = rows.filter((row) => row.name.startsWith('file:'))
    expect(files.length).toBeGreaterThan(0)
    for (const row of files) {
      expect(row.name.startsWith('file:///')).toBe(true)
      expect(row.name).toContain('/packages/bundle/grok-code/'.replaceAll('/', process.platform === 'win32' ? '/' : '/'))
    }
    const skills = rows.find((row) => row.id === 'skill-filesystem')
    expect((skills?.config as { customSkillDirs?: string[] }).customSkillDirs).toEqual([paths.skills])
  })

  it('names only workspace packages in its package rows', () => {
    const known = workspacePackageNames()
    const rows = collect(buildDefinition().plugins as Row[])
      .filter((row) => !row.name.startsWith('file:') && row.name !== 'cordis:group')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(known.has(row.name), `${String(row.id)} names ${row.name}`).toBe(true)
    }
  })

  it('carries no prompt variable the host does not register', () => {
    const composition = readFileSync(join(packagePaths().presetDir, 'agent.cordis.yml'), 'utf8')
    const variables = [...composition.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1])
    expect(variables).toEqual(['model'])
  })

  it('keeps the four local corrections applied to the upstream composition', () => {
    const rows = collect(buildDefinition().plugins as Row[])
    const byId = (id: string): Row | undefined => rows.find((row) => row.id === id)
    expect(byId('workflow-ptc')?.name).toBe('@deepseek-ai/dsh-workflow-ptc')
    expect(rows.some((row) => row.name === '@deepseek-ai/dsh-workflow-worker-thread')).toBe(false)
    expect(byId('official-file-prompt-shadow')?.disabled).toBe(true)
    expect((byId('tool-web')?.config as { fetch?: boolean }).fetch).toBe(true)
    expect((byId('tool-subagent')?.config as { agentPreset?: string }).agentPreset).toBe('grok-code')
  })

  it('parses with the Loader dialect the roster uses', () => {
    const composition = readFileSync(join(packagePaths().presetDir, 'agent.cordis.yml'), 'utf8')
    const parsed = yaml.load(composition, { schema: entryListSchema }) as Row[]
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.every((row) => typeof row.name === 'string' && row.name !== '')).toBe(true)
  })
})
