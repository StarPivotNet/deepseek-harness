import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')
const AGI_LOOP = join(PRESET_ROOT, 'skills', 'agi-loop', 'SKILL.md')
const CONV_HEADER = join(PRESET_ROOT, 'grok-conv-header.mjs')

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

describe('simcot policy: silent loop, step-aligned thought, no wasted work', () => {
  it('does not tell the model to restate the tool process to the user', () => {
    const comm = section(readFileSync(PERSONA, 'utf8'), 'communication')
    assert.equal(comm.includes('restate what you did'), false)
    assert.equal(/Speak only when evidence changed/.test(comm), false)
    assert.equal(/before a large write/.test(comm), false)
    assert.match(comm, /tool-by-tool recap/)
    assert.equal(/0 字/.test(comm), false)
    assert.equal(/emit tools only/.test(comm), false)

  it('does not require silence during execution and still delivers the result', () => {
    const comm = section(readFileSync(PERSONA, 'utf8'), 'communication')
    const policy = section(readFileSync(PERSONA, 'utf8'), 'work_policy')
    const loop = readFileSync(AGI_LOOP, 'utf8')
    for (const text of [comm, loop]) {
      assert.equal(/0 字/.test(text), false)
      assert.match(text, /tool-by-tool recap/)
    }
    assert.equal(/执行中/.test(comm), false)
    assert.equal(/Speak only for a user choice/.test(comm), false)
    assert.match(loop, /回溯/)
    assert.match(policy, /request is met/)
  })

  it('maps hidden thought onto a goal stack with English six headings', () => {
    const chain = section(readFileSync(PERSONA, 'utf8'), 'thinking_chain')
    for (const label of ['GOAL', 'BINDINGS', 'CHOICE', 'KILLS', 'ACT']) {
      assert.match(chain, new RegExp(label))
    }
    assert.match(chain, /keep this order: Goal; Constraints; Kills; Live; Choice; Next/)
    assert.match(chain, /GOAL = Goal/)
    assert.match(chain, /BINDINGS = already-proven facts \(Constraints \+ Live that already held\)/)
    assert.match(chain, /CHOICE = Choice/)
    assert.match(chain, /KILLS = Kills/)
    assert.match(chain, /ACT = Next/)
    assert.match(chain, /Put independent slices in Next/)
    for (const zh of ['\u89c2\u6d4b\u73b0\u8c61', '\u786c\u7ea6\u675f\u6e05\u5355', '\u4e0d\u53ef\u80fd\u6e05\u5355', '\u552f\u4e00\u4e3b\u5047\u8bbe', '\u51b3\u7b56\u81ea\u68c0', '\u4e0b\u4e00\u6b65\u884c\u52a8\u65b9\u6848']) {
      assert.equal(chain.includes(zh), false, zh)
    }
    assert.equal(/without renaming/.test(chain), false)
    assert.equal(chain.includes('<|latent|>'), false)
    assert.equal(/JSON schema/.test(chain), false)
  })

  it('backtracks on failure instead of starting a new narrative', () => {
    const chain = section(readFileSync(PERSONA, 'utf8'), 'thinking_chain')
    const policy = section(readFileSync(PERSONA, 'utf8'), 'work_policy')
    const loop = readFileSync(AGI_LOOP, 'utf8')
    for (const text of [chain, policy, loop]) {
      assert.match(text, /CHOICE/)
    }
    assert.match(policy, /third time|第三次/)
    assert.match(loop, /third time|第三次/)
    assert.match(chain, /fail/)
    assert.match(loop, /回溯/)
  })

  it('cuts once evidence is already in context and forbids confirmatory re-probes', () => {
    const chain = section(readFileSync(PERSONA, 'utf8'), 'thinking_chain')
    const policy = section(readFileSync(PERSONA, 'utf8'), 'work_policy')
    const loop = readFileSync(AGI_LOOP, 'utf8')
    for (const text of [chain, policy, loop]) {
      assert.match(text, /\bcut\b/i)
      assert.match(text, /do not `file_read` \/ `glob` \/ `skill` 确认/)
    }
  })

  it('does not add simcot/swipl/strux/htl plugin rows or a mandatory per-round skill', () => {
    const cordis = readFileSync(PERSONA, 'utf8')
    const skills = section(cordis, 'skills')
    assert.equal(/id:\s*(simcot|swipl|strux|htl)\b/.test(cordis), false)
    assert.equal(/load `?(sim-cot|simcot|strux|htl)`/i.test(skills), false)
    for (const name of ['sim-cot', 'simcot', 'struxgpt', 'human-think-language', 'swipl']) {
      assert.equal(existsSync(join(PRESET_ROOT, 'skills', name)), false, name)
    }
  })

  it('keeps in-session prefix-cache affinity and does not rewrite the conv header', () => {
    const header = readFileSync(CONV_HEADER, 'utf8')
    assert.match(header, /prefix-cache affinity within a session/)
    assert.match(header, /never across sessions/)
    assert.match(header, /x-grok-conv-id/)
    assert.match(header, /x-grok-req-id/)
    assert.match(header, /x-grok-turn-idx/)
    assert.match(header, /x-compactions-remaining/)
    assert.match(header, /prev\[key\]/)
    assert.match(header, /name: 'harness:identity'/)
    assert.match(header, /text: ''/)
  })
  it('tells spawn and fork to report to the parent, not to narrate process to the end user', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    for (const toolName of ['subagent', 'subagent_fork']) {
      const block = firstPersonaBlock(persona, toolName)
      assert.match(block, /visible assistant text for the parent/)
      assert.match(block, /end user/)
    }
  })

  it('locks compact private thought: slots, instantiate-first, control tape, no source rewrite', () => {
    const chain = section(readFileSync(PERSONA, 'utf8'), 'thinking_chain')
    assert.match(chain, /slots/)
    assert.match(chain, /instantiate/)
    assert.match(chain, /control tape/)
    assert.match(chain, /do not re-solve/)
    assert.match(chain, /aspects/)
    assert.match(chain, /do not rewrite the source/)
    assert.match(chain, /once\(side-effect\)/)
    assert.equal(chain.includes('<text>'), false)
    assert.equal(chain.includes('<Code>'), false)
    assert.equal(chain.includes('<pause>'), false)
    assert.equal(/```yaml/.test(chain), false)
  })

  it('forbids empty-heading ceremony and restating already-bound facts', () => {
    const chain = section(readFileSync(PERSONA, 'utf8'), 'thinking_chain')
    assert.match(chain, /Fast path/)
    assert.match(chain, /skip headings/)
    assert.match(chain, /one-file typo/)
    assert.match(chain, /read-only config lookup/)
    assert.match(chain, /locate one test/)
    assert.match(chain, /simple Q&A/)
    assert.match(chain, /If a heading has no new decision, omit it/)
    assert.match(chain, /never pad with `\(none\)`/)
    assert.equal(/Empty heading/.test(chain), false)
    assert.match(chain, /do not restate already-bound facts/)
    assert.match(chain, /invalid thinking/)
    assert.match(chain, /fill every heading that has a new decision/)
    assert.equal(/System2 \(high\/max, fill every heading\)(?! that has)/.test(chain), false)
    assert.equal(/DEEP: fill every heading(?! that has)/.test(chain), false)
    assert.equal(/Kills:\s*\(none\)/.test(chain), false)


  })

  it('injects compact thinking discipline into spawn and fork', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    for (const toolName of ['subagent', 'subagent_fork']) {
      const block = firstPersonaBlock(persona, toolName)
      assert.match(block, /control tape/)
      assert.match(block, /slots/)
      assert.match(block, /do not re-solve/)
      assert.match(block, /do not rewrite the source/)
      assert.match(block, /Goal; Constraints; Kills; Live; Choice; Next/)
      assert.match(block, /Fast path/)
      assert.match(block, /skip headings/)
      assert.match(block, /one-file typo/)
      assert.match(block, /read-only config lookup/)
      assert.match(block, /locate one test/)
      assert.match(block, /simple Q&A/)
      assert.match(block, /never pad with `\(none\)`/)
      assert.match(block, /If a heading has no new decision, omit it/)
      assert.match(block, /invalid thinking/)
      assert.match(block, /already-bound/)
      assert.equal(/Empty heading/.test(block), false)

      for (const zh of ['\u89c2\u6d4b\u73b0\u8c61', '\u786c\u7ea6\u675f\u6e05\u5355', '\u4e0d\u53ef\u80fd\u6e05\u5355', '\u552f\u4e00\u4e3b\u5047\u8bbe', '\u51b3\u7b56\u81ea\u68c0', '\u4e0b\u4e00\u6b65\u884c\u52a8\u65b9\u6848']) {
        assert.equal(block.includes(zh), false, zh)
      }
      assert.equal(block.includes('<|latent|>'), false)
      assert.equal(block.includes('<text>'), false)
    }
  })


  it('uses English six headings in compaction and cognition/debug skills', () => {
    const compaction = readFileSync(join(PRESET_ROOT, 'compaction-instruction-v2.mjs'), 'utf8')
    const cognition = readFileSync(join(PRESET_ROOT, 'skills', 'session-cognition', 'SKILL.md'), 'utf8')
    const debug = readFileSync(join(PRESET_ROOT, 'skills', 'systematic-debugging', 'SKILL.md'), 'utf8')
    assert.match(compaction, /six headings \(Goal, Constraints, Kills, Live, Choice, Next\)/)
    assert.match(cognition, /Map thought headings into it: Goal \(one intent line/)
    assert.match(cognition, /Constraints; Kills; Live; Next/)
    assert.match(cognition, /Leave Choice in thoughts as keep\/kill only/)
    assert.match(debug, /In thoughts: Goal = the failure; Kills = killed causes; Live = one cause, not a menu/)
    for (const text of [compaction, cognition, debug]) {
      for (const zh of ['\u89c2\u6d4b\u73b0\u8c61', '\u786c\u7ea6\u675f\u6e05\u5355', '\u4e0d\u53ef\u80fd\u6e05\u5355', '\u552f\u4e00\u4e3b\u5047\u8bbe', '\u51b3\u7b56\u81ea\u68c0', '\u4e0b\u4e00\u6b65\u884c\u52a8\u65b9\u6848']) {
        assert.equal(text.includes(zh), false, zh)
      }
    }
  })
})

describe('session-notes skill is not a second cognition tape', () => {
  it('uses User / Facts / Decisions / Open and forbids Chinese six headings', () => {
    const notes = readFileSync(join(PRESET_ROOT, 'skills', 'session-notes', 'SKILL.md'), 'utf8')
    assert.match(notes, /^## User$/m)
    assert.match(notes, /^## Facts$/m)
    assert.match(notes, /^## Decisions$/m)
    assert.match(notes, /^## Open$/m)
    for (const zh of ['\u89c2\u6d4b\u73b0\u8c61', '\u786c\u7ea6\u675f\u6e05\u5355', '\u4e0d\u53ef\u80fd\u6e05\u5355', '\u552f\u4e00\u4e3b\u5047\u8bbe', '\u51b3\u7b56\u81ea\u68c0', '\u4e0b\u4e00\u6b65\u884c\u52a8\u65b9\u6848']) {
      assert.equal(notes.includes(zh), false, zh)
    }
  })
})
})
