import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKILLS_DIR = join(PRESET_ROOT, 'skills')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const TEXT_EXT = new Set(['.md', '.yml', '.yaml', '.mjs', '.js'])
const LOCK = 'tests/tdd-removed.test.mjs'
const BANNED = [
  'test-driven-development',
  'tdd-policy',
  'failing-test-first',
  'change the test first',
  'Failing test before',
  'I know TDD',
]

function skillNames() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && readdirSync(join(SKILLS_DIR, entry.name)).length > 0)
    .map((entry) => entry.name)
}

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

describe('test-driven-development is removed from grok-agi', () => {
  it('has no test-driven-development skill directory', () => {
    assert.equal(existsSync(join(SKILLS_DIR, 'test-driven-development')), false)
    for (const name of skillNames()) {
      assert.equal(/tdd|test-driven/i.test(name), false, name)
    }
  })

  it('does not keep the old tdd-policy test besides this lock', () => {
    assert.equal(existsSync(join(PRESET_ROOT, 'tests', 'tdd-policy.test.mjs')), false)
  })

  it('does not route work to test-driven-development in using-superpowers', () => {
    const text = readFileSync(SUPERPOWERS, 'utf8')
    assert.equal(text.includes('test-driven-development'), false)
    assert.equal(text.includes('I know TDD'), false)
  })

  it('drops TDD tokens from preset sources except this lock', () => {
    const hits = []
    for (const file of walk(PRESET_ROOT)) {
      const rel = relative(PRESET_ROOT, file).replaceAll('\\', '/')
      if (rel === LOCK) continue
      const text = readFileSync(file, 'utf8')
      for (const token of BANNED) {
        if (text.includes(token)) hits.push(`${rel}: ${token}`)
      }
    }
    assert.deepEqual(hits, [])
  })
})
