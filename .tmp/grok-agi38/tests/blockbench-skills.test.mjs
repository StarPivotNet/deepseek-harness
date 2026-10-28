import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const HUB = join(PRESET_ROOT, 'skills', 'blockbench', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')

describe('blockbench skills author bbmodel files', () => {
  it('ships one skill and refuses the other generators', () => {
    const hub = readFileSync(HUB, 'utf8')
    assert.match(hub, /^---\r?\nname: blockbench\r?\n/)
    assert.match(hub, /bbmodel-maker/)
    assert.match(hub, /not MCP/)
    assert.match(hub, /WRITE_LAYERS/)
    assert.match(hub, /READ_LAYERS/)
    assert.match(hub, /format_version/)
    assert.equal(/to_fmt410|downgrade|5\.0|4\.5/.test(hub), false)
    assert.match(hub, /bbmodel-to-geckolib/)
    assert.match(hub, /minecraft-ai-generate-bbmodel-main/)
    assert.match(hub, /bbmodel-generation-main/)
    assert.match(hub, /bbmodel-ai-generator-master/)
    assert.equal(/\b(get_capabilities|risky_eval|from_geo_json|set_mode)\b/.test(hub), false)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'blockbench-author')), false)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'blockbench-check')), false)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'blockbench-spec')), false)
    assert.equal(
      existsSync(join(PRESET_ROOT, 'skills', 'blockbench', 'bbmodel-maker', 'src', 'bbmodel_maker', '__init__.py')),
      true,
    )
    assert.equal(/Desktop\\test\\bbmodel-maker-main/.test(hub), false)
  })

  it('is routed from using-superpowers, not repeated in the persona', () => {
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const persona = readFileSync(PERSONA, 'utf8')
    assert.match(superpowers, /GeckoLib export \| `blockbench`/)
    assert.match(persona, /Load `using-superpowers` first/)
    assert.equal(persona.includes('blockbench-author'), false)
    assert.equal(persona.includes('blockbench-check'), false)
    assert.equal(persona.includes('blockbench-spec'), false)
  })
})
