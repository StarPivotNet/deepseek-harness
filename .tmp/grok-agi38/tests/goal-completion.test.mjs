import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')
const SKILL = join(PRESET_ROOT, 'skills', 'goal-completion', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const DESIGN = join(PRESET_ROOT, 'skills', 'design-before-build', 'SKILL.md')

function section(text, name) {
  const match = text.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))
  assert.ok(match, `${name} missing or unclosed`)
  return match[1]
}

describe('goal completion', () => {
  it('states same-goal implied work in the persona and keeps prohibitions', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const goal = section(persona, 'goal_completion')
    const policy = section(persona, 'work_policy')
    const skills = section(persona, 'skills')
    const comm = section(persona, 'communication')
    assert.match(goal, /success condition/)
    assert.match(goal, /same goal/)
    assert.match(goal, /prohibition/)
    assert.match(goal, /do not edit the repo just to be helpful/)
    assert.match(goal, /Do not add pieces the parent did not put in the contract/)
    assert.match(goal, /Do not call `skill` for it/)
    assert.match(policy, /Keep changes inside the user's goal/)
    assert.match(policy, /Do not open a second goal/)
    assert.equal(policy.includes('Keep changes scoped to what was asked'), false)
    assert.match(skills, /follow `<goal_completion>`; do not call `skill` for it/)
    assert.equal(skills.includes('load `goal-completion`'), false)
    assert.match(comm, /do it this turn and name it in one sentence/)
    assert.match(comm, /never end with an "If you want" sentence/)
  })

  it('keeps the procedure in the persona and does not ship a skill', () => {
    assert.equal(existsSync(SKILL), false)
    const route = readFileSync(SUPERPOWERS, 'utf8')
    assert.match(route, /\| Outcome named but the pieces are not, and the work is non-trivial \| persona `<goal_completion>`/)
    assert.equal(route.includes('`goal-completion`'), false)
  })

  it('keeps implied pieces of the chosen approach and still strips a second goal', () => {
    const design = readFileSync(DESIGN, 'utf8')
    assert.match(design, /strip unrequested features from every approach/)
    assert.match(design, /Unrequested means a second goal/)
    assert.match(design, /keep the pieces the chosen approach needs for its success condition/)
  })
})
