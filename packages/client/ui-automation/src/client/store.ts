/**
 * Host Automation page store: the Host remains the single fact source.
 * Every mutation writes through the wire and the page re-renders from the
 * next list, pushed or refetched.
 */

import type { ClientRemote, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Wire view of one Automation rule, as the list RPC returns it. */
export type AutomationRuleView = Awaited<
  ReturnType<ClientRemote['automation']['list']>
> extends RemoteResult<infer Value>
  ? Value extends { items: readonly (infer Item)[] } ? Item : never
  : never

/** Create payload accepted by the Host Automation wire. */
export type AutomationCreateInput = Parameters<ClientRemote['automation']['create']>[0]

/** Sparse update payload accepted by the Host Automation wire. */
export type AutomationUpdateInput = Omit<Parameters<ClientRemote['automation']['update']>[0], 'id'>

/** One fire attempt as the listRuns RPC returns it. */
export type AutomationRunView = Awaited<
  ReturnType<ClientRemote['automation']['listRuns']>
> extends RemoteResult<infer Value>
  ? Value extends { items: readonly (infer Item)[] } ? Item : never
  : never

/** One listed rule plus the run count the page paints on the card. */
export interface AutomationListedRule {
  rule: AutomationRuleView
  /** Absent while listRuns has not landed or that call failed. */
  runCount?: number
  /** Latest started Session for this rule, when listRuns returned one. */
  lastSessionId?: SessionId
  /** Newest-first fire history for the selected rule. */
  runs?: readonly AutomationRunView[]
}

/** Which pane the selected rule shows. */
export type AutomationDetailTab = 'settings' | 'history'

/** Page snapshot. */
export interface AutomationState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; row-level write failures stay on the row. */
  error: string | null
  items: readonly AutomationListedRule[]
  /** Whether the center-column Automation page is showing. */
  pageOpen: boolean
  /** Selected rule, when the detail pane is open. */
  selectedId: AutomationRuleView['id'] | null
  /** Settings or history pane of the selected rule. */
  detailTab: AutomationDetailTab
}

/**
 * Human text for a rejected wire call.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type RemoteEnvelope<T> = { ok: boolean; value?: T; error?: { message: string } }

/** Accept either a Typert Remote result or the historical unary envelope. */
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

/**
 * Unwrap a unary response into its value or throw the Host error message.
 * @param response - the unary response.
 * @returns the success value.
 */
function valueOf<T>(response: RemoteResult<T>): T {
  const unwrapped = unwrapRemote<T>(response)
  if (!unwrapped.ok) throw new Error(unwrapped.error?.message ?? 'remote call failed')
  return unwrapped.value as T
}

/** How long run-now waits for the started Session to appear in the list. */
const LISTED_SESSION_WAIT_MS = 10_000

/** List-and-open face used after a started fire. */
interface AutomationSessions {
  list: {
    getSnapshot(): { byId: Record<string, unknown> }
    subscribe(fn: () => void): () => void
  }
  open(id: SessionId): void
}

/** Host Automation list and mutation owner. */
export class AutomationStore {
  /** UI-facing immutable projection. */
  readonly store: SnapshotStore<AutomationState> = createSnapshotStore<AutomationState>({
    status: 'idle',
    error: null,
    items: [],
    pageOpen: false,
    selectedId: null,
    detailTab: 'settings',
  })

  /**
   * @param api - automation wire face.
   * @param sessions - list store used to wait for and open a started fire.
   * @param listedSessionWaitMs - how long a started fire waits for the list.
   */
  constructor(
    private readonly api: Pick<ClientRemote, 'automation'>,
    private readonly sessions: AutomationSessions,
    private readonly listedSessionWaitMs: number = LISTED_SESSION_WAIT_MS,
  ) {}

  /** Increments on every load so a slower earlier list cannot overwrite a newer one. */
  private loadGeneration = 0

