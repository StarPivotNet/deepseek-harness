import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const HUB = join(PRESET_ROOT, 'skills', 'pixel-art', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')

describe('pixel-art paints at any size', () => {
  it('ships the painter and does not borrow the blockbench library', () => {
    const hub = readFileSync(HUB, 'utf8')
    assert.match(hub, /^---\r?\nname: pixel-art\r?\n/)
    assert.match(hub, /pixel_paint/)
    assert.match(hub, /any width and height/)
    assert.match(hub, /paint_face/)
    assert.match(hub, /paint_sheet/)
    assert.match(hub, /glow/)
    assert.match(hub, /do not import `bbmodel_maker`/)
    assert.equal(/format_version|box_uv/.test(hub), false)
    assert.equal(
      existsSync(join(PRESET_ROOT, 'skills', 'pixel-art', 'pixel_paint', 'paint.py')),
      true,
    )
  })

  it('is routed from using-superpowers, not repeated in the persona', () => {
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const persona = readFileSync(PERSONA, 'utf8')
    assert.match(superpowers, /pixel texture or sprite \| `pixel-art`/)
    assert.match(persona, /Load `using-superpowers` first/)
    assert.equal(persona.includes('pixel-art'), false)
  })
})
