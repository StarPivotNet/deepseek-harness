import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKILL = join(PRESET_ROOT, 'skills', 'design-before-build', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')

describe('design-before-build borrows brainstorming process, not Superpowers ceremony', () => {
  it('keeps spike / bounded / architectural and the plan-mode gate', () => {
    const text = readFileSync(SKILL, 'utf8')
    assert.match(text, /\*\*Spike\*\*/)
    assert.match(text, /\*\*Bounded\*\*/)
    assert.match(text, /\*\*Architectural\*\*/)
    assert.match(text, /enter_plan_mode/)
    assert.match(text, /exit_plan_mode/)
    assert.match(text, /Classify out loud in thoughts \(not as user-facing ceremony\)/)
  })

  it('borrows shared understanding, decompose, 2-3 approaches, and plan self-review', () => {
    const text = readFileSync(SKILL, 'utf8')
    assert.match(text, /## Shared understanding/)
    assert.match(text, /Discover intent/)
    assert.match(text, /Write the understanding back/)
    assert.match(text, /Carry it forward/)
    assert.match(text, /multiple independent subsystems/)
    assert.match(text, /2–3 approaches/)
    assert.match(text, /### Plan self-review \(before `exit_plan_mode`\)/)
    assert.match(text, /Placeholder scan/)
    assert.match(text, /Internal consistency/)
    assert.match(text, /see vs read|seeing beats reading/)
    assert.match(text, /live browser/)
    assert.match(text, /`present`/)
  })

  it('does not require spec files, writing-plans, companion servers, or TDD', () => {
    const text = readFileSync(SKILL, 'utf8')
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'brainstorming')), false)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'design-before-build', 'visual-companion.md')), false)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'design-before-build', 'scripts')), false)
    assert.match(text, /Do \*\*not\*\* write a spec file in the repo/)
    assert.match(text, /Do not invoke a writing-plans skill/)
    assert.match(text, /Never copy or launch a companion server/)
    assert.match(text, /Do not offer a companion as its own message/)
    assert.equal(text.includes('TDD applies'), false)
    assert.equal(text.includes('docs/superpowers/specs/YYYY-MM-DD'), false)
    assert.equal(text.includes('start-server.sh'), false)
  })

  it('pins optional plan reviewer to six-slot off/low never-fork and using-superpowers still bans spec files', () => {
    const text = readFileSync(SKILL, 'utf8')
    assert.match(text, /plan reviewer/)
    assert.match(text, /six-slot|six slots/)
    assert.match(text, /goal \/ scope/)
    assert.match(text, /acceptance/)
    assert.match(text, /never fork/)
    assert.match(text, /`off` or `low`/)
    assert.match(text, /not `medium`, `high`, or `xhigh`/)
    assert.equal(text.includes('spec reviewer'), false)
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    assert.match(superpowers, /No spec or plan files in the repo unless the user asked for a file/)
    assert.match(superpowers, /not a spec file in the repo/)
    assert.match(superpowers, /No companion server/)
    assert.match(superpowers, /live browser tools or `present`/)
  })

  it('does not route removed frontend skills', () => {
    const text = readFileSync(SKILL, 'utf8')
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    assert.equal(text.includes('Load `illustration` before drawing'), false)
    assert.equal(superpowers.includes('`illustration`'), false)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'illustration')), false)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'visual-design')), false)
  })
})
