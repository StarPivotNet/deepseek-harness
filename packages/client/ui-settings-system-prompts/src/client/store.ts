/**
 * System-prompt settings page store: the library, registered-section
 * overrides, and bindings from the `user-system-prompts` namespace, plus
 * the host model catalog used to pick which models can be assembled.
 */

import type {
  SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SystemPromptSectionView } from '@deepseek-ai/dsh-api-settings-controller/types'

type RegisteredPromptSectionView = SystemPromptSectionView
type SettingsWire = {
  describe: () => Promise<{ ok: boolean; value?: { namespaces: SettingsNamespaceView[] }; error?: { message: string } }>
  replace: (...args: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>
}
type LlmWire = { listProviders: () => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }> }
type SystemPromptWire = { list: () => Promise<{ ok: boolean; value?: { sections?: unknown } }> }
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Settings namespace this page reads and writes. */
export const USER_SYSTEM_PROMPTS_NS = 'user-system-prompts'

/** One library entry as the page stores it. */
export interface PromptRow {
  id: string
  name: string
  text: string
}

/** One registered plugin section with any stored user replacement applied. */
export interface BuiltInRow {
  name: string
  order: number
  text: string
  complete: boolean
  overridden: boolean
}

/** One stored replacement of a registered section. */
export interface OverrideRow {
  name: string
  text: string
}

/** One model's selected prompts and override policy. */
export interface BindingRow {
  provider: string
  model: string
  promptIds: string[]
  override: boolean
}

/** One catalog model the page can assemble. */
export interface CatalogModel {
  provider: string
  providerName: string
  model: string
  modelName: string
}

/** Draft for create, library edit, or built-in edit. */
export interface PromptDraft {
  id: string | null
  kind: 'library' | 'builtin'
  name: string
  text: string
  error: string | null
  saving: boolean
}

/** Page snapshot. */
export interface SystemPromptsState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  error: string | null
  catalogError: string | null
  writable: boolean
  revision: number
  prompts: readonly PromptRow[]
  overrides: readonly OverrideRow[]
  builtIns: readonly BuiltInRow[]
  builtInError: string | null
  bindings: readonly BindingRow[]
  catalog: readonly CatalogModel[]
  draft: PromptDraft | null
  pendingDelete: string | null
  deleting: boolean
}

/** Human text for a rejected wire call. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Prompt id: lowercase start, then letters, digits, hyphens, or underscores. */
const PROMPT_ID = /^[a-z][a-z0-9_-]*$/

/**
 * Mint a unique library id from a display name.
 * @param name - display name the user typed.
 * @param existing - ids already in the library.
 * @returns a unique slug, falling back to `prompt` when the name has no letters.
 */
export function slugFromName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing)
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '')
  const root = base.length > 0 && PROMPT_ID.test(base) ? base : 'prompt'
  if (!taken.has(root)) return root
  let n = 2
  while (taken.has(`${root}-${String(n)}`)) n += 1
  return `${root}-${String(n)}`
}

/**
 * Binding for one catalog model, or an empty selection when none is stored.
 * @param bindings - stored bindings.
 * @param provider - provider route.
 * @param model - model id.
 * @returns the stored or empty binding.
 */
export function bindingFor(
  bindings: readonly BindingRow[],
  provider: string,
  model: string,
): BindingRow {
  return bindings.find(entry => entry.provider === provider && entry.model === model)
    ?? { provider, model, promptIds: [], override: false }
}

function asPromptRows(value: unknown): PromptRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const row = entry as { id?: unknown; name?: unknown; text?: unknown }
    if (typeof row.id !== 'string' || typeof row.name !== 'string') return []
    return [{ id: row.id, name: row.name, text: typeof row.text === 'string' ? row.text : '' }]
  })
}

function asOverrideRows(value: unknown): OverrideRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const row = entry as { name?: unknown; text?: unknown }
    if (typeof row.name !== 'string' || row.name.length === 0) return []
    return [{ name: row.name, text: typeof row.text === 'string' ? row.text : '' }]
  })
}

