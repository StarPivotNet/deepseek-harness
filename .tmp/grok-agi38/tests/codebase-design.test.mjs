import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const ROOT = join(PRESET_ROOT, 'skills', 'codebase-design')

describe('codebase-design uses DSH read-only subagents', () => {
  it('dispatches subagent and does not cite a missing glossary', () => {
    const skill = readFileSync(join(ROOT, 'SKILL.md'), 'utf8')
    const twice = readFileSync(join(ROOT, 'DESIGN-IT-TWICE.md'), 'utf8')
    assert.match(skill, /^---\r?\nname: codebase-design\r?\n/)
    assert.match(skill, /`file_read`/)
    assert.match(twice, /read-only `subagent`/)
    assert.match(twice, /`reasoning_effort`/)
    assert.match(twice, /same turn/)
    assert.equal(twice.includes('GLOSSARY.md'), false)
    assert.equal(twice.includes('sub-agent'), false)
    assert.equal(twice.includes('sub-agents'), false)
  })
})
