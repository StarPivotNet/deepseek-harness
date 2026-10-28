import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')

const SKILLS = [
  'codebase-design',
  'writing-for-agents',
]

describe('Matt Pocock skills are vendored into grok-agi', () => {
  it('ships every skill with matching frontmatter', () => {
    for (const name of SKILLS) {
      const file = join(PRESET_ROOT, 'skills', name, 'SKILL.md')
      assert.equal(existsSync(file), true, name)
      const text = readFileSync(file, 'utf8')
      assert.match(text, new RegExp('^---\\r?\\nname: ' + name + '\\r?\\n'))
    }
  })

  it('routes the rest from using-superpowers', () => {
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    for (const name of SKILLS) {
      assert.match(superpowers, new RegExp('`' + name + '`'))
    }
  })

})