  /**
   * Fetch every rule and the run count for each. A failed reload keeps the last
   * good list when one exists. A failed listRuns leaves that card without a count.
   * @returns once the snapshot has the new status.
   */
  async load(): Promise<void> {
    const generation = ++this.loadGeneration
    const previous = this.store.getSnapshot()
    this.store.update((draft) => {
      draft.status = previous.items.length === 0 ? 'loading' : previous.status
      draft.error = null
    })
    try {
      const value = valueOf(await this.api.automation.list())
      if (generation !== this.loadGeneration) return
      const previousById = new Map(previous.items.map(item => [item.rule.id, item]))
      const items = value.items.map((rule) => {
        const known = previousById.get(rule.id)
        return known === undefined
          ? { rule }
          : {
            rule,
            ...known.runCount === undefined ? {} : { runCount: known.runCount },
            ...known.lastSessionId === undefined ? {} : { lastSessionId: known.lastSessionId },
            ...known.runs === undefined ? {} : { runs: known.runs },
          }
      })
      this.store.update((draft) => {
        draft.status = 'ready'
        draft.error = null
        draft.items = items
      })
      const counted = await Promise.all(value.items.map(async (rule) => {
        try {
          const runs = valueOf(await this.api.automation.listRuns({ id: rule.id, limit: 10_000 })).items
          const lastStarted = runs.find(run => run.sessionId !== undefined)
          return {
            rule,
            runCount: runs.length,
            runs,
            ...lastStarted?.sessionId === undefined ? {} : { lastSessionId: lastStarted.sessionId },
          }
        } catch {
          // A missing count is a card-local gap; the rule list itself already landed.
          return { rule }
        }
      }))
      if (generation !== this.loadGeneration) return
      this.store.update((draft) => {
        draft.items = counted
      })
    } catch (error) {
      const latest = this.store.getSnapshot()
      const keepRows = latest.items.length > 0 || previous.items.length > 0
      if (generation !== this.loadGeneration && keepRows) {
        this.store.update((draft) => {
          draft.error = messageOf(error)
        })
        return
      }
      if (generation !== this.loadGeneration) return
      this.store.update((draft) => {
        draft.status = keepRows ? 'ready' : 'error'
        draft.error = messageOf(error)
      })
    }
  }

  /**
   * Create one enabled rule and refresh the list.
   * @param input - create payload; exactly one selector field.
   * @returns the failure message, or undefined once the write and reload landed.
   */
  /**
   * Apply a sparse patch to one rule and refresh the list.
   * @param id - existing rule.
   * @param input - fields to change; changing the schedule still requires one selector.
   * @returns the failure message, or undefined once the write and reload landed.
   */
  async update(id: AutomationRuleView['id'], input: AutomationUpdateInput): Promise<string | undefined> {
    try {
      valueOf(await this.api.automation.update({ id, ...input }))
    } catch (error) {
      return messageOf(error)
    }
    await this.load()
    return this.store.getSnapshot().error ?? undefined
  }

  async create(input: AutomationCreateInput): Promise<string | undefined> {
    try {
      valueOf(await this.api.automation.create(input))
    } catch (error) {
      return messageOf(error)
    }
    await this.load()
    return this.store.getSnapshot().error ?? undefined
  }

  /**
   * Enable or disable one rule and refresh the list.
   * @param id - existing rule.
   * @param enabled - next armed state.
   * @returns the failure message, or undefined once the write and reload landed.
   */
  async setEnabled(id: AutomationRuleView['id'], enabled: boolean): Promise<string | undefined> {
    try {
      valueOf(await this.api.automation.setEnabled({ id, enabled }))
    } catch (error) {
      return messageOf(error)
    }
    await this.load()
    return this.store.getSnapshot().error ?? undefined
  }

  /**
   * Fire one rule immediately without moving its next target. A started run
   * closes the Automation page and opens the new Session; skipped or failed
   * outcomes stay on the page with the Host error.
   * @param id - existing rule.
   * @returns the failure message, or undefined once the write landed.
   */
  async runNow(id: AutomationRuleView['id']): Promise<string | undefined> {
    try {
      const run = valueOf(await this.api.automation.runNow({ id })).run
      if (run.outcome === 'started' && run.sessionId !== undefined) {
        return this.openRunSession(run.sessionId)
      }
      if (run.outcome === 'skipped_busy') {
        const previousId = this.lastSessionId(id)
        if (previousId !== undefined) {
          const opened = await this.openRunSession(previousId)
          return opened ?? 'skipped_busy'
        }
        return 'skipped_busy'
      }
      if (run.outcome === 'failed') return 'failed'
    } catch (error) {
      return messageOf(error)
    }
    return undefined
  }

