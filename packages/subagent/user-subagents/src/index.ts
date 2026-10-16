/**
 * User-authored subagent definition library.
 *
 * The live plugin Config owns the library; the Settings page writes it through
 * the entry's settings namespace. The model-facing delegation tool reads it
 * live and applies a selected definition's persona and tool filter at start.
 *
 * @module @deepseek-ai/dsh-user-subagents
 */

import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User-authored subagent definition library. */
    userSubagents: UserSubagents
  }
}

/** Prompt / definition id: lowercase start, then letters, digits, hyphens, or underscores. */
export const USER_SUBAGENT_ID = /^[a-z][a-z0-9_-]*$/

/** One user-authored subagent definition. */
export interface UserSubagentDefinition {
  /** Stable id the model names in the delegation tool. */
  id: string
  /** Display name on the settings page. */
  name: string
  /** Short description shown to the model when it chooses a definition. */
  description: string
  /**
   * Per-child persona that shadows deployment:persona. An empty string
   * shadows the global persona with an empty section.
   */
  persona: string
  /** Global tool names the child keeps; everything else is removed. */
  allow?: string[]
  /** Global tool names removed from the child. */
  deny?: string[]
}

/** Stored library of reusable child definitions. */
export interface UserSubagentsSettings {
  /** User-authored definitions. */
  definitions: UserSubagentDefinition[]
}

const DEFINITION_SCHEMA: z<UserSubagentDefinition> = z.object({
  id: z.string().required(),
  name: z.string().required(),
  description: z.string().default(''),
  persona: z.string().default(''),
  allow: z.array(z.string()).default(undefined as unknown as string[]),
  deny: z.array(z.string()).default(undefined as unknown as string[]),
})

/** Schema of the user-subagents settings section. */
export const USER_SUBAGENTS_SETTINGS_SCHEMA: z<UserSubagentsSettings> = z.object({
  definitions: z.array(DEFINITION_SCHEMA).default([]),
})

/**
 * Reject duplicate ids, empty names, and unusable identifiers. Called from
 * settings registration so a bad document fails at write rather than silently
 * dropping a definition at start.
 * @param value - schema-valid settings section.
 */
export function validateUserSubagents(value: UserSubagentsSettings): void {
  const seenIds = new Set<string>()
  for (const definition of value.definitions) {
    if (!USER_SUBAGENT_ID.test(definition.id)) {
      throw new Error(`user subagent id "${definition.id}" must match ${String(USER_SUBAGENT_ID)}`)
    }
    if (definition.name.trim().length === 0) {
      throw new Error(`user subagent "${definition.id}" needs a name`)
    }
    if (seenIds.has(definition.id)) {
      throw new Error(`user subagent "${definition.id}" is listed more than once`)
    }
    seenIds.add(definition.id)
    const filters = [...(definition.allow === undefined ? [] : definition.allow), ...(definition.deny === undefined ? [] : definition.deny)]
    for (const name of filters) {
      if (name.length === 0) throw new Error(`user subagent "${definition.id}" has an empty filter name`)
    }
  }
}

/**
 * Look up one definition by id. Missing ids return undefined so a caller
 * can fail at the tool boundary with a model-facing message.
 * @param settings - current library.
 * @param id - definition id the model named.
 * @returns the matching definition, or undefined.
 */
export function findUserSubagent(
  settings: UserSubagentsSettings,
  id: string,
): UserSubagentDefinition | undefined {
  return settings.definitions.find(entry => entry.id === id)
}

/**
 * Build the start-request composition fields from one definition. An omitted
 * allow/deny pair produces no tool filter.
 * @param definition - stored library row.
 * @returns persona plus an optional tool filter.
 */
export function compositionFromUserSubagent(definition: UserSubagentDefinition): {
  persona: string
  toolFilter?: { allow?: string[]; deny?: string[] }
} {
  const allow = definition.allow
  const deny = definition.deny
  const toolFilter = allow === undefined && deny === undefined
    ? undefined
    : {
      ...allow === undefined ? {} : { allow },
      ...deny === undefined ? {} : { deny },
    }
  return {
    persona: definition.persona,
    ...toolFilter === undefined ? {} : { toolFilter },
  }
}

/** Composition config: the live definition library held by the settings document. */
export interface Config {
  /** User-authored definitions. */
  definitions: Volatile<UserSubagentDefinition[]>
}

/**
 * Owns the user subagent-definition library the delegation tool reads.
 */
export class UserSubagents extends Service {
  static Config = z.object({
    definitions: z.array(DEFINITION_SCHEMA).default([]).volatile(),
  })
  static inject = []

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'userSubagents')
  }

  /**
   * Read the current library.
   * @returns a detached snapshot of the resolved settings section.
   */
  current(): UserSubagentsSettings {
    return { definitions: structuredClone(this.config.definitions.get()) as UserSubagentDefinition[] }
  }

  /**
   * Look up one definition by id from the live library.
   * @param id - definition id the model named.
   * @returns the matching definition, or undefined.
   */
  get(id: string): UserSubagentDefinition | undefined {
    return findUserSubagent(this.current(), id)
  }
}

export default UserSubagents
