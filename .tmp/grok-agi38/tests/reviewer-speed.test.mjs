import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')
const REVIEW = join(PRESET_ROOT, 'skills', 'requesting-code-review', 'SKILL.md')
const RECEIVING = join(PRESET_ROOT, 'skills', 'receiving-code-review', 'SKILL.md')
const DISPATCH = join(PRESET_ROOT, 'skills', 'dispatching-parallel-agents', 'SKILL.md')
const AGENT_TEAMS = join(PRESET_ROOT, 'skills', 'agent-teams', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')

function section(text, name) {
  const match = text.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))
  assert.ok(match, `${name} missing or unclosed`)
  return match[1]
}

describe('reviewer is six-slot and off/low', () => {
  it('requesting-code-review fills six slots and pins off/low', () => {
    const text = readFileSync(REVIEW, 'utf8')
    assert.match(text, /## Goal/)
    assert.match(text, /## Scope/)
    assert.match(text, /## Constraints/)
    assert.match(text, /## Inputs/)
    assert.match(text, /## Output format/)
    assert.match(text, /## Acceptance/)
    assert.match(text, /reasoning_effort/)
    assert.match(text, /`off` or `low`/)
    assert.match(text, /not `medium`, `high`, or `xhigh`/)
    assert.match(text, /<parallel_work>/)
    assert.match(text, /Match issues to the slots and stop/)
    assert.match(text, /System1/)
    assert.equal(text.includes('Plan alignment:'), false)
    assert.equal(text.includes('Production: migrations'), false)
    assert.equal(text.includes('If the diff is large, review it in passes'), false)
    assert.match(text, /send_message` to the parent/)
    assert.match(text, /no assistant text/)
    assert.equal(text.includes('speaks only in the final six-slot report'), false)
    assert.match(text, /## Standards/)
    assert.match(text, /## Spec/)
    assert.match(text, /Mysterious Name/)
    assert.match(text, /git diff <fixed-point>\.\.\.HEAD/)
    assert.match(text, /Do not merge them into one severity list/)
    assert.equal(text.includes('`code-review`'), false)
  })

  it('receiving-code-review keeps Standards and Spec separate', () => {
    const text = readFileSync(RECEIVING, 'utf8')
    assert.match(text, /## Standards/)
    assert.match(text, /## Spec/)
    assert.match(text, /Do not merge them into one ranked list/)
    assert.match(text, /Mysterious Name/)
    assert.match(text, /judgement call/)
    assert.equal(text.includes('`code-review`'), false)
  })

  it('persona, dispatch, teams, and superpowers pin reviewer off/low and six slots', () => {
    const parallel = section(readFileSync(PERSONA, 'utf8'), 'parallel_work')
    const dispatch = readFileSync(DISPATCH, 'utf8')
    const teams = readFileSync(AGENT_TEAMS, 'utf8')
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    for (const text of [parallel, dispatch, superpowers]) {
      assert.match(text, /six/)
      assert.match(text, /goal \/ scope/)
      assert.match(text, /acceptance/)
      assert.match(text, /reasoning_effort/)
      assert.match(text, /`off` or `low`/)
    }
    assert.match(parallel, /Do not overthink/)
    assert.match(parallel, /Prefer `off`/)
    assert.match(parallel, /emit tools only/)
    assert.match(parallel, /0 user-facing words/)
    for (const skill of [dispatch, superpowers]) {
      assert.match(skill, /<parallel_work>/)
      assert.equal(skill.includes('Do not overthink'), false)
    }
    assert.match(teams, /Reviewer members pass `off` or `low`/)
    assert.match(teams, /Do not overthink/)
    assert.match(teams, /emit tools only/)
    assert.match(parallel, /The reviewer prompt fills all six slots/)
    assert.match(dispatch, /Fill all six contract slots/)
    for (const text of [parallel, readFileSync(REVIEW, 'utf8'), dispatch, superpowers]) {
      assert.match(text, /session reviewer/)
      assert.match(text, /list_agents/)
      assert.match(text, /send_message/)
      assert.match(text, /run_in_background: false/)
    }
    assert.match(parallel, /that start is one-shot and cannot be reused/)
    assert.match(parallel, /`run_in_background` unset or true/)
    const review = readFileSync(REVIEW, 'utf8')
    assert.match(review, /do not call `subagent` again/)
    assert.match(review, /two self-contained messages to the same standing `session reviewer`/)
    assert.equal(review.includes('Spawn both subagents in parallel'), false)
    assert.match(dispatch, /Code review is not this row/)
  })

  it('spawn persona is silent during work and speaks only in the final parent report', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const re = new RegExp(`toolName: subagent\\n[\\s\\S]*?persona: \\|\\n([\\s\\S]*?)(?:\\n    # |\\n    - id:)`)
    const match = persona.match(re)
    assert.ok(match, 'subagent persona missing')
    const block = match[1]
    assert.match(block, /emit tools only/)
    assert.match(block, /0 user-facing words/)
    assert.match(block, /Speak only in the final parent report/)
    assert.match(block, /six-slot verdict only/)
    assert.match(block, /session reviewer/)
    assert.match(block, /no assistant text/)
    assert.equal(block.includes('speak only in the final six-slot report'), false)
  })
})
