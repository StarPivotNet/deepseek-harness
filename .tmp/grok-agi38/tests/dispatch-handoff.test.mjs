import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')
const DISPATCH = join(PRESET_ROOT, 'skills', 'dispatching-parallel-agents', 'SKILL.md')
const AGENT_TEAMS = join(PRESET_ROOT, 'skills', 'agent-teams', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const STUB = join(PRESET_ROOT, 'agent-teams-stub.mjs')

function section(text, name) {
  const match = text.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))
  assert.ok(match, `${name} missing or unclosed`)
  return match[1]
}

describe('dispatch handoff is self-contained; skip AgentTeams for small work', () => {
  it('requires complete standalone prompts for subagent and AgentTeams tasks', () => {
    const persona = section(readFileSync(PERSONA, 'utf8'), 'parallel_work')
    const dispatch = readFileSync(DISPATCH, 'utf8')
    const teams = readFileSync(AGENT_TEAMS, 'utf8')
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const stub = readFileSync(STUB, 'utf8')
    for (const text of [persona, dispatch, teams, superpowers, stub]) {
      assert.match(text, /complete, standalone/)
      assert.match(text, /does not share this conversation/)
      assert.match(text, /goal \/ scope/)
      assert.match(text, /acceptance/)
    }
  })

  it('does not start AgentTeams for one-file or this-turn-only work', () => {
    const persona = section(readFileSync(PERSONA, 'utf8'), 'parallel_work')
    const dispatch = readFileSync(DISPATCH, 'utf8')
    const teams = readFileSync(AGENT_TEAMS, 'utf8')
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const stub = readFileSync(STUB, 'utf8')
    for (const text of [persona, dispatch, teams, superpowers, stub]) {
      assert.equal(text.includes('whenever the work edits files'), false)
      assert.match(text, /Do not start AgentTeams for one-file/)
      assert.match(text, /this-turn-only/)
    }
  })
})

function firstPersonaBlock(text, toolName) {
  const re = new RegExp(`toolName: ${toolName}\\n[\\s\\S]*?persona: \\|\\n([\\s\\S]*?)(?:\\n    # |\\n    - id:)`)
  const match = text.match(re)
  assert.ok(match, `${toolName} persona missing`)
  return match[1]
}

describe('child reasoning_effort is off/low/medium, not high/xhigh', () => {
  it('tells the parent to set child effort on spawn and AgentTeams', () => {
    const parallel = section(readFileSync(PERSONA, 'utf8'), 'parallel_work')
    const dispatch = readFileSync(DISPATCH, 'utf8')
    const teams = readFileSync(AGENT_TEAMS, 'utf8')
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const stub = readFileSync(STUB, 'utf8')
    for (const text of [parallel, dispatch, teams, superpowers, stub]) {
      assert.match(text, /reasoning_effort/)
      assert.match(text, /\boff\b/)
      assert.match(text, /\blow\b/)
      assert.match(text, /\bmedium\b/)
      assert.match(text, /not `high` or `xhigh`/)
    }
  })

  it('tells nested spawn dispatch to pass cheap effort, and notes fork cannot', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const parallel = section(persona, 'parallel_work')
    assert.match(parallel, /Fork inherits/)
    assert.match(parallel, /prefer spawn/)
    const spawn = firstPersonaBlock(persona, 'subagent')
    assert.match(spawn, /reasoning_effort/)
    assert.match(spawn, /not `high` or `xhigh`/)
  })
})
