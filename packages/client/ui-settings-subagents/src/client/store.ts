/**
 * Subagent settings page store: the definition library from the
 * `user-subagents` namespace.
 */

import type { ClientRemote, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

type RemoteEnvelope<T> = { ok: boolean; value?: T; error?: { message: string } }

/** Accept either a Typert Remote result or the historical unary `{ rpcId, result }` envelope. */
function unwrapRemote<T>(response: unknown): RemoteEnvelope<T> {
  if (typeof response === 'object' && response !== null && 'result' in response) {
    const nested = (response as { result?: unknown }).result
    if (typeof nested === 'object' && nested !== null && 'ok' in nested) {
      return nested as RemoteEnvelope<T>
    }
  }
  if (typeof response === 'object' && response !== null && 'ok' in response) {
    return response as RemoteEnvelope<T>
  }
  return { ok: false, error: { message: 'malformed remote response' } }
}

/** Settings namespace this page reads and writes. */
export const USER_SUBAGENTS_NS = 'user-subagents'

/** One library entry as the page stores it. */
export interface DefinitionRow {
  id: string
  name: string
  description: string
  persona: string
  allow?: string[]
  deny?: string[]
}

/** Draft for create or edit. */
export interface DefinitionDraft {
  id: string | null
  name: string
  description: string
  persona: string
  allow: string
  deny: string
  error: string | null
  saving: boolean
}

/** Page snapshot. */
export interface SubagentsState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  error: string | null
  writable: boolean
  revision: number
  definitions: readonly DefinitionRow[]
  draft: DefinitionDraft | null
  pendingDelete: string | null
  deleting: boolean
}

/** Human text for a rejected wire call. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Definition id: lowercase start, then letters, digits, hyphens, or underscores. */
const DEFINITION_ID = /^[a-z][a-z0-9_-]*$/

/**
 * Mint a unique library id from a display name.
 * @param name - display name the user typed.
 * @param existing - ids already in the library.
 * @returns a unique slug, falling back to `agent` when the name has no letters.
 */
export function slugFromName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing)
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
  const root = base.length > 0 && DEFINITION_ID.test(base) ? base : 'agent'
  if (!taken.has(root)) return root
  let n = 2
  while (taken.has(`${root}-${String(n)}`)) n += 1
  return `${root}-${String(n)}`
}

/** Split a comma-separated tool list into trimmed non-empty names. */
export function parseToolList(value: string): string[] | undefined {
  const names = value.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0)
  return names.length === 0 ? undefined : names
}

function asDefinitionRows(value: unknown): DefinitionRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const row = entry as {
      id?: unknown
      name?: unknown
      description?: unknown
      persona?: unknown
      allow?: unknown
      deny?: unknown
    }
    if (typeof row.id !== 'string' || typeof row.name !== 'string') return []
    const allow = Array.isArray(row.allow)
      ? row.allow.filter((name): name is string => typeof name === 'string')
      : undefined
    const deny = Array.isArray(row.deny)
      ? row.deny.filter((name): name is string => typeof name === 'string')
      : undefined
    return [{
      id: row.id,
      name: row.name,
      description: typeof row.description === 'string' ? row.description : '',
      persona: typeof row.persona === 'string' ? row.persona : '',
      ...allow === undefined ? {} : { allow },
      ...deny === undefined ? {} : { deny },
    }]
  })
}

/** Controller joining Settings reads and writes. */
export class SubagentsStore {
  /** Page snapshot consumed through a bound selector hook. */
  readonly store: SnapshotStore<SubagentsState> = createSnapshotStore({
    status: 'idle',
    error: null,
    writable: false,
    revision: 0,
    definitions: [],
    draft: null,
    pendingDelete: null,
    deleting: false,
  })

  private generation = 0
  private writeGeneration = 0
  private view: SettingsNamespaceView | undefined

  /** @param api - Settings wire face. */
  constructor(private readonly api: Pick<ClientRemote, 'settings'>) {}

  /**
   * Refresh the namespace. Latest request wins.
   * @returns nothing; {@link store} carries success or failure.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    try {
      const settingsResponse = unwrapRemote<{ writable: boolean; namespaces: SettingsNamespaceView[] }>(
        await this.api.settings.describe(),
      )
      if (generation !== this.generation) return
      if (!settingsResponse.ok) throw new Error(settingsResponse.error?.message ?? 'settings describe failed')
      const view = settingsResponse.value?.namespaces.find(entry => entry.ns === USER_SUBAGENTS_NS)
      if (view === undefined) {
        this.view = undefined
        this.store.update((state) => {
          state.status = 'unavailable'
          state.writable = false
          state.definitions = []
        })
        return
      }
      this.accept(view, Boolean(settingsResponse.value?.writable))
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(error)
    }
  }

  /** Open a create draft. */
  beginCreate(): void {
    this.store.update((state) => {
      state.draft = {
        id: null, name: '', description: '', persona: '', allow: '', deny: '', error: null, saving: false,
      }
    })
  }

  /**
   * Open an edit draft over one library entry.
   * @param id - library id.
   */
  beginEdit(id: string): void {
    const definition = this.store.getSnapshot().definitions.find(entry => entry.id === id)
    if (definition === undefined) return
    this.store.update((state) => {
      state.draft = {
        id,
        name: definition.name,
        description: definition.description,
        persona: definition.persona,
        allow: definition.allow?.join(', ') ?? '',
        deny: definition.deny?.join(', ') ?? '',
        error: null,
        saving: false,
      }
    })
  }

