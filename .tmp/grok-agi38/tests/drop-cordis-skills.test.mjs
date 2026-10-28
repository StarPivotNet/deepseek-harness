import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const BANNED_DIRS = ['editing-cordis-compositions', 'cordis-plugin-development', 'engineering-discipline']
const BANNED_PHRASES = [...BANNED_DIRS, 'engineering discipline']
const TEXT_EXT = new Set(['.md', '.yml', '.yaml', '.mjs', '.js'])

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

describe('drop editing-cordis-compositions, cordis-plugin-development, and engineering-discipline', () => {
  it('removes banned skill directories', () => {
    for (const name of BANNED_DIRS) {
      assert.equal(existsSync(join(PRESET_ROOT, 'skills', name)), false, name)
    }
  })

  it('drops banned names from preset sources', () => {
    const hits = []
    for (const file of walk(PRESET_ROOT)) {
      const rel = relative(PRESET_ROOT, file).replaceAll('\\', '/')
      if (rel === 'tests/drop-cordis-skills.test.mjs') continue
      const text = readFileSync(file, 'utf8')
      for (const name of BANNED_PHRASES) {
        if (text.includes(name)) hits.push(`${rel}: ${name}`)
      }
    }
    assert.deepEqual(hits, [])
  })
})
