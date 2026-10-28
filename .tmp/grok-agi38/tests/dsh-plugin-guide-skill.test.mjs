import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKILL_DIR = join(PRESET_ROOT, 'skills', 'dsh-plugin-guide')
const SKILL_MD = join(SKILL_DIR, 'SKILL.md')
const REFERENCES = join(SKILL_DIR, 'references')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')

const REFERENCE_FILES = [
  'host-plugin.md',
  'tool-plugin.md',
  'llm-adapter.md',
  'client-plugin.md',
  'bundle-and-profile.md',
  'config.md',
  'checklist.md',
]

const FORBIDDEN_LAYOUT = [
  ['official-docs'],
  ['templates'],
  ['downloads'],
  ['dist'],
  ['bin'],
  ['guide'],
  ['scripts'],
  ['install-skill.ps1'],
  ['sync-official-docs.ps1'],
  ['verify-kit.ps1'],
]

function walkMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walkMarkdown(full, out)
      continue
    }
    if (name.endsWith('.md')) out.push(full)
  }
  return out
}

function skillCorpus() {
  return walkMarkdown(SKILL_DIR).map((file) => ({
    rel: relative(SKILL_DIR, file).replaceAll('\\', '/'),
    text: readFileSync(file, 'utf8'),
  }))
}

describe('dsh-plugin-guide skill is the published-plugin knowledge base', () => {
  it('has SKILL.md named dsh-plugin-guide', () => {
    assert.equal(existsSync(SKILL_MD), true)
    const text = readFileSync(SKILL_MD, 'utf8')
    assert.match(text, /^---\r?\nname: dsh-plugin-guide\r?\n/)
  })

  it('ships SKILL.md plus seven form references and no old kit layout', () => {
    assert.equal(existsSync(SKILL_MD), true, SKILL_MD)
    for (const name of REFERENCE_FILES) {
      const target = join(REFERENCES, name)
      assert.equal(existsSync(target), true, target)
    }
    const listed = existsSync(REFERENCES)
      ? readdirSync(REFERENCES).filter((name) => name.endsWith('.md')).sort()
      : []
    assert.deepEqual(listed, [...REFERENCE_FILES].sort())
    for (const parts of FORBIDDEN_LAYOUT) {
      const target = join(SKILL_DIR, ...parts)
      assert.equal(existsSync(target), false, target)
    }
  })

  it('keeps official plugin-contract red lines in the skill body', () => {
    const text = readFileSync(SKILL_MD, 'utf8')
    assert.doesNotMatch(text, /[\u4e00-\u9fff]/)
    assert.match(text, /Registration is an effect|register is an effect/)
    assert.match(text, /defineTool/)
    assert.match(text, /Schemastery/)
    assert.match(text, /waterfall/)
    assert.match(text, /bundle/)
    assert.match(text, /skills\/dsh-plugin-guide/)
    assert.doesNotMatch(text, /本 preset 副本不附带该 CLI/)
    assert.match(text, /Published plugins are installed manually by the user/)
    assert.match(text, /do not run `dsh plugin add` on the user's behalf/)
    assert.equal(text.includes('dsh-plugin-guide-main'), false)
    for (const name of REFERENCE_FILES) {
      assert.match(text, new RegExp(`references/${name.replace('.', '\\.')}`))
    }
  })

  it('classifies plugins by host, tool, llm, client, bundle, and config forms', () => {
    const text = readFileSync(SKILL_MD, 'utf8')
    for (const token of ['host', 'tool', 'llm', 'client', 'bundle', 'config']) {
      assert.match(text, new RegExp(token, 'i'), token)
    }
    const corpus = skillCorpus().map((file) => file.text).join('\n')
    assert.match(corpus, /export const name/)
    assert.match(corpus, /export const inject/)
    assert.match(corpus, /Schema\.object|z\.object/)
    assert.match(corpus, /apply\(ctx/)
    assert.match(corpus, /dsh\.client/)
    assert.match(corpus, /platform:\s*['"]web['"]|platform.*=.*web/)
    assert.match(corpus, /\.\/client/)
    assert.match(corpus, /immediately/)
    assert.match(corpus, /registerAdapter/)
    assert.match(corpus, /LlmAdapter/)
    assert.match(corpus, /cordis\.patch\.yml/)
  })

  it('keeps isolate on published-service/preset-internal rows and does not treat Zen stubs as defineTool', () => {
    const files = skillCorpus()
    const corpus = files.map((file) => file.text).join('\n')
    assert.doesNotMatch(corpus, /[\u4e00-\u9fff]/)
    assert.equal(files.some((file) => file.text.includes('dsh-plugin-guide-main')), false)
    assert.doesNotMatch(corpus, /本 preset 副本不附带该 CLI/)
    assert.match(corpus, /installed manually by the user/)
    assert.match(corpus, /do not run `dsh plugin add` on the user's behalf/)
    assert.match(corpus, /isolate/)
    assert.match(corpus, /preset/)
    assert.match(corpus, /published service/)
    assert.doesNotMatch(corpus, /isolate is the default patch for published host plugins/)
    assert.doesNotMatch(corpus, /默认 isolate/)
    assert.match(corpus, /OFFICIAL_ZEN_TOOLS|Zen stub|Zen fingerprint/)
    assert.match(corpus, /not defineTool|is not defineTool|do not treat.*stub.*as defineTool/)
    assert.doesNotMatch(corpus, /dsh-client-runtime/)
    assert.doesNotMatch(corpus, /ctx\.get\(['"]httpServer['"]\)/)
    assert.doesNotMatch(corpus, /httpServer 仅回退/)
    assert.doesNotMatch(corpus, /httpServer fallback only/)
  })

  it('routes published DSH plugin work to dsh-plugin-guide', () => {
    const text = readFileSync(SUPERPOWERS, 'utf8')
    assert.match(text, /\| Published DSH plugin[\s\S]*\| `dsh-plugin-guide` \|/)
  })

  it('persona loads using-superpowers first and does not repeat the plugin route', () => {
    const text = readFileSync(PERSONA, 'utf8')
    assert.match(text, /Load `using-superpowers` first/)
    assert.equal(text.includes('Load `dsh-plugin-guide`'), false)
    const skillBody = readFileSync(SKILL_MD, 'utf8')
    assert.doesNotMatch(skillBody, /本 preset 副本不附带该 CLI/)
    assert.match(skillBody, /Published plugins are installed manually by the user/)
    assert.match(skillBody, /do not run `dsh plugin add` on the user's behalf/)
    assert.match(skillBody, /skills\/dsh-plugin-guide/)
  })
})
