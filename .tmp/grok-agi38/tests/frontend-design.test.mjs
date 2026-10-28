import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKILL_DIR = join(PRESET_ROOT, 'skills', 'frontend-design')
const SKILL = join(SKILL_DIR, 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')

describe('frontend-design is adapted to dsh-grok-agi', () => {
  it('ships one flat skill with matching frontmatter', () => {
    assert.deepEqual(readdirSync(SKILL_DIR), ['SKILL.md'])
    const text = readFileSync(SKILL, 'utf8')
    assert.match(text, /^---\r?\nname: frontend-design\r?\n/)
    assert.match(text, /file_write/)
    assert.match(text, /read_image/)
    assert.equal(existsSync(join(SKILL_DIR, '.claude-plugin')), false)
    assert.equal(text.includes('LICENSE.txt'), false)
    assert.equal(text.includes('taking screenshots'), false)
  })

  it('is routed from using-superpowers, not repeated in the persona', () => {
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const persona = readFileSync(PERSONA, 'utf8')
    assert.match(superpowers, /frontend-design/)
    assert.match(persona, /Load `using-superpowers` first/)
    assert.equal(persona.includes('frontend-design'), false)
  })
})