function asRegisteredSections(value: unknown): RegisteredPromptSectionView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const row = entry as { name?: unknown; order?: unknown; text?: unknown; complete?: unknown }
    if (typeof row.name !== 'string' || row.name.length === 0 || typeof row.order !== 'number') return []
    return [{
      name: row.name,
      order: row.order,
      text: typeof row.text === 'string' ? row.text : '',
      complete: row.complete === true,
    }]
  })
}

function mergeBuiltIns(
  sections: readonly RegisteredPromptSectionView[],
  overrides: readonly OverrideRow[],
): BuiltInRow[] {
  const byName = new Map(overrides.map(entry => [entry.name, entry.text]))
  return sections.map(section => ({
    name: section.name,
    order: section.order,
    text: byName.get(section.name) ?? section.text,
    complete: section.complete,
    overridden: byName.has(section.name),
  }))
}

function asBindingRows(value: unknown): BindingRow[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const row = entry as { provider?: unknown; model?: unknown; promptIds?: unknown; override?: unknown }
    if (typeof row.provider !== 'string' || typeof row.model !== 'string') return []
    const promptIds = Array.isArray(row.promptIds)
      ? row.promptIds.filter((id): id is string => typeof id === 'string')
      : []
    return [{
      provider: row.provider,
      model: row.model,
      promptIds,
      override: row.override === true,
    }]
  })
}

/** Controller joining Settings reads, writes, and the model catalog. */
export class SystemPromptsStore {
  /** Page snapshot consumed through a bound selector hook. */
  readonly store: SnapshotStore<SystemPromptsState> = createSnapshotStore({
    status: 'idle',
    error: null,
    catalogError: null,
    writable: false,
    revision: 0,
    prompts: [],
    overrides: [],
    builtIns: [],
    builtInError: null,
    bindings: [],
    catalog: [],
    draft: null,
    pendingDelete: null,
    deleting: false,
  })

  private generation = 0
  private writeGeneration = 0
  private view: SettingsNamespaceView | undefined
  private registered: readonly RegisteredPromptSectionView[] = []

  /** @param api - Settings, registered-section, and model-catalog wire faces. */
  constructor(private readonly api: { settings: SettingsWire; llm: LlmWire; systemPrompt?: SystemPromptWire }) {}

  /**
   * Refresh the namespace and catalog. Latest request wins.
   * @returns nothing; {@link store} carries success or failure.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
      state.catalogError = null
      state.builtInError = null
    })
    try {
      const [settingsResponse, modelsResponse, sectionsResponse] = await Promise.all([
        this.api.settings.describe(),
        this.api.llm.listProviders(),
        this.api.systemPrompt?.list?.() ?? Promise.resolve({ ok: true, value: { sections: [] } }),
      ])
      if (generation !== this.generation) return
      if (!settingsResponse.ok) throw new Error(settingsResponse.error.message)
      const view = settingsResponse.value.namespaces.find((entry: SettingsNamespaceView) => entry.ns === USER_SYSTEM_PROMPTS_NS)
      if (view === undefined) {
        this.view = undefined
        this.store.update((state) => {
          state.status = 'unavailable'
          state.writable = false
          state.prompts = []
          state.overrides = []
          state.builtIns = []
          state.bindings = []
          state.catalog = []
        })
        return
      }
      let catalog: CatalogModel[] = []
      let catalogError: string | null = null
      if (!modelsResponse.ok) {
        catalogError = modelsResponse.error.message
      } else {
        catalog = (modelsResponse.value as readonly { id: string; name?: string }[]).map(provider => ({
          provider: provider.id,
          providerName: provider.name ?? provider.id,
          model: provider.id,
          modelName: provider.name ?? provider.id,
        }))
      }
      let registered: readonly RegisteredPromptSectionView[] = []
      let builtInError: string | null = null
      if (!sectionsResponse.ok) {
        builtInError = sectionsResponse.error.message
      } else {
        registered = asRegisteredSections(sectionsResponse.value.sections)
      }
      this.accept(
        view,
        settingsResponse.value.writable,
        catalog,
        catalogError,
        registered,
        builtInError,
      )
    } catch (error) {
      if (generation !== this.generation) return
      this.fail(error)
    }
  }

  /** Open a create draft. */
  beginCreate(): void {
    this.store.update((state) => {
      state.draft = { id: null, kind: 'library', name: '', text: '', error: null, saving: false }
    })
  }

