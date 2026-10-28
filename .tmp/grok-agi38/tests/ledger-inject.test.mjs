import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractSections } from '../ledger-inject.mjs'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))

const LEDGER = `# Cognition

## Goal
- [x] 已完成的旧目标一行
- 修 ledger-inject，避免把已完成工作当待办
- board at C:\\Users\\yuluk\\Desktop\\test/.super-goals/session-x/board.json

## Constraints
- 只改用户 preset

## Kills
- 把用户输入语言当成回复语言：否决。

## Live
- 两技能目录已删

## Next
- 写失败测试再改 inject

## Paths
- \`$DSH_HOME/.agent-presets/dsh-grok-agi/ledger-inject.mjs\`

## Queue
- pending: 改 inject
- current: 写测试
- completed: 盘点引用；删两技能目录；19/19 绿
- blocked: (none)
- [x] 盘点引用
`

describe('ledger-inject extractSections drops settled work', () => {
  it('omits checked-off Goal/Queue rows from the injected snapshot', () => {
    const text = extractSections(LEDGER)
    assert.match(text, /## Goal/)
    assert.match(text, /修 ledger-inject/)
    assert.equal(text.includes('已完成的旧目标一行'), false)
    assert.equal(text.includes('- [x]'), false)
    assert.equal(text.includes('[x] 盘点引用'), false)
  })

  it('does not inject Queue completed work as a live task list', () => {
    const text = extractSections(LEDGER)
    assert.match(text, /## Queue/)
    assert.match(text, /pending: 改 inject/)
    assert.match(text, /current: 写测试/)
    assert.equal(text.includes('删两技能目录'), false)
    assert.equal(text.includes('19/19 绿'), false)
    assert.match(text, /completed: \(none\)/)
  })

  it('keeps unchecked live rows and other headings', () => {
    const text = extractSections(LEDGER)
    assert.match(text, /只改用户 preset/)
    assert.match(text, /把用户输入语言当成回复语言/)
    assert.match(text, /写失败测试再改 inject/)
    assert.match(text, /ledger-inject\.mjs/)
  })

  it('treats [X] as checked and keeps an already-empty completed line as (none)', () => {
    const text = extractSections(`## Goal\n- [X] shipped\n- still open\n\n## Queue\n- pending: (none)\n- current: (none)\n- completed: (none)\n- blocked: (none)\n`)
    assert.equal(text.includes('shipped'), false)
    assert.match(text, /still open/)
    assert.equal((text.match(/completed:/g) || []).length, 1)
    assert.match(text, /completed: \(none\)/)
  })

  it('returns empty for blank input, keeps [x] on Kills, and does not let completed text pollute blocked', () => {
    assert.equal(extractSections(''), '')
    assert.equal(extractSections(null), '')
    const text = extractSections(`## Kills\n- [x] 把用户输入语言当成回复语言：否决。\n\n## Queue\n- pending: (none)\n- current: (none)\n- [x] completed: was blocked then fixed\n- blocked: waiting on review\n`)
    assert.match(text, /把用户输入语言当成回复语言/)
    assert.equal((text.match(/completed:/g) || []).length, 1)
    assert.match(text, /completed: \(none\)/)
    assert.equal(text.includes('was blocked then fixed'), false)
    assert.match(text, /blocked: waiting on review/)
  })

  it('keeps the first heading and the first Queue keys, dropping later copies', () => {
    const text = extractSections(`## Goal\n- first goal\n\n## Queue\n- pending: (none)\n- current: t4 验证 + t5 审查\n- completed: 旧完成项\n- blocked: (none)\n- current: AgentTeams 实施（测试先行，再写 skill）\n- completed: (none)\n- blocked: waiting on review\n\n## Goal\n- second goal should drop\n\n## Queue\n- pending: extra\n- current: extra current\n`)
    assert.equal((text.match(/^## Goal/gm) || []).length, 1)
    assert.equal((text.match(/^## Queue/gm) || []).length, 1)
    assert.match(text, /first goal/)
    assert.equal(text.includes('second goal'), false)
    assert.equal(text.includes('extra current'), false)
    assert.equal((text.match(/^- current:/gm) || []).length, 1)
    assert.equal((text.match(/^- completed:/gm) || []).length, 1)
    assert.equal((text.match(/^- blocked:/gm) || []).length, 1)
    assert.equal((text.match(/^- pending:/gm) || []).length, 1)
    assert.match(text, /current: t4 验证 \+ t5 审查/)
    assert.equal(text.includes('AgentTeams 实施'), false)
    assert.equal(text.includes('waiting on review'), false)
    assert.match(text, /completed: \(none\)/)
    assert.equal(text.includes('旧完成项'), false)
  })

  it('does not let a checked-off first Queue key hide a later live copy', () => {
    const text = extractSections(`## Queue\n- [x] pending: old\n- pending: new live\n- current: still open\n`)
    assert.match(text, /pending: new live/)
    assert.equal(text.includes('pending: old'), false)
    assert.match(text, /current: still open/)
    assert.equal((text.match(/^- pending:/gm) || []).length, 1)
  })
})

describe('ledger write policy: check off, then drop unless redo', () => {
  it('teaches the model to mark done with [x] and delete those rows on the next write', () => {
    const cognition = readFileSync(join(PRESET_ROOT, 'skills', 'session-cognition', 'SKILL.md'), 'utf8')
    const loop = readFileSync(join(PRESET_ROOT, 'skills', 'agi-loop', 'SKILL.md'), 'utf8')
    const persona = readFileSync(join(PRESET_ROOT, 'agent.cordis.yml'), 'utf8')
    const compaction = readFileSync(join(PRESET_ROOT, 'compaction-instruction-v2.mjs'), 'utf8')
    for (const text of [cognition, loop]) {
      assert.match(text, /\[x\]/)
      assert.match(text, /下次写/)
      assert.match(text, /重新做|继续改/)
    }
    assert.match(persona, /\[x\]/)
    assert.match(persona, /not current tasks|不是待办/)
    assert.match(persona, /completed:.*\(none\)/)
    assert.match(compaction, /Omit Queue completed/)
    assert.match(compaction, /receipts, not open jobs/)
  })

  it('teaches read-then-replace so headings and Queue keys are not appended twice', () => {
    const cognition = readFileSync(join(PRESET_ROOT, 'skills', 'session-cognition', 'SKILL.md'), 'utf8')
    const loop = readFileSync(join(PRESET_ROOT, 'skills', 'agi-loop', 'SKILL.md'), 'utf8')
    const persona = readFileSync(join(PRESET_ROOT, 'agent.cordis.yml'), 'utf8')
    for (const text of [cognition, loop, persona]) {
      assert.match(text, /读.{0,24}再写|read.{0,40}before.{0,20}write/i)
      assert.match(text, /Replace the Queue|不要追加|do not append/i)
      assert.match(text, /pending.{0,80}current.{0,80}completed.{0,80}blocked/s)
    }
    assert.match(cognition, /读.{0,40}再写/)
    assert.match(cognition, /不要追加第二套|不要追加第二份/)
  })
})

describe('session notes path and workspace ban', () => {
  it('forbids workspace .dsh/notes.md in persona, session-notes, and session-cognition', () => {
    const notes = readFileSync(join(PRESET_ROOT, 'skills', 'session-notes', 'SKILL.md'), 'utf8')
    const cognition = readFileSync(join(PRESET_ROOT, 'skills', 'session-cognition', 'SKILL.md'), 'utf8')
    const persona = readFileSync(join(PRESET_ROOT, 'agent.cordis.yml'), 'utf8')
    for (const text of [notes, cognition, persona]) {
      assert.match(text, /\.dsh\/notes\.md/)
      assert.match(text, /never write workspace|not workspace|never workspace/i)
    }
  })

  it('locks session-notes description to the three-segment home notes.md path', () => {
    const notes = readFileSync(join(PRESET_ROOT, 'skills', 'session-notes', 'SKILL.md'), 'utf8')
    assert.match(notes, /^name: session-notes$/m)
    const desc = notes.match(/^description: ([^\n]+)/m)
    assert.ok(desc, 'frontmatter description missing')
    assert.match(desc[1], /\$DSH_HOME\/cognitions\/<project>\/<sessionId>\/notes\.md/)
    assert.match(desc[1], /context window is small/)
    assert.match(desc[1], /Write that turn/)
  })

  it('tells the persona to write notes the same turn without asking first', () => {
    const persona = readFileSync(join(PRESET_ROOT, 'agent.cordis.yml'), 'utf8')
    assert.match(persona, /Write that notes file the same turn a preference, a decision, a measured fact, or a path would be lost/)
    assert.match(persona, /A stable preference goes into session notes the same turn; do not ask first/)
    assert.match(persona, /Columns are User, Facts, Decisions, Open/)
    assert.match(persona, /Do not copy the ledger/)
    assert.match(persona, /Session notes at `\$DSH_HOME\/cognitions\/<project>\/<sessionId>\/notes\.md` are that same-turn write/)
    assert.match(persona, /Any other named file is written only when the task needs it or the user asked/)
    assert.match(persona, /Do not copy the ledger, Goal, or Queue into it/)
    assert.equal(persona.includes('Ask the user before a stable preference goes into session notes'), false)
    assert.equal(persona.includes('Write a detail into a named file only when the task needs it or the user asked'), false)
  })
})
