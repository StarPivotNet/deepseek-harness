import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply, registerSection } from '../official-file-prompt-shadow.mjs'

const CORDIS = join(process.env.DSH_HOME, '.agent-presets', 'dsh-grok-agi', 'agent.cordis.yml')

describe('official file prompt shadow', () => {
  it('replaces a duplicate section in the current scope', () => {
    const existing = { name: 'tool:read', order: 1, text: 'old' }
    const scope = Symbol('dsh.scope')
    registerSection({
      ctx: { [scope]: 'preset-scope' },
      layers: {
        peek: (candidate) => {
          assert.equal(candidate, 'preset-scope')
          return { sections: { data: new Map([['tool:read', existing]]) } }
        },
      },
      section() {
        throw new Error('prompt section "tool:read" is already registered in this scope')
      },
    }, { name: 'tool:read', order: 1100, text: '' })
    assert.deepEqual(existing, { name: 'tool:read', order: 1100, text: '' })
  })

  it('registers empty file and web surface sections', () => {
    const sections = []
    const orders = []
    apply({
      systemPrompt: {
        getSectionOrder(name) {
          orders.push(name)
          return ({ TOOL_READ: 1100, TOOL_WRITE: 1200, TOOL_EDIT: 1300, WEB_SURFACE: 10100 })[name]
        },
        section(section) {
          sections.push(section)
        },
      },
    })
    assert.deepEqual(orders, ['TOOL_READ', 'TOOL_WRITE', 'TOOL_EDIT', 'WEB_SURFACE'])
    assert.deepEqual(sections, [
      { name: 'tool:read', order: 1100, text: '' },
      { name: 'tool:write', order: 1200, text: '' },
      { name: 'tool:edit', order: 1300, text: '' },
      { name: 'app:web-surface', order: 10100, text: '' },
    ])
  })

  it('mounts the shadow for tool:read, tool:write, and tool:edit', () => {
    const cordis = readFileSync(CORDIS, 'utf8')
    assert.match(cordis, /id: official-file-prompt-shadow\s+name: \.\/official-file-prompt-shadow\.mjs/)
    assert.match(cordis, /`tool:read`, `tool:write`, and `tool:edit`, plus\r?\n# `app:web-surface`/)
  })
})
