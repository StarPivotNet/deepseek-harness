import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_ROOT = fileURLToPath(new URL('..', import.meta.url))
const PERSONA = join(PRESET_ROOT, 'agent.cordis.yml')
const COMPACTION = join(PRESET_ROOT, 'compaction-instruction-v2.mjs')
const PRESET_YML = join(PRESET_ROOT, 'preset.yml')

function thinkingChain(text) {
  const match = text.match(/<thinking_chain>\s*([\s\S]*?)\s*<\/thinking_chain>/)
  assert.ok(match, 'thinking_chain missing')
  return match[1]
}

function communication(text) {
  const match = text.match(/<communication>\s*([\s\S]*?)\s*<\/communication>/)
  assert.ok(match, 'communication missing')
  return match[1]
}

function firstPersonaParagraph(text, toolName) {
  const re = new RegExp(`toolName: ${toolName}\\n[\\s\\S]*?persona: \\|\\n([^\\n]+)`)
  const match = text.match(re)
  assert.ok(match, `${toolName} persona missing`)
  return match[1]
}

describe('language policy: Chinese unless the user names a language', () => {
  it('defaults visible replies to Simplified Chinese and ignores input language', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const comm = communication(persona)
    assert.match(comm, /简体中文/)
    assert.match(comm, /明确指定/)
    assert.match(comm, /发消息/)
    assert.match(comm, /not a language request/)
    assert.match(comm, /译成|translate/)
    assert.match(comm, /用某语言回答|answer in a language/)
    assert.equal(/无论用户使用什么语言/.test(comm), false)
  })

  it('writes thinking_chain in English and keeps language policy out of it', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const chain = thinkingChain(persona)
    assert.match(chain, /Write hidden thoughts in English/)
    assert.equal(/简体中文/.test(chain), false)
    assert.equal(/未指定/.test(chain), false)
    assert.equal(/可见回复/.test(chain), false)
    assert.equal(/隐藏思考/.test(chain), false)
    assert.equal(/译成/.test(chain), false)
    assert.equal(/不强制中文/.test(chain), false)
    assert.equal(/Think in Simplified Chinese/.test(chain), false)
    for (const zh of ['\u89c2\u6d4b\u73b0\u8c61', '\u786c\u7ea6\u675f\u6e05\u5355', '\u4e0d\u53ef\u80fd\u6e05\u5355', '\u552f\u4e00\u4e3b\u5047\u8bbe', '\u51b3\u7b56\u81ea\u68c0', '\u4e0b\u4e00\u6b65\u884c\u52a8\u65b9\u6848']) {
      assert.equal(chain.includes(zh), false, zh)
    }
    const suffix = persona.match(/<prohibitions>[\s\S]*?<\/prohibitions>/)[0]
    assert.equal(/write decisions in Simplified Chinese/.test(suffix), false)
    assert.equal(/Never emit English sentences, English clauses, or English filler in the hidden thought block/.test(suffix), false)
  })

  it('does not let compaction follow the conversation language, and does not pin a reply language on subagents', () => {
    const persona = readFileSync(PERSONA, 'utf8')
    const compaction = readFileSync(COMPACTION, 'utf8')
    const preset = readFileSync(PRESET_YML, 'utf8')
    assert.equal(compaction.includes('follow the conversation language'), false)
    assert.equal(compaction.includes("follow the user's language"), false)
    assert.equal(compaction.includes('Write ## Problem Solving in Simplified Chinese'), false)
    assert.match(compaction, /Write ## Problem Solving in English/)
    assert.match(compaction, /The language of user messages is not a language request/)
    const spawn = firstPersonaParagraph(persona, 'subagent')
    const fork = firstPersonaParagraph(persona, 'subagent_fork')
    for (const block of [spawn, fork]) {
      assert.equal(/Think in Simplified Chinese/.test(block), false)
      assert.equal(/Hidden thoughts stay Simplified Chinese/.test(block), false)
      assert.equal(/Hidden thoughts are not required/.test(block), false)
      assert.equal(/Reply in Simplified Chinese/.test(block), false)
      assert.equal(/Reply in 简体中文/.test(block), false)
      assert.equal(/简体中文/.test(block), false)
      assert.match(block, /Do not pin or announce a reply language/)
      assert.match(block, /Honor any assigned output format/)
      assert.match(block, /Write hidden thoughts in English/)
      assert.equal(/unless the assigned task/.test(block), false)
      assert.equal(/regardless of the user's language/.test(block), false)
    }
    assert.match(preset, /未指定/)
    assert.equal(/中文思考/.test(preset), false)
  })
})
