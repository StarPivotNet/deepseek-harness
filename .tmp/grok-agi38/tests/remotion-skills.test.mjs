import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKILLS = join(PRESET_ROOT, 'skills')
const HUB = join(SKILLS, 'remotion-best-practices')
const LIBRARY = join(HUB, 'library')
const SUPERPOWERS = join(SKILLS, 'using-superpowers', 'SKILL.md')
const DESIGN = join(SKILLS, 'design-before-build', 'SKILL.md')
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')

const NESTED = [
  ['remotion-captions', 'Transcribing, displaying and animating captions'],
  ['remotion-create', 'Create a new Remotion video'],
  ['remotion-docs', 'Search Remotion documentation'],
  ['remotion-interactivity', 'Structure Remotion markup for interactivity'],
  ['remotion-maps', 'Remotion Map animation knowledge'],
  ['remotion-markup', 'Content, animation and effects best practices'],
  ['remotion-multimedia', 'Interacting with Mediabunny'],
  ['remotion-render', 'Export a Remotion video'],
  ['remotion-saas', 'Build an app with Remotion'],
  ['remotion-studio', 'Preview a Remotion video'],
  ['remotion-upgrade', 'Upgrade Remotion, and related packages'],
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.md')) out.push(full)
  }
  return out
}

describe('remotion domain files live inside one catalog skill', () => {
  it('keeps only remotion-best-practices as a top-level skill directory', () => {
    const top = readdirSync(SKILLS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('remotion-'))
      .map((entry) => entry.name)
    assert.deepEqual(top, ['remotion-best-practices'])
    const hub = readFileSync(join(HUB, 'SKILL.md'), 'utf8')
    assert.match(hub, /^---\r?\nname: remotion-best-practices\r?\n/)
    assert.match(hub, /description: Router for all Remotion skills/)
    assert.match(hub, /<skill_base>\\library/)
    assert.match(hub, /file_read/)
    assert.match(hub, /not catalog entries/)
    assert.match(hub, /\]\(library\/remotion-create\/SKILL\.md\)/)
    assert.equal(hub.includes('](../remotion-'), false)
  })

  it('stores the other eleven skill files under library', () => {
    for (const [name, description] of NESTED) {
      assert.equal(existsSync(join(SKILLS, name)), false, name)
      const file = join(LIBRARY, name, 'SKILL.md')
      assert.equal(existsSync(file), true, name)
      const text = readFileSync(file, 'utf8')
      assert.match(text, new RegExp('^---\\r?\\nname: ' + name + '\\r?\\n'))
      assert.match(text, new RegExp('description: ' + description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      assert.match(text, /version: 4\.0\.538/)
    }
  })

  it('routes Remotion video work through the hub, then a file read', () => {
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const design = readFileSync(DESIGN, 'utf8')
    const persona = readFileSync(PERSONA, 'utf8')
    assert.match(superpowers, /remotion-best-practices/)
    assert.match(superpowers, /file_read/)
    assert.match(superpowers, /Do not call `skill` for a nested `remotion-\*` name/)
    assert.equal(persona.includes('remotion-best-practices'), false)
    assert.match(design, /load `remotion-best-practices` first/)
    assert.match(design, /file_read/)
    assert.match(design, /Do not call `skill` for a nested `remotion-\*` name/)
  })

  it('keeps relative links resolvable after the move', () => {
    const create = readFileSync(join(LIBRARY, 'remotion-create', 'SKILL.md'), 'utf8')
    assert.match(create, /\]\(\.\.\/remotion-markup\/SKILL\.md\)/)
    assert.match(create, /\]\(\.\.\/\.\.\/SKILL\.md\)/)
    const markup = readFileSync(join(LIBRARY, 'remotion-markup', 'SKILL.md'), 'utf8')
    assert.match(markup, /\]\(\.\.\/remotion-maps\/SKILL\.md\)/)
    assert.match(markup, /\]\(\.\.\/remotion-captions\/SKILL\.md\)/)
    const metadata = readFileSync(join(LIBRARY, 'remotion-markup', 'calculate-metadata.md'), 'utf8')
    assert.match(metadata, /\]\(\.\.\/remotion-multimedia\/get-video-duration\.md\)/)
    const missing = []
    for (const file of walk(HUB)) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const raw = match[1].split('#')[0]
        if (!raw || raw.startsWith('http:') || raw.startsWith('https:') || raw.startsWith('mailto:')) continue
        const target = normalize(join(dirname(file), decodeURIComponent(raw)))
        if (!existsSync(target)) missing.push(`${file} -> ${raw}`)
      }
    }
    assert.deepEqual(missing, [])
  })
})
