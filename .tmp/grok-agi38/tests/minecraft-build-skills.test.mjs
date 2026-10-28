import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const PRESET_ROOT = join(import.meta.dirname, '..')
const SKILL = join(PRESET_ROOT, 'skills', 'minecraft-build', 'SKILL.md')
const SDK = join(PRESET_ROOT, 'skills', 'minecraft-build', 'minecraft')
const FRONTEND = join(PRESET_ROOT, 'skills', 'minecraft-build', 'frontend')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')

test('minecraft-build skill points at the copied GPLv3 SDK and frontend', () => {
  const text = readFileSync(SKILL, 'utf8')
  assert.match(text, /^name: minecraft-build$/m)
  assert.match(text, /structure dictionary/)
  assert.match(text, /PYTHONPATH/)
  assert.match(text, /app\.services\.code_runner/)
  assert.match(text, /GPLv3/)
  assert.match(text, /frontend\//)
  assert.match(text, /npm run dev/)
  assert.match(text, /blockbench/)
  assert.doesNotMatch(text, /webaudio-voice|canvas-show|code-review/)
  assert.equal(existsSync(join(SDK, 'LICENSE')), true)
  assert.equal(existsSync(join(SDK, 'app', 'agent', 'minecraft', 'sdk.py')), true)
  assert.equal(existsSync(join(SDK, 'app', 'services', 'code_runner.py')), true)
  assert.equal(statSync(join(SDK, 'app', 'agent', 'minecraft', 'static', 'assets.json')).size > 1_000_000, true)
  assert.equal(existsSync(join(FRONTEND, 'package.json')), true)
  assert.equal(existsSync(join(FRONTEND, 'src', 'components', 'MinecraftViewer.jsx')), true)
  assert.equal(statSync(join(FRONTEND, 'public', 'assets', 'atlas.png')).size > 1_000_000, true)
  assert.equal(statSync(join(FRONTEND, 'public', 'assets', 'assets.js')).size > 1_000_000, true)
  assert.equal(existsSync(join(FRONTEND, 'node_modules')), false)
})

test('using-superpowers routes Minecraft structure builds to minecraft-build', () => {
  const text = readFileSync(SUPERPOWERS, 'utf8')
  assert.match(text, /\| A Minecraft structure, terrain, or scene exported as a structure dictionary \| `minecraft-build` \|/)
  assert.match(text, /\| A Blockbench `\.bbmodel`, Minecraft cube model, voxel rig, or GeckoLib export \| `blockbench` \|/)
})