  /**
   * Delete one rule and refresh the list.
   * @param id - existing rule.
   * @returns the failure message, or undefined once the write and reload landed.
   */
  async remove(id: AutomationRuleView['id']): Promise<string | undefined> {
    try {
      valueOf(await this.api.automation.delete({ id }))
    } catch (error) {
      return messageOf(error)
    }
    await this.load()
    this.store.update((draft) => {
      if (draft.selectedId === id) {
        draft.selectedId = null
        draft.detailTab = 'settings'
      }
    })
    return this.store.getSnapshot().error ?? undefined
  }

  /**
   * Open one rule's detail pane, or return to the card list.
   * @param id - existing rule, or null to close the detail pane.
   */
  select(id: AutomationRuleView['id'] | null): void {
    this.store.update((draft) => {
      draft.selectedId = id
      if (id === null) draft.detailTab = 'settings'
    })
  }

  /**
   * Show the settings or history pane of the selected rule.
   * @param tab - next pane.
   */
  setDetailTab(tab: AutomationDetailTab): void {
    this.store.update((draft) => {
      draft.detailTab = tab
    })
  }

  /**
   * Open a started run's Session when the Host list carries it.
   * @param sessionId - Session the run opened.
   * @returns the failure message, or undefined once the Session is current.
   */
  async openRun(sessionId: SessionId): Promise<string | undefined> {
    return this.openRunSession(sessionId)
  }

  /**
   * Delete one past run and refresh the list.
   * @param id - existing run.
   * @returns the failure message, or undefined once the write and reload landed.
   */
  async deleteRun(id: AutomationRunView['id']): Promise<string | undefined> {
    try {
      valueOf(await this.api.automation.deleteRun({ id }))
    } catch (error) {
      return messageOf(error)
    }
    await this.load()
    return this.store.getSnapshot().error ?? undefined
  }

  /**
   * Open the latest started Session for a rule without firing again.
   * @param id - existing rule.
   * @returns the failure message, or undefined once the Session is current.
   */
  async openLastSession(id: AutomationRuleView['id']): Promise<string | undefined> {
    const sessionId = this.lastSessionId(id)
    if (sessionId === undefined) return 'missing_session'
    return this.openRunSession(sessionId)
  }

  lastSessionId(id: AutomationRuleView['id']): SessionId | undefined {
    return this.store.getSnapshot().items.find(item => item.rule.id === id)?.lastSessionId
  }

  async openRunSession(sessionId: SessionId): Promise<string | undefined> {
    try {
      await waitForListedSession(this.sessions, sessionId, this.listedSessionWaitMs)
    } catch {
      // waitForListedSession rejects only when the list never carries the Session.
      return 'missing_session'
    }
    this.setPageOpen(false)
    this.sessions.open(sessionId)
    return undefined
  }

  setPageOpen(open: boolean): void {
    this.store.update((draft) => {
      draft.pageOpen = open
      if (!open) {
        draft.selectedId = null
        draft.detailTab = 'settings'
      }
    })
  }
}

/**
 * Refetch the page snapshot only after its first load.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: AutomationStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Wait until the Host list (or a later session-added frame) carries `id`.
 * `sessions.open` rejects unknown ids; fire publishes the Session before
 * this RPC returns, but the list frame can arrive after the unary echo.
 * @param sessions - list store that receives host/session-added.
 * @param id - Session the started run opened.
 * @param timeoutMs - give up after this many milliseconds.
 */
function waitForListedSession(
  sessions: Pick<AutomationSessions, 'list'>,
  id: SessionId,
  timeoutMs: number = LISTED_SESSION_WAIT_MS,
): Promise<void> {
  if (sessions.list.getSnapshot().byId[id] !== undefined) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      stop()
      clearTimeout(timer)
      if (error === undefined) resolve()
      else reject(error)
    }
    const stop = sessions.list.subscribe(() => {
      if (sessions.list.getSnapshot().byId[id] !== undefined) finish()
    })
    const timer = setTimeout(() => {
      finish(new Error('started session did not appear in the list'))
    }, timeoutMs)
    if (sessions.list.getSnapshot().byId[id] !== undefined) finish()
  })
}
