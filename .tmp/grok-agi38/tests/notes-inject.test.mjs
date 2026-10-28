import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractSections } from '../notes-inject.mjs'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))

const NOTES = `# Session notes

## User
- asked for a notes.md snapshot
- [x] receipt of a prior ask

## Facts
- notes keep checked-off rows
- [X] another receipt

## Decisions
- keep the first heading copy
- [x] decided to retain receipts

## Open
- still open item

## Other
- dropped heading body

## User
- second User copy should drop

## Facts
- second Facts copy should drop
`

describe('notes-inject extractSections', () => {
  it('keeps User / Facts / Decisions / Open and drops other headings', () => {
    const text = extractSections(NOTES)
    assert.match(text, /^## User$/m)
    assert.match(text, /^## Facts$/m)
    assert.match(text, /^## Decisions$/m)
    assert.match(text, /^## Open$/m)
    assert.match(text, /asked for a notes\.md snapshot/)
    assert.match(text, /notes keep checked-off rows/)
    assert.match(text, /keep the first heading copy/)
    assert.match(text, /still open item/)
    assert.equal(text.includes('## Other'), false)
    assert.equal(text.includes('dropped heading body'), false)
  })

  it('keeps the FIRST copy of duplicate headings only', () => {
    const text = extractSections(NOTES)
    assert.equal((text.match(/^## User$/gm) || []).length, 1)
    assert.equal((text.match(/^## Facts$/gm) || []).length, 1)
    assert.match(text, /asked for a notes\.md snapshot/)
    assert.equal(text.includes('second User copy'), false)
    assert.equal(text.includes('second Facts copy'), false)
  })

  it('caps at 4000 chars then appends newline plus ellipsis', () => {
    const body = 'x'.repeat(5000)
    const text = extractSections(`## User\n${body}`)
    assert.equal(text.endsWith('\n…'), true)
    assert.equal(text.length, 4002)
    assert.equal(text.slice(0, 4000), `## User\n${'x'.repeat(3992)}`)
  })

  it('keeps lines matching checked-off receipts', () => {
    const text = extractSections(NOTES)
    assert.match(text, /^\s*-\s*\[x\] receipt of a prior ask$/m)
    assert.match(text, /^\s*-\s*\[X\] another receipt$/m)
    assert.match(text, /^\s*-\s*\[x\] decided to retain receipts$/m)
    assert.match(text, /\[x\]/)
  })

  it('returns empty string for empty or non-string input', () => {
    assert.equal(extractSections(''), '')
    assert.equal(extractSections(null), '')
    assert.equal(extractSections(undefined), '')
    assert.equal(extractSections(12), '')
  })
})

describe('notes-inject source lock', () => {
  it('imports notesPathFor, PLUGIN dsh-grok-code-notes-inject, cognition:notes, MAX 4000, pre-step prepend, step 1, never writes', () => {
    const src = readFileSync(join(PRESET_ROOT, 'notes-inject.mjs'), 'utf8')
    assert.match(src, /import\s*\{[^}]*notesPathFor[^}]*\}\s*from\s*[']\.\/cognition-path\.mjs[']/)
    assert.equal(src.includes('ledgerPathFor'), false)
    assert.match(src, /dsh-grok-code-notes-inject/)
    assert.match(src, /cognition:notes/)
    assert.match(src, /4000/)
    assert.match(src, /agent\/pre-step/)
    assert.match(src, /prepend:\s*true/)
    assert.match(src, /step !== 1/)
    assert.equal(/writeText|writeFile|mkdir|createWriteStream/.test(src), false)
    assert.match(src, /export function apply\(/)
  })
})
