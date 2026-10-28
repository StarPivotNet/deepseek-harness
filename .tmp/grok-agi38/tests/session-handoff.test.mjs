import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const HANDOFF = join(PRESET_ROOT, 'skills', 'session-handoff', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')

describe('session-handoff is a DSH background subagent', () => {
  it('launches subagent and does not call the Claude CLI', () => {
    const text = readFileSync(HANDOFF, 'utf8')
    assert.match(text, /^---\r?\nname: session-handoff\r?\n/)
    assert.match(text, /run_in_background: true/)
    assert.match(text, /`subagent`/)
    assert.match(text, /`send_message`/)
    assert.match(text, /`list_agents`/)
    assert.match(text, /Suggested skills/)
    assert.match(text, /Redact/)
    assert.equal(text.includes('claude --bg'), false)
    assert.equal(text.includes('claude agents'), false)
    assert.equal(text.includes('argument-hint'), false)
    assert.match(text, /Do not fork a child that inherits this conversation/)
  })

  it('routes from using-superpowers', () => {
    const text = readFileSync(SUPERPOWERS, 'utf8')
    assert.match(text, /`session-handoff`/)
    assert.equal(text.includes('claude-handoff'), false)
  })
})
