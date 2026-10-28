import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const SKILLS_DIR = join(PRESET_ROOT, 'skills')

function skillNames() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

describe('ultra-math is removed from grok-agi', () => {
  it('has no ultra-math or ultramath skill directory', () => {
    assert.equal(existsSync(join(SKILLS_DIR, 'ultra-math')), false)
    assert.equal(existsSync(join(SKILLS_DIR, 'ultramath')), false)
    for (const name of skillNames()) {
      assert.equal(/ultra-?math/i.test(name), false, name)
    }
  })

  it('does not keep the old ultramath or ultra-math tests besides this lock', () => {
    assert.equal(existsSync(join(PRESET_ROOT, 'tests', 'ultramath-skill.test.mjs')), false)
  })

  it('does not route math work to ultra-math in using-superpowers', () => {
    const text = readFileSync(SUPERPOWERS, 'utf8')
    assert.equal(text.includes('ultra-math'), false)
    assert.equal(text.includes('ultramath'), false)
  })
})

