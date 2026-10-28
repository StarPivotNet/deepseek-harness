import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PERSONA = join(fileURLToPath(new URL('..', import.meta.url)), 'agent.cordis.yml')

function section(text, name) {
  const match = text.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))
  assert.ok(match, `${name} missing or unclosed`)
  return match[1]
}

describe('persona section tags', () => {
  it('closes validating before project_instructions and skills before communication', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const validating = section(persona, 'validating')
    const skills = section(persona, 'skills')
    assert.match(validating, /this-turn `pwsh`\/`bash` exit 0/)
    assert.equal(validating.includes('verification-before-completion'), false)
    assert.equal(validating.includes('<project_instructions>'), false)
    assert.match(skills, /Load `using-superpowers` first/)
    assert.equal(skills.includes('<communication>'), false)
  })
})
