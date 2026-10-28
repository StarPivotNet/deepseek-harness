import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')

function section(text, name) {
  const match = text.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))
  assert.ok(match, `${name} missing or unclosed`)
  return match[1]
}

describe('engineering and communication bars live in persona', () => {
  it('locks conservative engineering judgment, ASCII default, dirty-tree, and review stance', () => {
    const making = section(readFileSync(PERSONA, 'utf8'), 'making_code_changes')
    assert.match(making, /choose conservatively/)
    assert.match(making, /existing patterns, frameworks, and local helper APIs/)
    assert.match(making, /structured APIs or parsers/)
    assert.match(making, /ad hoc string manipulation/)
    assert.match(making, /add an abstraction only when/)
    assert.match(making, /test coverage scale with risk/)
    assert.match(making, /Default to ASCII/)
    assert.match(making, /NEVER revert existing changes you did not make/)
    assert.match(making, /git reset --hard/)
    assert.match(making, /git checkout --/)
    assert.match(making, /prefer non-interactive git/)
    assert.match(making, /If the user asks for a review/)
    assert.match(making, /lead with findings/)
    assert.match(making, /path:line/)
    assert.match(making, /remaining test gaps or residual risk/)
  })

  it('locks communication: no cheerleading, no If-you-want close, newest request steers', () => {
    const comm = section(readFileSync(PERSONA, 'utf8'), 'communication')
    assert.match(comm, /Avoid cheerleading/)
    assert.match(comm, /never patronize/)
    assert.match(comm, /If you could not do something/)
    assert.match(comm, /never end with an "If you want" sentence/)
    assert.match(comm, /Do not praise a plan by contrasting it with an implied worse alternative/)
    assert.match(comm, /Never talk about goblins, gremlins, raccoons, trolls, ogres, pigeons/)
    assert.match(comm, /newest conflicting request steers/)
    assert.match(comm, /Never dump a complete HTML\/SVG page into chat/)
  })

  it('locks Clarity, Pragmatism, and Rigor as closing-message tone, not a skill', () => {
    const comm = section(readFileSync(PERSONA, 'utf8'), 'communication')
    assert.match(comm, /Clarity/)
    assert.match(comm, /Pragmatism/)
    assert.match(comm, /Rigor/)
    assert.match(comm, /not a skill/)
    assert.match(comm, /not execution chatter/)
    assert.match(comm, /closing-message tone/)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'values')), false)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'clarity')), false)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'pragmatism')), false)
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'rigor')), false)
  })

  it('locks formatting: flat lists, 1. 2. 3., Title Case headers, no em dashes', () => {
    const formatting = section(readFileSync(PERSONA, 'utf8'), 'formatting')
    assert.match(formatting, /Keep lists flat/)
    assert.match(formatting, /Numbered lists use `1\. 2\. 3\.`/)
    assert.match(formatting, /never `1\)`/)
    assert.match(formatting, /Title Case/)
    assert.match(formatting, /Don't use emojis or em dashes unless explicitly instructed/)
  })

  it('does not paste Codex-only channels or tools, and does not cite 1.txt', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const making = section(persona, 'making_code_changes')
    const comm = section(persona, 'communication')
    const formatting = section(persona, 'formatting')
    for (const text of [making, comm, formatting]) {
      assert.equal(text.includes('apply_patch'), false)
      assert.equal(text.includes('exec_command'), false)
      assert.equal(text.includes('multi_tool_use'), false)
      assert.equal(text.includes('commentary'), false)
      assert.equal(text.includes('1.txt'), false)
    }
    assert.equal(existsSync(join(PRESET_ROOT, '_extract_1txt.py')), false)
    assert.equal(existsSync(join(PRESET_ROOT, '_1txt_extract.txt')), false)
  })

})
