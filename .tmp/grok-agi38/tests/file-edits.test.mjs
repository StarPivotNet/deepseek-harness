import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')

describe('file_edit batches use exact literal replacements', () => {
  it('keeps file tool rules in the always-on persona', () => {
    const text = readFileSync(PERSONA, 'utf8')
    assert.equal(text.includes('file-edits'), false)
    assert.match(text, /one or more existing files in one call/)
    assert.match(text, /can be edited again immediately/)
    assert.match(text, /old_string/)
    assert.match(text, /replace_all/)
    assert.match(text, /Do not retry the same failing `old_string`/)
    assert.match(text, /Do not split one logical change/)
    assert.equal(text.includes('`anchor_from`'), false)
  })

  it('the always-on persona uses file_read, file_write, and file_edit', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    assert.match(persona, /`file_read` \/ `file_write` \/ `file_edit` \/ `file_move`/)
    assert.match(persona, /The source stays until the destination matches/)
    assert.match(superpowers, /`file_move`/)
    assert.match(persona, /exact literal replacements/)
    assert.match(persona, /old_string/)
    assert.match(persona, /new_string/)
    assert.match(persona, /replace_all/)
    assert.equal(persona.includes('str_replace_editor'), false)
    assert.equal(persona.includes('HASH-anchor protocol'), false)
    assert.equal(persona.includes('spawn_agent'), false)
    assert.match(superpowers, /`file_read` \/ `file_edit` \/ `file_write`/)
    assert.match(superpowers, /`file_move`/)
    assert.match(superpowers, /old_string/)
    assert.equal(persona.includes('`anchor_from`'), false)
  })

  it('treats a missing or ambiguous literal as a re-read', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    assert.match(persona, /old_string/)
    assert.match(persona, /re-read/)
    assert.match(persona, /ambiguous/)
  })
})