  /**
   * Open an edit draft over one library entry.
   * @param id - library id.
   */
  beginEdit(id: string): void {
    const prompt = this.store.getSnapshot().prompts.find(entry => entry.id === id)
    if (prompt === undefined) return
    this.store.update((state) => {
      state.draft = { id, kind: 'library', name: prompt.name, text: prompt.text, error: null, saving: false }
    })
  }

  /**
   * Open an edit draft over one registered plugin section.
   * @param name - registered section name.
   */
  beginEditBuiltIn(name: string): void {
    const section = this.store.getSnapshot().builtIns.find(entry => entry.name === name)
    if (section === undefined) return
    this.store.update((state) => {
      state.draft = {
        id: name,
        kind: 'builtin',
        name: section.name,
        text: section.text,
        error: null,
        saving: false,
      }
    })
  }

  /** Close the create/edit dialog. */
  cancelDraft(): void {
    this.store.update((state) => {
      state.draft = null
    })
  }

  /**
   * Update the draft name.
   * @param name - typed display name.
   */
  setDraftName(name: string): void {
    this.store.update((state) => {
      if (state.draft === null) return
      state.draft.name = name
      state.draft.error = null
    })
  }

  /**
   * Update the draft text.
   * @param text - typed prompt body.
   */
  setDraftText(text: string): void {
    this.store.update((state) => {
      if (state.draft === null) return
      state.draft.text = text
      state.draft.error = null
    })
  }

  /**
   * Persist the open draft.
   * @returns nothing; {@link store} carries success or failure.
   */
  async saveDraft(): Promise<void> {
    const state = this.store.getSnapshot()
    const draft = state.draft
    if (draft === null || !state.writable) return
    if (draft.kind === 'builtin') {
      if (draft.id === null) return
      this.store.update((current) => {
        if (current.draft === null) return
        current.draft.saving = true
        current.draft.error = null
      })
      const overrides = state.overrides.filter(entry => entry.name !== draft.id)
      overrides.push({ name: draft.id, text: draft.text })
      await this.write(
        { prompts: [...state.prompts], bindings: [...state.bindings], overrides },
        () => { this.store.update((current) => { current.draft = null }) },
      )
      return
    }
    const name = draft.name.trim()
    const text = draft.text.trim()
    if (name.length === 0) {
      this.store.update((current) => {
        if (current.draft === null) return
        current.draft.error = 'nameRequired'
      })
      return
    }
    if (text.length === 0) {
      this.store.update((current) => {
        if (current.draft === null) return
        current.draft.error = 'textRequired'
      })
      return
    }
    const prompts = [...state.prompts]
    if (draft.id === null) {
      prompts.push({ id: slugFromName(name, prompts.map(entry => entry.id)), name, text })
    } else {
      const index = prompts.findIndex(entry => entry.id === draft.id)
      const existing = index < 0 ? undefined : prompts[index]
      if (existing === undefined) return
      prompts[index] = { ...existing, name, text }
    }
    this.store.update((current) => {
      if (current.draft === null) return
      current.draft.saving = true
      current.draft.error = null
    })
    await this.write(
      { prompts, bindings: [...state.bindings], overrides: [...state.overrides] },
      () => { this.store.update((current) => { current.draft = null }) },
    )
  }

