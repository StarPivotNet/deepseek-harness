/**
 * User-authored system-prompt library and per-model assembly.
 *
 * Settings owns the library, registered-section replacements, and bindings.
 * Assembly reads them live, replaces matching registered section texts, then
 * applies the matching model's selected prompts after cooperative assembly
 * and any complete-section restore, so a model override replaces the prompt
 * the model would otherwise receive.
 *
 * @module @deepseek-ai/dsh-user-system-prompts
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-system-prompt'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User-authored system-prompt library and per-model bindings. */
    userSystemPrompts: UserSystemPrompts
  }
}

/** Settings namespace carrying the user prompt library and model bindings. */
export const USER_SYSTEM_PROMPTS_SETTINGS_NAMESPACE = settingsNamespace('user-system-prompts')

/** One user-authored prompt in the library. */
export interface UserSystemPrompt {
  /** Stable id referenced by model bindings. */
  id: string
  /** Display name on the settings page. */
  name: string
  /** Prompt text contributed to assembly. */
  text: string
}

/** Ordered prompt selection for one provider/model pair. */
export interface UserSystemPromptBinding {
  /** Provider route id. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Library ids in assembly order. */
  promptIds: string[]
  /** Replace the assembled prompt instead of appending. */
  override: boolean
}

/** One user replacement of a registered plugin section. */
export interface UserSystemPromptSectionOverride {
  /** Registered section name (`harness:identity`, `tool:bash`, …). */
  name: string
  /** Replacement text. An empty string hides the section at assembly. */
  text: string
}

/** Stored library, per-model assemblies, and registered-section overrides. */
export interface UserSystemPromptsSettings {
  /** User-authored prompts. */
  prompts: UserSystemPrompt[]
  /** Per-model ordered selections over {@link prompts}. */
  bindings: UserSystemPromptBinding[]
  /** Replacements keyed by registered section name. */
  overrides: UserSystemPromptSectionOverride[]
}

/** Empty composition entry: no user prompts until Settings supplies some. */
export const EMPTY_USER_SYSTEM_PROMPTS: UserSystemPromptsSettings = {
  prompts: [],
  bindings: [],
  overrides: [],
}

/** Prompt id: lowercase start, then letters, digits, hyphens, or underscores. */
const PROMPT_ID = /^[a-z][a-z0-9_-]*$/

const PROMPT_SCHEMA: z<UserSystemPrompt> = z.object({
  id: z.string().required(),
  name: z.string().required(),
  text: z.string().default(''),
})

const BINDING_SCHEMA: z<UserSystemPromptBinding> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  promptIds: z.array(z.string()).default([]),
  override: z.boolean().default(false),
})

const OVERRIDE_SCHEMA: z<UserSystemPromptSectionOverride> = z.object({
  name: z.string().required(),
  text: z.string().default(''),
})

/** Schema of the user-system-prompts settings section. */
export const USER_SYSTEM_PROMPTS_SETTINGS_SCHEMA: z<UserSystemPromptsSettings> = z.object({
  prompts: z.array(PROMPT_SCHEMA).default([]),
  bindings: z.array(BINDING_SCHEMA).default([]),
  overrides: z.array(OVERRIDE_SCHEMA).default([]),
})

/**
 * Reject duplicate ids, duplicate model keys, unknown binding references, and
 * unusable identifiers. Called from settings registration so a bad document
 * fails at write rather than silently dropping a prompt at assembly.
 * @param value - schema-valid settings section.
 */
export function validateUserSystemPrompts(value: UserSystemPromptsSettings): void {
  const seenIds = new Set<string>()
  for (const prompt of value.prompts) {
    if (!PROMPT_ID.test(prompt.id)) {
      throw new Error(`user system prompt id "${prompt.id}" must match ${String(PROMPT_ID)}`)
    }
    if (prompt.name.trim().length === 0) {
      throw new Error(`user system prompt "${prompt.id}" needs a name`)
    }
    if (seenIds.has(prompt.id)) {
      throw new Error(`user system prompt "${prompt.id}" is listed more than once`)
    }
    seenIds.add(prompt.id)
  }
  const seenModels = new Set<string>()
  for (const binding of value.bindings) {
    if (binding.provider.length === 0 || binding.model.length === 0) {
      throw new Error('a model binding needs both provider and model')
    }
    const key = `${binding.provider}\0${binding.model}`
    if (seenModels.has(key)) {
      throw new Error(`model "${binding.provider}/${binding.model}" has more than one binding`)
    }
    seenModels.add(key)
    const seenPromptIds = new Set<string>()
    for (const id of binding.promptIds) {
      if (!seenIds.has(id)) {
        throw new Error(`model "${binding.provider}/${binding.model}" references unknown prompt "${id}"`)
      }
      if (seenPromptIds.has(id)) {
        throw new Error(`model "${binding.provider}/${binding.model}" lists prompt "${id}" more than once`)
      }
      seenPromptIds.add(id)
    }
  }
  const seenOverrideNames = new Set<string>()
  for (const entry of value.overrides) {
    if (entry.name.length === 0) {
      throw new Error('a section override needs a registered section name')
    }
    if (seenOverrideNames.has(entry.name)) {
      throw new Error(`section override "${entry.name}" is listed more than once`)
    }
    seenOverrideNames.add(entry.name)
  }
}

