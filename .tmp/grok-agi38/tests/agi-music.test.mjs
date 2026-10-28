import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const MUSIC = join(PRESET_ROOT, 'skills', 'agi-music', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const FRONTEND = join(PRESET_ROOT, 'skills', 'frontend-design', 'SKILL.md')
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')

describe('agi-music writes music as audio code', () => {
  it('ships the music skill as scribbletune plus spessasynth_core', () => {
    const music = readFileSync(MUSIC, 'utf8')
    assert.equal(existsSync(join(PRESET_ROOT, 'skills', 'webaudio-music')), false)
    assert.match(music, /^---\r?\nname: agi-music\r?\n/)
    assert.equal(music.includes('webaudio-music'), false)
    assert.match(music, /scribbletune/)
    assert.match(music, /spessasynth_core/)
    assert.match(music, /SoundBankLoader\.fromArrayBuffer/)
    assert.match(music, /midi\(notes, null, bpm\)/)
    assert.match(music, /Channel 9/)
    assert.match(music, /Do not play the score through Tone\.js/)
    assert.match(music, /Do not import `spessasynth_lib`/)
    assert.equal(music.includes('webaudio-voice'), false)
    assert.equal(music.includes('canvas-show'), false)
  })

  it('is routed from using-superpowers, not repeated in the persona', () => {
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const frontend = readFileSync(FRONTEND, 'utf8')
    const persona = readFileSync(PERSONA, 'utf8')
    assert.match(superpowers, /`agi-music`/)
    assert.equal(superpowers.includes('webaudio-music'), false)
    assert.match(frontend, /`agi-music`/)
    assert.equal(frontend.includes('webaudio-music'), false)
    assert.equal(superpowers.includes('webaudio-voice'), false)
    assert.equal(superpowers.includes('canvas-show'), false)
    assert.match(persona, /^\s+If a session-catalog skill matches/m)
    assert.match(persona, /Load `using-superpowers` first/)
    assert.equal(persona.includes('agi-music'), false)
    assert.equal(persona.includes('webaudio-music'), false)
    assert.equal(persona.includes('webaudio-voice'), false)
    assert.equal(persona.includes('canvas-show'), false)
  })
})