  private patchDraft(mutate: (draft: DefinitionDraft) => void): void {
    this.store.update((state) => {
      if (state.draft === null) return
      mutate(state.draft)
    })
  }

  /** Close the create/edit dialog. */
  cancelDraft(): void {
    this.store.update((state) => {
      state.draft = null
    })
  }

  /** Update the draft name. */
  setDraftName(name: string): void {
    this.patchDraft((draft) => { draft.name = name })
  }

  /** Update the draft description. */
  setDraftDescription(description: string): void {
    this.patchDraft((draft) => { draft.description = description })
  }

  /** Update the draft persona. */
  setDraftPersona(persona: string): void {
    this.patchDraft((draft) => { draft.persona = persona })
  }

  /** Update the draft allow list. */
  setDraftAllow(allow: string): void {
    this.patchDraft((draft) => { draft.allow = allow })
  }

  /** Update the draft deny list. */
  setDraftDeny(deny: string): void {
    this.patchDraft((draft) => { draft.deny = deny })
  }

  /**
   * Persist the open draft.
   * @returns nothing; {@link store} carries success or failure.
   */
  async saveDraft(): Promise<void> {
    const state = this.store.getSnapshot()
    const draft = state.draft
    if (draft === null) return
    if (!state.writable) return
    const name = draft.name.trim()
    const persona = draft.persona.trim()
    if (name.length === 0) {
      this.patchDraft((open) => { open.error = 'nameRequired' })
      return
    }
    if (persona.length === 0) {
      this.patchDraft((open) => { open.error = 'personaRequired' })
      return
    }
    const definitions = [...state.definitions]
    let id = draft.id
    if (id === null) id = slugFromName(name, definitions.map(entry => entry.id))
    const allow = parseToolList(draft.allow)
    const deny = parseToolList(draft.deny)
    const next: DefinitionRow = { id, name, description: draft.description.trim(), persona }
    if (allow !== undefined) next.allow = allow
    if (deny !== undefined) next.deny = deny
    if (draft.id === null) {
      definitions.push(next)
    } else {
      const index = definitions.findIndex(entry => entry.id === draft.id)
      if (index < 0) return
      definitions[index] = next
    }
    this.patchDraft((open) => {
      open.saving = true
      open.error = null
    })
    await this.write({ definitions }, () => {
      this.store.update((current) => { current.draft = null })
    })
  }

  /**
   * Ask for delete confirmation, or dismiss it with null.
   * @param id - library id, or null to dismiss.
   */
  confirmDelete(id: string | null): void {
    this.store.update((state) => {
      state.pendingDelete = id
      state.deleting = false
    })
  }

  /**
   * Delete the definition awaiting confirmation.
   * @returns nothing; {@link store} carries success or failure.
   */
  async remove(): Promise<void> {
    const state = this.store.getSnapshot()
    const id = state.pendingDelete
    if (id === null || !state.writable) return
    this.store.update((current) => { current.deleting = true })
    await this.write({ definitions: state.definitions.filter(entry => entry.id !== id) }, () => {
      this.store.update((current) => {
        current.pendingDelete = null
        current.deleting = false
      })
    })
  }

  /** Stop in-flight responses from publishing after plugin disposal. */
  dispose(): void {
    this.generation += 1
    this.writeGeneration += 1
    this.view = undefined
  }

  private async write(
    section: { definitions: DefinitionRow[] },
    onSuccess?: () => void,
  ): Promise<void> {
    const view = this.view
    if (view === undefined) {
      this.store.update((state) => {
        state.deleting = false
        /* v8 ignore next -- write() only runs from saveDraft/remove, which always leave a draft or pending delete */
        if (state.draft !== null) {
          state.draft.saving = false
          state.draft.error = 'unavailable'
        }
      })
      return
    }
    const generation = ++this.writeGeneration
    try {
      const response = unwrapRemote<SettingsNamespaceView>(
        await this.api.settings.replace(
          USER_SUBAGENTS_NS,
          section as never,
          view.revision,
        ),
      )
      if (generation !== this.writeGeneration) return
      if (!response.ok) throw new Error(response.error?.message ?? 'settings replace failed')
      this.accept(response.value as SettingsNamespaceView, this.store.getSnapshot().writable)
      onSuccess?.()
    } catch (error) {
      /* v8 ignore next -- dispose() already bumped writeGeneration before the rejected replace settles */
      if (generation !== this.writeGeneration) return
      this.store.update((state) => {
        state.error = messageOf(error)
        state.deleting = false
        if (state.draft !== null) {
          state.draft.saving = false
          state.draft.error = messageOf(error)
        }
      })
    }
  }

  private accept(view: SettingsNamespaceView, writable: boolean): void {
    /* v8 ignore next -- Settings always returns an object value for a registered section */
    const value = (view.value ?? {}) as { definitions?: unknown }
    this.view = view
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.writable = writable
      state.revision = view.revision
      state.definitions = asDefinitionRows(value.definitions)
    })
  }

  private fail(error: unknown): void {
    this.store.update((state) => {
      state.status = 'error'
      state.error = messageOf(error)
    })
  }
}

/**
 * Refetch only after the page has opened once.
 * @param controller - page store.
 */
export function refreshIfLoaded(controller: SubagentsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}
