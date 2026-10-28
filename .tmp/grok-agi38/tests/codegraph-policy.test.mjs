import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')
const PRESET = join(PRESET_ROOT, 'preset.yml')
const TAKEOVER = join(PRESET_ROOT, 'skills', 'takeover-codebase', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const AGI_LOOP = join(PRESET_ROOT, 'skills', 'agi-loop', 'SKILL.md')
const DEBUG = join(PRESET_ROOT, 'skills', 'systematic-debugging', 'SKILL.md')

const CORE = ['codegraph_status', 'codegraph_init', 'codegraph_sync', 'codegraph_explore']

function section(text, name) {
  const match = text.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))
  assert.ok(match, `${name} missing or unclosed`)
  return match[1]
}

describe('dsh-codegraph core surface is what grok-agi teaches', () => {
  it('persona tool_calling uses explore after status and does not teach reindex or codegraph.json', () => {
    const persona = section(readFileSync(PERSONA, 'utf8'), 'tool_calling')
    for (const name of CORE) assert.match(persona, new RegExp(name))
    assert.match(persona, /Host plugin `dsh-codegraph`/)
    assert.match(persona, /bundles the Windows CLI/)
    assert.equal(persona.includes('@jiangzhenguo/dsh-codegraph'), false)
    assert.equal(persona.includes('must be on PATH'), false)
    assert.match(persona, /surface `core`/)
    assert.match(persona, /there is no `codegraph_reindex`/)
    assert.match(persona, /do not re-check that result with grep/i)
    assert.equal(persona.includes('has no exclude argument'), false)
    assert.equal(persona.includes('write that full list'), false)
    assert.match(persona, /do not shell out to `python -m codegraph`/)
  })

  it('does not mount dsh-codegraph as a preset composition row', () => {
    const yml = readFileSync(PERSONA, 'utf8')
    assert.equal(/^\s+name:\s*['"]?dsh-codegraph['"]?\s*$/m.test(yml), false)
    assert.equal(/^\s+id:\s*codegraph\s*$/m.test(yml), false)
    assert.match(readFileSync(PRESET, 'utf8'), /dsh-codegraph/)
    assert.match(readFileSync(PRESET, 'utf8'), /codegraph_explore/)
  })

  it('takeover-codebase checks status and explores a slice', () => {
    const skill = readFileSync(TAKEOVER, 'utf8')
    assert.match(skill, /codegraph_status/)
    assert.match(skill, /codegraph_explore/)
    assert.match(skill, /codegraph_init/)
    assert.equal(/Call `codegraph_reindex`/.test(skill), false)
    assert.equal(/codegraph_overview` only/.test(skill), false)
    assert.match(skill, /codegraph_overview` unless that name is in this session's tool list/)
    assert.equal(skill.includes('write that full list'), false)
    assert.match(skill, /Fire together:[\s\S]*codegraph_status/)
    assert.match(skill, /A string, a route, or a config key/)
  })

  it('using-superpowers, agi-loop, and systematic-debugging name the core tools', () => {
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const loop = readFileSync(AGI_LOOP, 'utf8')
    const debug = readFileSync(DEBUG, 'utf8')
    const persona = readFileSync(PERSONA, 'utf8')
    for (const text of [superpowers, loop, debug]) {
      assert.match(text, /codegraph_status/)
      assert.match(text, /codegraph_explore/)
      assert.match(text, /codegraph_init/)
      assert.match(text, /codegraph_sync/)
      assert.equal(text.includes('has no exclude argument'), false)
      assert.equal(text.includes('write that full list'), false)
    }
    assert.match(superpowers, /There is no `codegraph_reindex`/)
    const spawnHits = persona.split('toolName: subagent')[1]
    const forkHits = persona.split('toolName: subagent_fork')[1]
    assert.ok(spawnHits && spawnHits.includes('codegraph_explore'), 'spawn subagent uses explore')
    assert.ok(spawnHits.includes('codegraph_status'), 'spawn subagent checks status')
    assert.equal(spawnHits.includes('has no exclude argument'), false)
    assert.ok(forkHits && forkHits.includes('codegraph_explore'), 'fork subagent uses explore')
    assert.ok(forkHits.includes('codegraph_status'), 'fork subagent checks status')
    assert.equal(forkHits.includes('has no exclude argument'), false)
  })
})
