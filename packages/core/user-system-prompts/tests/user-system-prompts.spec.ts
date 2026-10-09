/** User system-prompt library layered over a real settings provider. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import UserSystemPrompts, {
  applyUserSystemPromptOverrides,
  applyUserSystemPrompts,
  USER_SYSTEM_PROMPTS_SETTINGS_NAMESPACE,
  validateUserSystemPrompts,
} from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

const STYLE = { id: 'style', name: 'Style', text: 'Be concise.' }
const RULES = { id: 'rules', name: 'Rules', text: 'Never guess.' }

async function boot(): Promise<{ ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(MemorySettings).await()
  await ctx.plugin(SystemPrompt, { personaPrefix: 'You are the deployment persona.' })
  await ctx.plugin(UserSystemPrompts)
  ctx.systemPrompt.variable('provider', () => 'deepseek-official')
  ctx.systemPrompt.variable('model', () => 'deepseek-v4-flash')
  return { ctx }
}

describe('validateUserSystemPrompts', () => {
  it('accepts a unique library and one binding per model', () => {
    expect(() => validateUserSystemPrompts({
      prompts: [STYLE, RULES],
      bindings: [{
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        promptIds: ['style', 'rules'],
        override: false,
      }],
      overrides: [{ name: 'harness:identity', text: 'Custom opener.' }],
    })).not.toThrow()
  })

  it('rejects a duplicate section override', () => {
    expect(() => validateUserSystemPrompts({
      prompts: [],
      bindings: [],
      overrides: [
        { name: 'harness:identity', text: 'a' },
        { name: 'harness:identity', text: 'b' },
      ],
    })).toThrow('listed more than once')
  })

  it('rejects an empty override name', () => {
    expect(() => validateUserSystemPrompts({
      prompts: [],
      bindings: [],
      overrides: [{ name: '', text: 'x' }],
    })).toThrow('needs a registered section name')
  })

  it('rejects a duplicate prompt id', () => {
    expect(() => validateUserSystemPrompts({
      prompts: [STYLE, { ...RULES, id: 'style' }],
      bindings: [],
      overrides: [],
    })).toThrow('listed more than once')
  })

  it('rejects an invalid prompt id', () => {
    expect(() => validateUserSystemPrompts({
      prompts: [{ id: '1bad', name: 'Bad', text: 'x' }],
      bindings: [],
      overrides: [],
    })).toThrow('must match')
  })

  it('rejects an empty prompt name', () => {
    expect(() => validateUserSystemPrompts({
      prompts: [{ id: 'style', name: '  ', text: 'x' }],
      bindings: [],
      overrides: [],
    })).toThrow('needs a name')
  })

  it('rejects a binding without provider or model', () => {
    expect(() => validateUserSystemPrompts({
      prompts: [STYLE],
      bindings: [{ provider: '', model: 'm', promptIds: [], override: false }],
      overrides: [],
    })).toThrow('needs both provider and model')
  })

  it('rejects two bindings for the same model', () => {
    expect(() => validateUserSystemPrompts({
      prompts: [STYLE],
      bindings: [
        { provider: 'p', model: 'm', promptIds: ['style'], override: false },
        { provider: 'p', model: 'm', promptIds: [], override: true },
      ],
      overrides: [],
    })).toThrow('more than one binding')
  })

  it('rejects a binding that lists one prompt twice', () => {
    expect(() => validateUserSystemPrompts({
      prompts: [STYLE],
      bindings: [{
        provider: 'p',
        model: 'm',
        promptIds: ['style', 'style'],
        override: false,
      }],
      overrides: [],
    })).toThrow('more than once')
  })

  it('rejects an unknown binding reference', () => {
    expect(() => validateUserSystemPrompts({
      prompts: [STYLE],
      bindings: [{
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        promptIds: ['missing'],
        override: false,
      }],
      overrides: [],
    })).toThrow('unknown prompt "missing"')
  })
})

describe('applyUserSystemPrompts', () => {
  const settings = {
    prompts: [STYLE, RULES],
    bindings: [{
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      promptIds: ['rules', 'style'],
      override: false,
    }],
    overrides: [],
  }

  it('appends selected prompts in listed order', () => {
    const result = applyUserSystemPrompts(
      { sections: [{ name: 'base', text: 'base' }], contexts: [], tools: [], variables: {} },
      settings,
      'deepseek-official',
      'deepseek-v4-flash',
    )
    expect(result.sections).toEqual([
      { name: 'base', text: 'base' },
      { name: 'user-system-prompt:rules', text: 'Never guess.' },
      { name: 'user-system-prompt:style', text: 'Be concise.' },
    ])
  })

  it('replaces the assembled prompt when override is set', () => {
    const result = applyUserSystemPrompts(
      { sections: [{ name: 'base', text: 'base' }], contexts: [], tools: [], variables: {} },
      { ...settings, bindings: [{ ...settings.bindings[0]!, override: true }] },
      'deepseek-official',
      'deepseek-v4-flash',
    )
    expect(result.sections).toEqual([
      { name: 'user-system-prompt:rules', text: 'Never guess.' },
      { name: 'user-system-prompt:style', text: 'Be concise.' },
    ])
  })

  it('leaves an assembly without provider or model unchanged', () => {
    const assembly = { sections: [{ name: 'base', text: 'base' }], contexts: [], tools: [], variables: {} }
    expect(applyUserSystemPrompts(assembly, settings, undefined, 'm')).toBe(assembly)
    expect(applyUserSystemPrompts(assembly, settings, '', 'm')).toBe(assembly)
  })

  it('leaves an unmatched model unchanged', () => {
    const assembly = { sections: [{ name: 'base', text: 'base' }], contexts: [], tools: [], variables: {} }
    expect(applyUserSystemPrompts(assembly, settings, 'other', 'model')).toBe(assembly)
  })

  it('drops a selected id that is no longer in the library', () => {
    const result = applyUserSystemPrompts(
      { sections: [{ name: 'base', text: 'base' }], contexts: [], tools: [], variables: {} },
      {
        prompts: [STYLE],
        bindings: [{
          provider: 'deepseek-official',
          model: 'deepseek-v4-flash',
          promptIds: ['missing'],
          override: false,
        }],
        overrides: [],
      },
      'deepseek-official',
      'deepseek-v4-flash',
    )
    expect(result.sections).toEqual([{ name: 'base', text: 'base' }])
  })
})

describe('applyUserSystemPromptOverrides', () => {
  it('replaces matching registered section texts', () => {
    const result = applyUserSystemPromptOverrides(
      {
        sections: [
          { name: 'harness:identity', text: 'You are an AI agent powered by DeepSeek Harness.' },
          { name: 'deployment:persona', text: 'You are the deployment persona.' },
        ],
        contexts: [],
        tools: [],
        variables: {},
      },
      {
        prompts: [],
        bindings: [],
        overrides: [{ name: 'harness:identity', text: 'Custom opener.' }],
      },
    )
    expect(result.sections).toEqual([
      { name: 'harness:identity', text: 'Custom opener.' },
      { name: 'deployment:persona', text: 'You are the deployment persona.' },
    ])
  })

  it('ignores an override whose section is not assembled', () => {
    const assembly = { sections: [{ name: 'base', text: 'base' }], contexts: [], tools: [], variables: {} }
    expect(applyUserSystemPromptOverrides(assembly, {
      prompts: [],
      bindings: [],
      overrides: [{ name: 'missing', text: 'x' }],
    })).toBe(assembly)
  })
})

describe('UserSystemPrompts', () => {
  it('appends the bound prompts for the assembled model', async () => {
    const { ctx } = await boot()
    await ctx.settings.replace(USER_SYSTEM_PROMPTS_SETTINGS_NAMESPACE, {
      prompts: [STYLE, RULES],
      bindings: [{
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        promptIds: ['style', 'rules'],
        override: false,
      }],
    })

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.map(section => section.name)).toEqual([
      'harness:identity',
      'deployment:persona-prefix',
      'deployment:persona-suffix',
      'user-system-prompt:style',
      'user-system-prompt:rules',
    ])
    expect(renderPrompt(assembly)).toContain('Be concise.')
    await ctx.fiber.dispose()
  })

  it('overrides a complete preset persona when the binding says so', async () => {
    const { ctx } = await boot()
    ctx.systemPrompt.section({
      name: 'preset:persona',
      order: 1,
      text: 'Exact preset prompt.',
      complete: true,
    })
    await ctx.settings.replace(USER_SYSTEM_PROMPTS_SETTINGS_NAMESPACE, {
      prompts: [STYLE],
      bindings: [{
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        promptIds: ['style'],
        override: true,
      }],
    })

    expect((await ctx.systemPrompt.assemble()).sections).toEqual([
      { name: 'user-system-prompt:style', text: 'Be concise.' },
    ])
    await ctx.fiber.dispose()
  })

  it('leaves assembly alone when the library is empty', async () => {
    const { ctx } = await boot()
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .toEqual(['harness:identity', 'deployment:persona-prefix', 'deployment:persona-suffix'])
    expect(ctx.userSystemPrompts.current()).toEqual({ prompts: [], bindings: [], overrides: [] })
    await ctx.fiber.dispose()
  })

  it('replaces a registered section from a stored override', async () => {
    const { ctx } = await boot()
    await ctx.settings.replace(USER_SYSTEM_PROMPTS_SETTINGS_NAMESPACE, {
      prompts: [],
      bindings: [],
      overrides: [{ name: 'harness:identity', text: 'Custom opener.' }],
    })
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'harness:identity'))
      .toEqual({ name: 'harness:identity', text: 'Custom opener.' })
    await ctx.fiber.dispose()
  })
})
