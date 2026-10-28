import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const ROOT = join(PRESET_ROOT, 'skills', 'pocock-prototype')
const FILES = ['SKILL.md', 'LOGIC.md', 'UI.md']

describe('pocock-prototype is a DSH throwaway prototype', () => {
  it('uses DSH files and does not require git or an issue tracker', () => {
    const text = FILES.map((name) => readFileSync(join(ROOT, name), 'utf8')).join('\n')
    assert.match(text, /^---\r?\nname: pocock-prototype\r?\n/)
    assert.match(text, /`file_write`/)
    assert.match(text, /`present`/)
    assert.match(text, /`pwsh`/)
    assert.match(text, /do not commit or create a branch unless the user asks/)
    assert.equal(text.includes('throwaway branch'), false)
    assert.equal(text.includes('implementation issue'), false)
    assert.equal(text.includes('git commit'), false)
  })
})
