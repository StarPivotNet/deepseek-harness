import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CORDIS = join(PRESET_ROOT, 'agent.cordis.yml')
const VENDOR = join(PRESET_ROOT, 'vendor', 'dsh-tool-calculator')
const PKG = join(VENDOR, 'package.json')
const INDEX = join(VENDOR, 'lib', 'index.js')
const EVALUATE = join(VENDOR, 'lib', 'evaluate.js')
const SKILL_MD = join(PRESET_ROOT, 'skills', 'agi-math', 'SKILL.md')
const METHODS_MD = join(PRESET_ROOT, 'skills', 'agi-math', 'methods.md')

function calculatorBlock(cordis) {
  const match = cordis.match(/- id: tool-calculator\n(?:  .*\n)*/ )
  assert.ok(match, 'agent.cordis.yml must contain id: tool-calculator')
  return match[0]
}

describe('tool-calculator is vendored and mounted on the host tools registry', () => {
  it('mounts with a relative vendor file path and no isolate realm', () => {
    const cordis = readFileSync(CORDIS, 'utf8')
    const block = calculatorBlock(cordis)
    assert.match(block, /name: \.\/vendor\/dsh-tool-calculator\/lib\/index\.js/)
    assert.equal(/name: \.\/vendor\/dsh-tool-calculator\s*$/m.test(block), false)
    assert.equal(block.includes("name: '@deepseek-ai/dsh-tool-calculator'"), false)
    assert.equal(/\bisolate\b/.test(block), false)
  })

  it('ships a module package with index and evaluate and does not import dsh-tools', () => {
    assert.equal(existsSync(PKG), true)
    assert.equal(existsSync(INDEX), true)
    assert.equal(existsSync(EVALUATE), true)
    const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
    assert.equal(pkg.type, 'module')
    assert.equal(pkg.main, 'lib/index.js')
    const index = readFileSync(INDEX, 'utf8')
    assert.equal(index.includes('@deepseek-ai/dsh-tools'), false)
    assert.equal(index.includes('defineTool'), false)
  })

  it('evaluates 15 + 27 * sqrt(9) to 96 and rejects constructor and 1/0', async () => {
    assert.equal(existsSync(EVALUATE), true)
    const mod = await import(pathToFileURL(EVALUATE).href)
    assert.equal(mod.evaluate('15 + 27 * sqrt(9)'), 96)
    assert.throws(() => mod.evaluate('constructor'))
    assert.throws(() => mod.evaluate('1/0'))
  })

  it('strips one wrapping quote pair and rejects assignments', async () => {
    const mod = await import(pathToFileURL(EVALUATE).href)
    assert.equal(mod.evaluate('"15 + 27 * sqrt(9)"'), 96)
    assert.equal(mod.evaluate("'2*3'"), 6)
    assert.throws(() => mod.evaluate('v=1'), /assignment or a loop/)
    assert.throws(() => mod.evaluate('"v=1"'), /assignment or a loop/)
  })

  it('accepts scientific notation literals and rejects incomplete exponents', async () => {
    const mod = await import(pathToFileURL(EVALUATE).href)
    assert.equal(mod.evaluate('1e5'), 100000)
    assert.equal(mod.evaluate('1e-5'), 1e-5)
    assert.equal(mod.evaluate('6.02e23'), 6.02e23)
    assert.equal(mod.evaluate('1E+3'), 1000)
    assert.throws(() => mod.evaluate('1e'))
    assert.throws(() => mod.evaluate('1e+'))
  })

  it('evaluates inverse/hyperbolic helpers, TAU, ln, and degree trig', async () => {
    const mod = await import(pathToFileURL(EVALUATE).href)
    assert.equal(mod.evaluate('sind(90)'), 1)
    assert.equal(mod.evaluate('asind(1)'), 90)
    assert.equal(mod.evaluate('ln(E)'), 1)
    assert.equal(mod.evaluate('TAU / PI'), 2)
    assert.equal(mod.evaluate('cbrt(8)'), 2)
    assert.equal(mod.evaluate('hypot(3, 4)'), 5)
    assert.equal(mod.evaluate('sign(-4)'), -1)
    assert.equal(mod.evaluate('trunc(3.9)'), 3)
    assert.throws(() => mod.evaluate('asin(2)'))
  })
})

describe('agi-math routes finite numeric arithmetic onto calculator', () => {
  it('names calculator for finite numeric arithmetic and forbids mental arithmetic', () => {
    const skill = readFileSync(SKILL_MD, 'utf8')
    const methods = readFileSync(METHODS_MD, 'utf8')
    for (const text of [skill, methods]) {
      assert.match(text, /calculator/)
      assert.match(text, /scientific-notation literals/)
      assert.match(text, /sind|degree/)
      assert.equal(/no scientific notation/.test(text), false)
      assert.equal(/Infinity\/scientific/.test(text), false)
      assert.match(text, /scientific notation/)
      assert.equal(/no scientific notation/.test(text), false)
      assert.match(text, /Lean4/)
      assert.match(text, /SymPy/)
      assert.match(text, /PARI/)
      assert.match(text, /SciPy/)
      assert.match(text, /NumPy/)
      assert.match(text, /JAX/)
      assert.match(text, /SMT \(Satisfiability Modulo Theories\)/)
      assert.match(text, /Z3, an SMT solver/)
      assert.equal(/符号.{0,12}calculator|calculator.{0,24}(symbolic|proof engine|符号引擎|证明引擎)/i.test(text), false)
    }
  })
})
