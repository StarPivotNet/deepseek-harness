import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const TEXT_EXT = new Set(['.md', '.yml', '.yaml', '.mjs', '.js'])
const LOCK = 'tests/sha256-submit-removed.test.mjs'
const SKIP_DIR = new Set(['node_modules', '.git', 'vendor', 'tests'])
const BANNED = [
  'Get-FileHash',
  'sha256sum',
  'SHA-256 receipts',
  'Hash the deliverable',
  'Shipping evidence hashes',
  '{path, sha256}',
  'SHA-256',
  'lowercase 64-hex',
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue
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

describe('SHA-256 submit copy is removed from grok-agi', () => {
  it('drops SHA-256 receipt / submit tokens from preset sources except vendor and this lock', () => {
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

  it('keeps this-turn command proof without hash receipts', () => {
    const persona = readFileSync(join(PRESET_ROOT, 'agent.cordis.yml'), 'utf8')
    const verification = persona.match(/<validating>\s*([\s\S]*?)\s*<\/validating>/)[1]
    assert.equal(persona.includes('verification-before-completion'), false)
    assert.match(verification, /this-turn command proof from the Gate/)
    assert.match(verification, /`present` if the user asked to receive them/)
    assert.equal(verification.includes('## Shipping evidence hashes'), false)
  })
})
