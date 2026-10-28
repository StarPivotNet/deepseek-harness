import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const ROOT = join(PRESET_ROOT, 'skills', 'writing-for-agents')

describe('writing-for-agents uses DSH skill files', () => {
  it('writes skills with file tools and does not hide them by frontmatter', () => {
    const skill = readFileSync(join(ROOT, 'SKILL.md'), 'utf8')
    const mechanics = readFileSync(join(ROOT, 'SKILL-MECHANICS.md'), 'utf8')
    assert.match(skill, /^---\r?\nname: writing-for-agents\r?\n/)
    assert.match(skill, /`file_write`/)
    assert.match(skill, /skills\/<name>\/SKILL\.md/)
    assert.match(mechanics, /does not hide a skill with `disable-model-invocation`/)
    assert.match(mechanics, /remove its directory and its route/)
    assert.equal(skill.includes('git commit'), false)
  })
})