/**
 * Apply one model's selected prompts to an already-restored assembly.
 * Missing ids are a write-time error, so assembly treats the list as exact.
 * @param assembly - post-waterfall, post-complete assembly.
 * @param settings - current library and bindings.
 * @param provider - provider route for this assembly, when known.
 * @param model - model id for this assembly, when known.
 * @returns the assembly with selected prompts appended or substituted.
 */
export function applyUserSystemPrompts(
  assembly: PromptAssembly,
  settings: UserSystemPromptsSettings,
  provider: string | undefined,
  model: string | undefined,
): PromptAssembly {
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) {
    return assembly
  }
  const binding = settings.bindings.find(entry => entry.provider === provider && entry.model === model)
  if (binding === undefined || binding.promptIds.length === 0) return assembly
  const byId = new Map(settings.prompts.map(prompt => [prompt.id, prompt]))
  const sections = binding.promptIds.flatMap((id) => {
    const prompt = byId.get(id)
    return prompt === undefined ? [] : [{ name: `user-system-prompt:${id}`, text: prompt.text }]
  })
  if (sections.length === 0) return assembly
  return {
    ...assembly,
    sections: binding.override ? sections : [...assembly.sections, ...sections],
  }
}

/**
 * Replace registered section texts that have a stored override. Unknown names
 * are ignored so a retired plugin section does not fail assembly.
 * @param assembly - post-waterfall, post-complete assembly.
 * @param settings - current library, bindings, and overrides.
 * @returns the assembly with matching section texts replaced.
 */
export function applyUserSystemPromptOverrides(
  assembly: PromptAssembly,
  settings: UserSystemPromptsSettings,
): PromptAssembly {
  if ((settings.overrides ?? []).length === 0) return assembly
  const byName = new Map((settings.overrides ?? []).map(entry => [entry.name, entry.text]))
  let changed = false
  const sections = assembly.sections.map((section) => {
    const text = byName.get(section.name)
    if (text === undefined) return section
    changed = true
    return { ...section, text }
  })
  return changed ? { ...assembly, sections } : assembly
}

/** Plugin config: the composition entry is always empty; Settings holds the library. */
export interface Config {}

/**
 * Owns the user prompt library, registered-section replacements, and
 * per-model assembly after cooperative prompt assembly.
 */
export class UserSystemPrompts extends Service {
  static Config: z<Config> = z.object({})
  static inject = ['systemPrompt']

  private source: () => UserSystemPromptsSettings

  constructor(ctx: Context, _config: Config) {
    super(ctx, 'userSystemPrompts')
    this.source = () => EMPTY_USER_SYSTEM_PROMPTS
    installSettingsSection(
      ctx,
      USER_SYSTEM_PROMPTS_SETTINGS_NAMESPACE,
      USER_SYSTEM_PROMPTS_SETTINGS_SCHEMA,
      EMPTY_USER_SYSTEM_PROMPTS,
      {
        setSource: (current) => { this.source = current },
        onChange: () => {},
        validate: validateUserSystemPrompts,
      },
    )
    ctx.effect(() => ctx.systemPrompt.afterAssemble((assembly) => {
      const settings = this.source()
      return applyUserSystemPrompts(
        applyUserSystemPromptOverrides(assembly, settings),
        settings,
        assembly.variables.provider,
        assembly.variables.model,
      )
    }), 'userSystemPrompts.afterAssemble()')
  }

  /**
   * Read the current library, bindings, and registered-section replacements.
   * @returns a detached snapshot of the resolved settings section.
   */
  current(): UserSystemPromptsSettings {
    return structuredClone(this.source())
  }
}

export default UserSystemPrompts
