import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CORDIS = join(PRESET_ROOT, 'agent.cordis.yml')
const AGI_LOOP = join(PRESET_ROOT, 'skills', 'agi-loop', 'SKILL.md')
const GOAL_SKILL = join(PRESET_ROOT, 'skills', 'goal-state-machine', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const SCAN = join(PRESET_ROOT, 'agi-gates-scan.mjs')
const SESSION_COGNITION = join(PRESET_ROOT, 'skills', 'session-cognition', 'SKILL.md')

const TEXT_EXT = new Set(['.md', '.yml', '.yaml', '.mjs', '.js'])

const FORBIDDEN = [
  'explicitly says 目标/goal',
  'at most 3 first tasks',
  'at most one `in_progress`',
  'at most one in_progress',
  'never self-start with `create_goal`',
  'initialize ≤3 tasks',
  '≤3 first tasks',
  'Cap the first cut',
  'User-directed only',
  'user-directed only',
  'explicit words only',
  'Never self-start a goal',
  'never self-start one',
  'only when the user explicitly says',
  'never self-start a goal',
  'create_goal',
  'get_goal',
  'update_goal',
  'goal-state-machine',
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, out)
      continue
    }
    const ext = name.slice(name.lastIndexOf('.'))
    if (!TEXT_EXT.has(ext)) continue
    out.push(full)
  }
  return out
}

describe('todo_write queue without create_goal', () => {
  it('drops magic-word create_goal and numeric todo caps from preset sources', () => {
    const files = walk(PRESET_ROOT)
    const hits = []
    for (const file of files) {
      const rel = relative(PRESET_ROOT, file).replaceAll('\\', '/')
      if (rel === 'tests/goal-todo-policy.test.mjs' || rel.startsWith('tests/')) continue
      const text = readFileSync(file, 'utf8')
      for (const token of FORBIDDEN) {
        if (text.includes(token)) hits.push(`${rel}: ${token}`)
      }
      if (/≤3/.test(text)) hits.push(`${rel}: ≤3`)
    }
    assert.deepEqual(hits, [])
  })

  it('does not route long-running work through create_goal; queue is todo_write', () => {
    assert.equal(existsSync(GOAL_SKILL), false)
    const cordis = readFileSync(CORDIS, 'utf8')
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const loop = readFileSync(AGI_LOOP, 'utf8')
    const session = readFileSync(SESSION_COGNITION, 'utf8')
    const superGoals = join(PRESET_ROOT, 'skills', 'super-goals', 'SKILL.md')
    assert.equal(existsSync(superGoals), true)
    const skill = readFileSync(superGoals, 'utf8')
    for (const text of [cordis, superpowers, loop, session, skill]) {
      assert.equal(text.includes('create_goal'), false)
      assert.equal(text.includes('get_goal'), false)
      assert.equal(text.includes('update_goal'), false)
      assert.equal(text.includes('goal-state-machine'), false)
    }
    assert.match(superpowers, /todo_write/)
    assert.match(loop, /todo_write/)
    assert.match(session, /todo_write/)
    assert.match(skill, /super_goals_map/)
    assert.match(cordis, /super_goals_map/)
  })

  it('does not cap todo_write first-cut size or in_progress count', () => {
    const loop = readFileSync(AGI_LOOP, 'utf8')
    const cordis = readFileSync(CORDIS, 'utf8')
    for (const text of [loop, cordis]) {
      assert.equal(/at most 3/i.test(text), false)
      assert.equal(/≤3/.test(text), false)
      assert.equal(/at most one `in_progress`/.test(text), false)
      assert.equal(/at most one in_progress/.test(text), false)
    }
    assert.match(loop, /no numeric cap|as many tasks as the work needs/i)
    assert.match(loop, /independent slices may run [`']?in_progress[`']? together/i)
    assert.match(cordis, /independent slices may run in_progress together/)
    const session = readFileSync(SESSION_COGNITION, 'utf8')
    for (const text of [loop, session]) {
      assert.match(text, /in_progress item\(s\)/)
    }
  })

  it('does not steer an open-ended goal gate', () => {
    const scan = readFileSync(SCAN, 'utf8')
    assert.match(scan, /no open-ended goal gate/)
    assert.match(scan, /'deferral'/)
    assert.equal(scan.includes("id === 'goal'"), false)
    assert.equal(scan.includes('user-directed only'), false)
  })
})

describe('session-notes columns are not Goal/Queue', () => {
  it('does not use Goal or Queue as note section names', () => {
    const notesPath = join(PRESET_ROOT, 'skills', 'session-notes', 'SKILL.md')
    assert.equal(existsSync(notesPath), true)
    const notes = readFileSync(notesPath, 'utf8')
    assert.equal(/^## Goal\b/m.test(notes), false)
    assert.equal(/^## Queue\b/m.test(notes), false)
    assert.match(notes, /^## User$/m)
    assert.match(notes, /^## Facts$/m)
    assert.match(notes, /^## Decisions$/m)
    assert.match(notes, /^## Open$/m)
  })
})
