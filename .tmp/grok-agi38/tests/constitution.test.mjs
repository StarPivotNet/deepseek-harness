import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')
const SKILL = join(PRESET_ROOT, 'skills', 'zixuan-agent-constitution', 'SKILL.md')

function section(text, name) {
  const match = text.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))
  assert.ok(match, `${name} missing or unclosed`)
  return match[1]
}

describe('judgment rules are persona text', () => {
  it('keeps the judgment rules in <judgment> and not in skills/', () => {
    assert.equal(existsSync(SKILL), false)
    const persona = readFileSync(PERSONA, 'utf8')
    const body = section(persona, 'judgment')
    assert.equal(/constitution/i.test(persona), false)
    assert.match(body, /not a catalog skill/)
    assert.match(body, /three capitals/)
    assert.match(body, /infinite game/)
    assert.match(body, /Begin with the end/)
    assert.match(body, /First principles/)
    assert.match(body, /Smallest sufficient plan/)
    assert.match(body, /three sources/)
    assert.match(body, /ship at 60/)
    assert.match(body, /Three months is the default reference/)
    assert.match(body, /Bazi is one reference/)
    assert.match(body, /Companion and Rob Wealth stars are unfavorable/)
    assert.match(body, /`calculator`/)
    assert.match(body, /session notes/)
    assert.equal(/[\u4e00-\u9fff]/.test(body), false)
    assert.equal(body.includes('hanzixuan'), false)
    assert.equal(persona.includes('skills/zixuan'), false)
  })
})
