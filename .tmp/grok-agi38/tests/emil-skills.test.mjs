import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')

describe('Emil Kowalski skills are vendored into grok-agi', () => {
  it('does not ship the removed Swift skill', () => {
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'write-swift')), false)
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    assert.equal(superpowers.includes('`write-swift`'), false)
  })
})
