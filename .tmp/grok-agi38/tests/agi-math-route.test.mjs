import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const MATH = join(PRESET_ROOT, 'skills', 'agi-math')
const SKILL = join(MATH, 'SKILL.md')
const SOLVE = join(MATH, 'solve.md')
const ACTIVATE = join(MATH, 'activate.md')
const METHODS = join(MATH, 'methods.md')

describe('agi-math routes closed problems and mechanism construction', () => {
  it('points the entry at the two branch files and keeps the research pipeline', () => {
    const skill = readFileSync(SKILL, 'utf8')
    assert.match(skill, /solve\.md/)
    assert.match(skill, /activate\.md/)
    assert.match(skill, /Long-research verification/)
    assert.match(skill, /Concept audit/)
    assert.match(skill, /two independent checks/)
    assert.match(skill, /proof of a closed statement/)
    assert.equal(/Read the `methods\.md` index first/.test(skill), false)
    assert.equal(skill.includes('math-research-activator'), false)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'math-research-activator')), false)
  })

  it('states closed-problem checks without copying an external skill tree', () => {
    const solve = readFileSync(SOLVE, 'utf8')
    assert.match(solve, /two independent/)
    assert.match(solve, /do not offer the candidate as the answer/)
    assert.match(solve, /proof of a closed statement/)
    assert.match(solve, /calculator/)
    assert.match(solve, /scientific-notation literals/)
    assert.match(solve, /Domain/)
    assert.equal(solve.includes('978-0-521-83940-2'), false)
    assert.equal(existsSync(join(MATH, 'knowledge-base')), false)
    assert.equal(existsSync(join(MATH, 'design-patterns')), false)
  })

  it('judges activation by the guarantee and refuses exploit procedure', () => {
    const activate = readFileSync(ACTIVATE, 'utf8')
    assert.match(activate, /Domain/)
    assert.match(activate, /knowledge gap|temporary note/i)
    assert.match(activate, /adversary/)
    assert.match(activate, /Pure cryptography does not use the table/)
    assert.match(activate, /Do not write exploit/)
    assert.equal(/symmetry \(an invariant\)/.test(activate), false)
    assert.equal(activate.includes('978-1-133-59971-5'), false)
    assert.equal(/lenses\/|knowledge-base\/|design-patterns\//.test(activate), false)
  })

  it('indexes both branches from methods.md', () => {
    const methods = readFileSync(METHODS, 'utf8')
    assert.match(methods, /solve\.md/)
    assert.match(methods, /activate\.md/)
    assert.match(methods, /## 16\. Closed problems/)
    assert.match(methods, /## 17\. Mechanism construction/)
    assert.match(methods, /This section is the rule body/)
    assert.equal(/rule body is in `SKILL\.md`/.test(methods), false)
  })

  it('keeps the superpowers math route on agi-math', () => {
    const route = readFileSync(join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md'), 'utf8')
    assert.match(route, /solution checking/)
    assert.match(route, /mathematical construction/)
    assert.match(route, /`agi-math`/)
  })
})
