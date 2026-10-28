import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')
const STUB = join(PRESET_ROOT, 'agent-teams-stub.mjs')
const DISPATCH = join(PRESET_ROOT, 'skills', 'dispatching-parallel-agents', 'SKILL.md')
const AGENT_TEAMS = join(PRESET_ROOT, 'skills', 'agent-teams', 'SKILL.md')
const AGI_LOOP = join(PRESET_ROOT, 'skills', 'agi-loop', 'SKILL.md')

const QUALITY_BAR =
  'Be fast, accurate, strong, and smart: use live catalog tools, dispatch Agents on 2+ independent domains, never invent tools/facts/file content, never claim without this-turn evidence.'

const HALLUCINATION_PROMPTS = [
  'All files valid',
  'No external validation needed',
  'Errors are glitches',
]

function section(text, name) {
  const match = text.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))
  assert.ok(match, `${name} missing or unclosed`)
  return match[1]
}

function firstPersonaBlock(text, toolName) {
  const re = new RegExp(`toolName: ${toolName}\\n[\\s\\S]*?persona: \\|\\n([\\s\\S]*?)(?:\\n    # |\\n    - id:)`)
  const match = text.match(re)
  assert.ok(match, `${toolName} persona missing`)
  return match[1]
}

describe('quality bar: fast accurate strong smart no-hallucination tools Agents', () => {
  it('locks the same quality bar on parent, children, stub, and dispatch skills', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const surfaces = [
      section(persona, 'work_policy'),
      section(persona, 'parallel_work'),
      firstPersonaBlock(persona, 'subagent'),
      firstPersonaBlock(persona, 'subagent_fork'),
      readFileSync(STUB, 'utf8'),
      readFileSync(DISPATCH, 'utf8'),
      readFileSync(AGENT_TEAMS, 'utf8'),
      readFileSync(AGI_LOOP, 'utf8'),
    ]
    for (const text of surfaces) {
      assert.match(text, new RegExp(QUALITY_BAR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  })

  it('drops identity lines that treat unobserved files and errors as true', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    for (const phrase of HALLUCINATION_PROMPTS) {
      assert.equal(persona.includes(phrase), false, phrase)
    }
  })

  it('gives subagents and AgentTeams members live-catalog and nested-dispatch rules', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const stub = readFileSync(STUB, 'utf8')
    for (const toolName of ['subagent', 'subagent_fork']) {
      const block = firstPersonaBlock(persona, toolName)
      assert.match(block, /Trust this session's tool list/)
      assert.match(block, /Dispatch further read-only `subagent`s/)
    }
    assert.match(stub, /dsh-agent-teams 0\.1\.23 memberMaxDepth defaults to 0/)
    assert.match(stub, /Trust this session(?:\\')?'s tool list|Trust this session tool list/)
  })

  it('tells parent and children to omit limit or use a large limit instead of many small reads', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const calling = section(persona, 'tool_calling')
    assert.match(calling, /omit `limit`/)
    assert.match(calling, /whole file/)
    assert.match(calling, /large `limit`/)
    assert.match(calling, /500/)
    assert.match(calling, /many small/)
    for (const toolName of ['subagent', 'subagent_fork']) {
      const block = firstPersonaBlock(persona, toolName)
      assert.match(block, /omit `limit`/)
      assert.match(block, /whole file/)
      assert.match(block, /large `limit`/)
    }
  })
})
