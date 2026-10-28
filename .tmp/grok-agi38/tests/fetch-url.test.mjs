import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const HUB = join(PRESET_ROOT, 'skills', 'fetch-url', 'SKILL.md')
const SUPERPOWERS = join(PRESET_ROOT, 'skills', 'using-superpowers', 'SKILL.md')
const LOOP = join(PRESET_ROOT, 'skills', 'agi-loop', 'SKILL.md')
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')

function section(text, name) {
  const match = text.match(new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`))
  assert.ok(match, `${name} missing or unclosed`)
  return match[1]
}

describe('named URL fetch is in the persona, not a skill', () => {
  it('ships read_page in <fetch_url> and does not name web_fetch', () => {
    assert.equal(existsSync(HUB), false)
    const persona = readFileSync(PERSONA, 'utf8')
    const hub = section(persona, 'fetch_url')
    assert.match(hub, /A named http\(s\) page uses `read_page`/)
    assert.match(hub, /Pass `url`/)
    assert.match(hub, /Pass `query`/)
    assert.match(hub, /Do not call `skill` for it/)
    assert.equal(hub.includes('web_fetch'), false)
    assert.equal(hub.includes('curl.exe'), false)
    assert.equal(hub.includes('Invoke-WebRequest'), false)
    assert.equal(hub.includes('web_search` first'), false)
    assert.equal(persona.includes('load skill `fetch-url`'), false)
  })

  it('routes search and pages to modsearch and APIs to curl', () => {
    const superpowers = readFileSync(SUPERPOWERS, 'utf8')
    const loop = readFileSync(LOOP, 'utf8')
    const persona = readFileSync(PERSONA, 'utf8')
    const hub = section(persona, 'fetch_url')
    assert.match(hub, /uses `web_search`, then `read_page`/)
    assert.equal(hub.includes('platform_search'), false)
    assert.equal(hub.includes('advanced_search'), false)
    assert.equal(hub.includes('curl'), false)
    assert.match(persona, /One http\(s\) page uses `<fetch_url>` below \(`read_page`\)/)
    assert.match(persona, /host's installed `@liustack\/modsearch`/)
    assert.equal(persona.split('do not shell out to `npx` or the `modsearch` CLI').length - 1, 4)
    assert.match(persona, /uses `<fetch_url>` below \(`read_page`\)\. Posts on X use `x_search`/)
    assert.equal(persona.includes('web_fetch'), false)
    assert.match(persona, /- id: tool-web\n  name: '@deepseek-ai\/dsh-tool-web'\n  config:\n    fetch: false\n    searchTimeoutMs: 60000/)
    assert.equal(persona.includes('platform_search'), false)
    assert.equal(persona.includes('curl.exe'), false)
    assert.equal(persona.includes('+ `web_fetch` +'), false)
    assert.match(superpowers, /persona `<fetch_url>` \(`read_page` on the host `@liustack\/modsearch`/)
    assert.equal(superpowers.includes('`fetch-url`'), false)
    assert.match(superpowers, /do not call `skill` or the `modsearch` CLI/)
    assert.equal(superpowers.includes('web_fetch'), false)
    assert.equal(loop.includes('web_fetch'), false)
    assert.equal(loop.includes('fetch-url'), false)
    assert.equal(loop.includes('platform_search'), false)
    assert.match(loop, /web_search\/read_page\/x_search/)
  })
})
