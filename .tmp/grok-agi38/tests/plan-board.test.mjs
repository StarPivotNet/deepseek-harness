import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CORDIS = join(PRESET_ROOT, 'agent.cordis.yml')
const SUPER_GOALS = join(PRESET_ROOT, 'skills', 'super-goals', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')

describe('super-goals skill routes the durable DAG', () => {
  it('ships skills/super-goals/SKILL.md with map/edit/next/update and no project path parameter', () => {
    assert.equal(existsSync(SUPER_GOALS), true)
    const skill = readFileSync(SUPER_GOALS, 'utf8')
    assert.match(skill, /super_goals_map/)
    assert.match(skill, /super_goals_edit/)
    assert.match(skill, /super_goals_next/)
    assert.match(skill, /super_goals_update/)
    assert.match(skill, /no path parameter/)
    assert.equal(/\bproject\b[^\n]{0,40}parameter|parameter[^\n]{0,40}\bproject\b/i.test(skill), false)
  })

  it('using-superpowers maps PLAN_NOT_FOUND to init_board plus add_node', () => {
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    assert.match(superpowers, /super-goals/)
    assert.match(superpowers, /PLAN_NOT_FOUND/)
    assert.match(superpowers, /init_board/)
    assert.match(superpowers, /add_node/)
  })

  it('does not require a vendored dsh-plan-board path', () => {
    const cordis = readFileSync(CORDIS, 'utf8')
    assert.equal(existsSync(join(PRESET_ROOT, 'vendor', 'dsh-plan-board')), false)
    assert.equal(/vendor\/dsh-plan-board/.test(cordis), false)
    assert.equal(/id:\s*dsh-plan-board/.test(cordis), false)
  })

  it('treats PLAN_NOT_FOUND as init_board, not a missing path argument', () => {
    const skill = readFileSync(SUPER_GOALS, 'utf8')
    assert.match(skill, /PLAN_NOT_FOUND/)
    assert.match(skill, /init_board/)
    assert.match(skill, /add_node/)
    assert.match(skill, /reason/)
    assert.match(skill, /Do not wait for panel confirmation/i)
    assert.match(skill, /same `ops`|same ops/i)
  })

  it('ships a copy-pasteable super_goals_edit ops example with module parent and task', () => {
    const skill = readFileSync(SUPER_GOALS, 'utf8')
    assert.match(
      skill,
      /"op":\s*"init_board"[\s\S]*?"op":\s*"add_node"[\s\S]*?"type":\s*"module"[\s\S]*?"op":\s*"add_node"[\s\S]*?"type":\s*"task"[\s\S]*?"parent"/,
    )
    assert.match(skill, /BAD_PARENT/)
  })

  it('documents L1 SINGLE_ISSUE, L3 EVIDENCE_REQUIRED, and status only via update', () => {
    const skill = readFileSync(SUPER_GOALS, 'utf8')
    assert.match(skill, /SINGLE_ISSUE/)
    assert.match(skill, /EVIDENCE_REQUIRED/)
    assert.match(skill, /STATUS_VIA_TASK_UPDATE|super_goals_edit does not accept status/i)
    assert.match(skill, /taskId/)
    assert.match(skill, /DRIFT_BLOCKED/)
    assert.match(skill, /canceled.{0,80}planned/)
    assert.match(skill, /completion/)
    assert.match(skill, /required/)
    assert.match(skill, /optional/)
    assert.match(skill, /auto-settle/)
  })

  it('documents required vs optional module roots and explicit optional close', () => {
    const skill = readFileSync(SUPER_GOALS, 'utf8')
    assert.match(skill, /completion\?` \(`required`/)
    assert.match(skill, /default `required`/)
    assert.match(skill, /optional-root/)
    assert.match(skill, /explicitly `done`|explicitly done/i)
    assert.match(skill, /__root__/)
    assert.match(skill, /Do not invent a second node type/)
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    assert.match(superpowers, /completion/)
    assert.match(superpowers, /optional/)
    const loop = readFileSync(join(PRESET_ROOT, 'skills', 'agi-loop', 'SKILL.md'), 'utf8')
    assert.match(loop, /completion/)
    assert.match(loop, /optional/)
  })

  it('persona work_policy names PLAN_NOT_FOUND, same ops, and task parent', () => {
    const cordis = readFileSync(CORDIS, 'utf8')
    assert.match(cordis, /PLAN_NOT_FOUND/)
    assert.match(cordis, /super_goals_map/)
    assert.match(cordis, /super_goals_edit/)
    assert.match(cordis, /super_goals_next/)
    assert.match(cordis, /super_goals_update/)
    assert.match(cordis, /same `ops`|same ops/i)
    assert.match(cordis, /parent/)
    assert.match(cordis, /evidence/)
  })

  it('agi-loop durable path starts with super_goals_map and PLAN_NOT_FOUND recovery', () => {
    const loop = readFileSync(join(PRESET_ROOT, 'skills', 'agi-loop', 'SKILL.md'), 'utf8')
    assert.match(loop, /PLAN_NOT_FOUND/)
    assert.match(loop, /super_goals_map/)
    assert.match(loop, /init_board/)
    const loopBlock = loop.match(/## Loop[\s\S]*?```[\s\S]*?```/)
    assert.ok(loopBlock, 'agi-loop Loop fence missing')
    assert.match(loopBlock[0], /super_goals_map/)
  })
})
