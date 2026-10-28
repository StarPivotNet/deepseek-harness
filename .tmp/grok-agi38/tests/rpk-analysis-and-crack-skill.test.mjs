import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKILL_DIR = join(PRESET_ROOT, 'skills', 'agi-reverse', 'library', 're-rpk')
const SKILL_MD = join(SKILL_DIR, 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const HUB = join(PRESET_ROOT, 'skills', 'agi-reverse', 'SKILL.md')

describe('re-rpk is the RPK file inside agi-reverse', () => {
  it('is named re-rpk and is not a catalog skill', () => {
    assert.equal(existsSync(SKILL_MD), true)
    const text = readFileSync(SKILL_MD, 'utf8')
    assert.match(text, /^---\r?\nname: re-rpk\r?\n/)
    assert.match(text, /type: gateway/)
    assert.match(text, /Do not call `skill` for `re-rpk`/)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'rpk-analysis-and-crack')), false)
  })

  it('covers full-logic analysis and crack', () => {
    const text = readFileSync(SKILL_MD, 'utf8')
    assert.match(text, /all logic/)
    assert.match(text, /analyze mode/)
    assert.match(text, /crack mode/)
    assert.match(text, /logic-map/)
  })

  it('locks the seven logic-map rows and read-only analyze', () => {
    const text = readFileSync(SKILL_MD, 'utf8')
    for (const row of ['package identity', 'route table', 'launch chain', 'gameplay core', 'gate', 'resources and side effects', 'evidence']) {
      assert.match(text, new RegExp(row))
    }
    assert.match(text, /[Dd]o not `stub`/)
    assert.match(text, /[Dd]o not `pack`/)
  })

  it('classify does not patch; crack leaves gameplay', () => {
    const text = readFileSync(SKILL_MD, 'utf8')
    const classify = text.slice(text.indexOf('1. **Classify'), text.indexOf('2. **Choose the mode'))
    assert.match(classify, /does not edit files/)
    assert.equal(classify.includes('stub'), false)
    assert.match(text, /[Cc]rack mode does not change the gameplay core/)
  })

  it('keeps the unpack/stub/pack toolchain beside the file', () => {
    const text = readFileSync(SKILL_MD, 'utf8')
    assert.match(text, /library\\re-rpk\\cli\.js unpack/)
    assert.match(text, /\bstub\b/)
    assert.match(text, /SignUtil/)
    assert.equal(existsSync(join(SKILL_DIR, 'cli.js')), true)
    assert.equal(existsSync(join(SKILL_DIR, 'jsc.js')), true)
    assert.equal(existsSync(join(SKILL_DIR, 'vendor', 'sign', 'SignUtil.js')), true)
  })

  it('routes a .rpk through agi-reverse to re-rpk', () => {
    const route = readFileSync(SUPERPOWERS, 'utf8')
    const hub = readFileSync(HUB, 'utf8')
    assert.match(route, /`agi-reverse`/)
    assert.match(route, /re-rpk/)
    assert.match(route, /all logic/)
    assert.equal(route.includes('rpk-analysis-and-crack'), false)
    assert.match(hub, /library\\re-rpk\\SKILL\.md/)
    assert.match(hub, /Stop this list/)
  })
})