  /**
   * Drop the stored replacement for one registered section.
   * @param name - registered section name.
   */
  async resetBuiltIn(name: string): Promise<void> {
    const state = this.store.getSnapshot()
    if (!state.writable || !state.overrides.some(entry => entry.name === name)) return
    await this.write({
      prompts: [...state.prompts],
      bindings: [...state.bindings],
      overrides: state.overrides.filter(entry => entry.name !== name),
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
   * Delete the prompt awaiting confirmation and drop it from every binding.
   * @returns nothing; {@link store} carries success or failure.
   */
  async remove(): Promise<void> {
    const state = this.store.getSnapshot()
    const id = state.pendingDelete
    if (id === null || !state.writable) return
    this.store.update((current) => { current.deleting = true })
    const prompts = state.prompts.filter(entry => entry.id !== id)
    const bindings = state.bindings
      .map(entry => ({ ...entry, promptIds: entry.promptIds.filter(promptId => promptId !== id) }))
      .filter(entry => entry.promptIds.length > 0 || entry.override)
    await this.write({ prompts, bindings, overrides: [...state.overrides] }, () => {
      this.store.update((current) => {
        current.pendingDelete = null
        current.deleting = false
      })
    })
  }

  /**
   * Replace one model's selected prompt ids.
   * @param provider - provider route.
   * @param model - model id.
   * @param promptIds - ordered library ids.
   */
  async setPromptIds(provider: string, model: string, promptIds: readonly string[]): Promise<void> {
    await this.updateBinding(provider, model, current => ({ ...current, promptIds: [...promptIds] }))
  }

  /**
   * Toggle whether one model replaces the assembled prompt.
   * @param provider - provider route.
   * @param model - model id.
   * @param override - whether selected texts replace the assembled prompt.
   */
  async setOverride(provider: string, model: string, override: boolean): Promise<void> {
    await this.updateBinding(provider, model, current => ({ ...current, override }))
  }

  /** Stop in-flight responses from publishing after plugin disposal. */
  dispose(): void {
    this.generation += 1
    this.writeGeneration += 1
    this.view = undefined
    this.registered = []
  }

  private async updateBinding(
    provider: string,
    model: string,
    next: (current: BindingRow) => BindingRow,
  ): Promise<void> {
    const state = this.store.getSnapshot()
    if (!state.writable) return
    const current = bindingFor(state.bindings, provider, model)
    const updated = next(current)
    const empty = updated.promptIds.length === 0 && !updated.override
    const bindings = state.bindings.filter(entry => !(entry.provider === provider && entry.model === model))
    if (!empty) bindings.push(updated)
    await this.write({ prompts: [...state.prompts], bindings, overrides: [...state.overrides] })
  }

  private async write(
    section: { prompts: PromptRow[]; bindings: BindingRow[]; overrides: OverrideRow[] },
    onSuccess?: () => void,
  ): Promise<void> {
    const view = this.view
    if (view === undefined) {
      this.store.update((state) => {
        state.deleting = false
        if (state.draft !== null) {
          state.draft.saving = false
          state.draft.error = 'unavailable'
        }
      })
      return
    }
    // Writes keep their own generation so a document-updated refresh cannot
    // discard the replace result and leave the draft stuck on saving.
    const generation = ++this.writeGeneration
    try {
      const response = await this.api.settings.replace(
        USER_SYSTEM_PROMPTS_NS,
        section as never,
        view.revision,
      )
      if (generation !== this.writeGeneration) return
      if (!response.ok) throw new Error(response.error.message)
      const snapshot = this.store.getSnapshot()
      this.accept(
        response.value,
        snapshot.writable,
        snapshot.catalog,
        snapshot.catalogError,
        this.registered,
        snapshot.builtInError,
      )
      onSuccess?.()
    } catch (error) {
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

  private accept(
    view: SettingsNamespaceView,
    writable: boolean,
    catalog: readonly CatalogModel[],
    catalogError: string | null,
    registered: readonly RegisteredPromptSectionView[],
    builtInError: string | null,
  ): void {
    const value = (view.value ?? {}) as { prompts?: unknown; bindings?: unknown; overrides?: unknown }
    this.view = view
    this.registered = registered
    const overrides = asOverrideRows(value.overrides)
    this.store.update((state) => {
      state.status = 'ready'
      state.error = null
      state.catalogError = catalogError
      state.builtInError = builtInError
      state.writable = writable
      state.revision = view.revision
      state.prompts = asPromptRows(value.prompts)
      state.overrides = overrides
      state.builtIns = mergeBuiltIns(registered, overrides)
      state.bindings = asBindingRows(value.bindings)
      state.catalog = catalog
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
export function refreshIfLoaded(controller: SystemPromptsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}
