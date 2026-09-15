/**
 * Workspace entity registry (`ctx.workspaceRegistry`): durable workspace records,
 * stable registry order, and membership-home session projection over the
 * domain data form.
 * @module @deepseek-ai/dsh-workspace
 */

import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import type { DomainGlobal, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { membershipHome, WorkspaceEntity } from './entity.ts'
import type { WorkspaceEntityHost } from './entity.ts'

export { membershipHome, WorkspaceMoveInvalidError } from './entity.ts'
import { defaultWorkspaceTitle, realpathNormalize } from './paths.ts'
import { workspaceDomainSpec } from './spec.ts'
import type { SessionHomeMemory, WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
import type { Workspace, WorkspaceId as WorkspaceIdBrand } from './types.ts'

export type { Workspace } from './types.ts'
export { workspaceDomainState, workspaceRecord, workspaceDomainSpec } from './spec.ts'
export type { WorkspaceDomainState, WorkspaceRecord } from './spec.ts'
export { realpathNormalize } from './paths.ts'

/** Identifies one workspace record (see `src/types.ts` for the brand rationale). */
export type WorkspaceId = WorkspaceIdBrand

/**
 * Brand a string as a {@link WorkspaceId}.
 * @param id - Raw workspace id string.
 * @returns the same string, branded at compile time.
 */
export function WorkspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

/**
 * An archiveSession or unarchiveSession request named a session neither
 * live nor in session persistence — a definite miss only; storage faults
 * propagate as themselves.
 */
export class WorkspaceUnknownSessionError extends Error {
  /**
   * @param sessionId - The unknown session id.
   */
  constructor(readonly sessionId: SessionId) {
    super(`unknown session '${sessionId}': live sessions and session persistence hold no such session`)
    this.name = 'WorkspaceUnknownSessionError'
  }
}

/** A workspace reorder named a source or anchor absent from the durable registry order. */
export class WorkspaceOrderInvalidError extends Error {
  /**
   * @param workspaceId - Missing source or anchor id.
   */
  constructor(readonly workspaceId: WorkspaceId) {
    super(`cannot reorder unknown workspace '${workspaceId}'`)
    this.name = 'WorkspaceOrderInvalidError'
  }
}


declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceRegistry: WorkspaceRegistry
  }
}

interface BootstrapGroup {
  readonly path: string
  readonly headers: SessionHeader[]
  readonly newestAt: number
}

const sameIds = (left: readonly WorkspaceId[], right: readonly WorkspaceId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

const compareHeaders = (left: SessionHeader, right: SessionHeader): number =>
  right.createdAt - left.createdAt || String(left.id).localeCompare(String(right.id))

/**
 * One stored session as the registry indexes it: the header plus the
 * persistence artifact revision the home memory is keyed by.
 */
interface StoredHeaderEntry {
  header: SessionHeader
  revision?: SessionPersistenceRevision
}

/**
 * Durable workspace registry. Startup waits for `sessionPersistence`, builds
 * one membership-home index (last `workspace/home`, else header cwd), and
 * completes the one-time history bootstrap before the service becomes active.
 * First-boot grouping still uses header cwd only. The persistence dependency
 * is mandatory so an unavailable peer can never be mistaken for an empty
 * history and commit the initialized marker.
 */
export class WorkspaceRegistry extends Service {
  static inject = ['storageDomain', 'sessionPersistence']

  private table?: KvTable<WorkspaceId, WorkspaceRecord>
  private global?: DomainGlobal<WorkspaceDomainState>
  private state?: WorkspaceDomainState
  private readonly entities = new Map<WorkspaceId, WorkspaceEntity>()
  private readonly headers = new Map<SessionId, SessionHeader>()
  private readonly sessionPaths = new Map<SessionId, string>()
  private readonly invalidSessionPaths = new Map<SessionId, string>()
  private operationTail: Promise<void> = Promise.resolve()

  private readonly host: WorkspaceEntityHost = {
    table: () => this.requireTable(),
    sessionPath: id => this.sessionPaths.get(id),
    readSessionHeader: id => this.readSessionHeader(id),
    liveSessionEvents: id => this.ctx.get('sessions')?.get(id)?.snapshotEvents(),
    inspectSession: async (id) => {
      const inspected = await this.inspectSession(id)
      if (!inspected.ok || inspected.header === undefined || inspected.events === undefined) return undefined
      return { header: inspected.header, events: inspected.events }
    },
    rememberSessionPath: (id, path) => {
      this.sessionPaths.set(id, path)
      this.invalidSessionPaths.delete(id)
    },
    ownerOfPath: (path) => {
      for (const [id, entity] of this.entities) {
        if (entity.path === path || entity.folders.includes(path)) return id
      }
      return undefined
    },
  }

  constructor(ctx: Context) {
    super(ctx, 'workspaceRegistry')
  }

  /** Open the domain, finish bootstrap when required, and rebuild the ordered cache. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workspaceDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'workspace.domainClose')
    this.table = domain.table('workspaces')
    this.global = domain.global
    this.state = domain.global.get()

    await this.recoverPendingMutation()
    this.validateStoredState(this.state)
    if (!this.state.initialized) {
      const headers = await this.listStoredHeaders()
      await this.replaceHeaderIndex(headers, { overlays: false })
      await this.bootstrap(headers.map(entry => entry.header))
    } else if (this.table.size > 0) {
      await this.replaceHeaderIndex(await this.listStoredHeaders(), { overlays: true })
    }

    await this.indexLiveSessions()
    this.validateStoredState(this.requireState())
    this.rebuildEntities()
    this.reportFilteredCandidates()
  }

  /**
   * Create or reuse a workspace for an existing directory. The fully qualified
   * path is canonicalized through `fs.realpath`; a relative, nonexistent, or
   * non-directory path rejects. Repeated calls for the same canonical path
   * return the existing entity without changing its title
   * or its registry-order position; a hidden owner of that path is shown
   * in place as part of the same serialized write. A newly created
   * workspace is prepended to the durable registry order. Different
   * canonical paths may share a display title.
   * @param path - Existing directory to own, in a fully qualified path spelling.
   * @param title - Display title used only when a new record is created.
   * @returns the existing or newly durable workspace.
   */
  // TODO: `title` lost its last production caller when the gateway's
  // create-by-name branch was deleted
  // (.agents/notes/archived/simplification/2026-07-31-one-route-to-add-a-workspace.md);
  // drop the parameter with its @param clause and the `create(path, title?)`
  // lines in this package's README pair.
  async create(path: string, title?: string): Promise<Workspace> {
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`cannot create a workspace at '${canonical}': path is not a directory`)
    }
    return await this.enqueueOperation(() => this.createCanonical(canonical, title))
  }

  /**
   * Look up a workspace by id.
   * @param id - Workspace id.
   * @returns the workspace, or `undefined` when unknown.
   */
  get(id: WorkspaceId): Workspace | undefined {
    return this.entities.get(id)
  }

  /**
   * Synchronous workspace projection in durable registry order. Every
   * entity's `sessionIds` getter is already filtered by the startup/live
   * membership-home index; this method performs no persistence reads.
   * @returns a fresh ordered array of workspace entities.
   */
  list(): Workspace[] {
    return this.requireState().workspaceIds.map((id) => {
      const entity = this.entities.get(id)
      if (entity === undefined) {
        throw new Error(`workspace registry order references missing workspace '${id}'`)
      }
      return entity
    })
  }

  /**
   * Delete one workspace registration while retaining its directory and every
   * session log. The durable order is updated before the table deletion; a
   * failed table write restores the prior order and keeps the entity
   * published. A hidden id is dropped from the hidden set in the same
   * serialized operation. Unknown ids are an idempotent no-op for domain
   * callers.
   * @param id - Workspace registration to remove.
   * @returns `true` when a record was deleted, `false` when it was unknown.
   */
  delete(id: WorkspaceId): Promise<boolean> {
    return this.enqueueOperation(() => this.deleteKnown(id))
  }

  /**
   * Move one workspace within the durable display order, DOM-insertBefore-like.
   * With an anchor it lands before that workspace; without one it appends.
   * @param id - Workspace to move.
   * @param beforeId - Workspace anchor; omitted appends.
   * @returns the complete committed workspace order.
   */
  insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (!state.workspaceIds.includes(id)) throw new WorkspaceOrderInvalidError(id)
      if (beforeId !== undefined && !state.workspaceIds.includes(beforeId)) {
        throw new WorkspaceOrderInvalidError(beforeId)
      }
      if (beforeId === id) return state.workspaceIds
      const without = state.workspaceIds.filter(workspaceId => workspaceId !== id)
      const at = beforeId === undefined ? without.length : without.indexOf(beforeId)
      const workspaceIds = [...without.slice(0, at), id, ...without.slice(at)]
      if (sameIds(workspaceIds, state.workspaceIds)) return state.workspaceIds
      await this.setState({ ...state, workspaceIds })
      return workspaceIds
    })
  }

  /**
   * The registry-global archive set: sessions hidden from every grouping
   * surface. Archiving never touches workspace accounting — an archived
   * session keeps its `sessionIds` slot so unarchiving restores its position.
   * @returns the archived session ids in archive order.
   */
  get archivedSessionIds(): readonly SessionId[] {
    return this.requireState().archivedSessionIds
  }

  /**
   * The registry-global hidden set: workspaces folded out of the main list.
   * Hiding never rewrites `workspaceIds` or `sessionIds` — showing restores
   * the prior durable order position and membership.
   * @returns the hidden workspace ids in hide order.
   */
  get hiddenWorkspaceIds(): readonly WorkspaceId[] {
    return this.requireState().hiddenWorkspaceIds
  }

  /**
   * Archive one session durably. The session must exist (live or in session
   * persistence); its workspace accounting — or lack of one — is irrelevant.
   * An already archived id resolves without writing.
   * @param sessionId - The session to archive.
   * @returns resolution after durability.
   */
  archiveSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      // The chain slot serializes against every other registry write, so this
      // check-then-write pair cannot interleave with another archive.
      if (this.requireState().archivedSessionIds.includes(sessionId)) return
      if (!(await this.sessionKnown(sessionId))) {
        throw new WorkspaceUnknownSessionError(sessionId)
      }
      const state = this.requireState()
      await this.setState({ ...state, archivedSessionIds: [...state.archivedSessionIds, sessionId] })
    })
  }

  /**
   * Unarchive one session durably by dropping it from the registry-global
   * archive set; the accounting slot was never touched, so the session
   * returns to its recorded position. Unarchiving runs no session-existence
   * check because removing an id cannot introduce an unknown one, so an
   * entry whose session is gone still resolves. An id that is not archived
   * resolves without writing.
   * @param sessionId - The session to unarchive.
   * @returns resolution after durability.
   */
  unarchiveSession(sessionId: SessionId): Promise<void> {
    return this.enqueueOperation(async () => {
      // The chain slot serializes against every other registry write, so this
      // check-then-write pair cannot interleave with a concurrent archive.
      const state = this.requireState()
      if (!state.archivedSessionIds.includes(sessionId)) return
      await this.setState({
        ...state,
        archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId),
      })
    })
  }

  /**
   * Hide one registered workspace durably. Unknown ids are an idempotent
   * no-op returning false (Host maps that to workspace-not-found). An
   * already-hidden id succeeds without writing.
   * @param id - Workspace to hide.
   * @returns `true` when the workspace is registered, `false` when unknown.
   */
  hide(id: WorkspaceId): Promise<boolean> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (!state.workspaceIds.includes(id)) return false
      if (state.hiddenWorkspaceIds.includes(id)) return true
      await this.setState({ ...state, hiddenWorkspaceIds: [...state.hiddenWorkspaceIds, id] })
      return true
    })
  }

  /**
   * Show one registered workspace durably. Unknown ids are an idempotent
   * no-op returning false (Host maps that to workspace-not-found). A
   * registered id that is not hidden succeeds without writing.
   * @param id - Workspace to show.
   * @returns `true` when the workspace is registered, `false` when unknown.
   */
  show(id: WorkspaceId): Promise<boolean> {
    return this.enqueueOperation(async () => {
      const state = this.requireState()
      if (!state.workspaceIds.includes(id)) return false
      if (!state.hiddenWorkspaceIds.includes(id)) return true
      await this.setState({
        ...state,
        hiddenWorkspaceIds: state.hiddenWorkspaceIds.filter(workspaceId => workspaceId !== id),
      })
      return true
    })
  }

  /**
   * Whether a session is live, header-indexed, or present in a fresh
   * persistence listing. Only a definite miss returns false — a failing
   * `sessionPersistence.list()` propagates so storage faults never
   * masquerade as an unknown session.
   */
  private async sessionKnown(id: SessionId): Promise<boolean> {
    if (this.ctx.get('sessions')?.get(id) !== undefined) return true
    if (this.headers.has(id)) return true
    await this.indexHeaders(await this.listStoredHeaders(), { overlays: true })
    return this.headers.has(id)
  }

  /**
   * Resolve by canonical directory path without creating or mutating a
   * workspace. A missing path rejects during `realpath`; an existing unowned
   * directory returns `undefined`.
   * @param path - Existing directory path in a fully qualified spelling.
   * @returns the workspace owning the canonical path, when one exists.
   */
  async resolveByPath(path: string): Promise<Workspace | undefined> {
    const canonical = await realpathNormalize(path)
    for (const entity of this.entities.values()) {
      if (entity.path === canonical || entity.folders.includes(canonical)) return entity
    }
    return undefined
  }

  private async createCanonical(canonical: string, title?: string): Promise<WorkspaceEntity> {
    for (const entity of this.entities.values()) {
      if (entity.path === canonical || entity.folders.includes(canonical)) {
        const state = this.requireState()
        if (state.hiddenWorkspaceIds.includes(entity.id)) {
          await this.setState({
            ...state,
            hiddenWorkspaceIds: state.hiddenWorkspaceIds.filter(workspaceId => workspaceId !== entity.id),
          })
        }
        return entity
      }
    }

    const workspaceName = title ?? defaultWorkspaceTitle(canonical)
    const table = this.requireTable()
    const state = this.requireState()
    const id = WorkspaceId(randomUUID())
    const now = new Date().toISOString()
    const record: WorkspaceRecord = {
      path: canonical,
      title: workspaceName,
      folders: [],
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    }
    const entity = new WorkspaceEntity(this.host, id, record)
    this.entities.set(id, entity)
    const pendingState: WorkspaceDomainState = {
      ...state,
      pendingMutation: { operation: 'create', workspaceId: id },
    }
    try {
      await this.setState(pendingState)
    } catch (error) {
      this.entities.delete(id)
      throw error
    }
    try {
      await table.put(id, record)
    } catch (error) {
      this.entities.delete(id)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record write and pending-marker rollback both failed`,
        )
      }
      throw error
    }

    try {
      await this.setState({
        initialized: true,
        workspaceIds: [id, ...state.workspaceIds],
        archivedSessionIds: state.archivedSessionIds,
        hiddenWorkspaceIds: state.hiddenWorkspaceIds,
        sessionHomes: state.sessionHomes,
      })
    } catch (error) {
      this.entities.delete(id)
      try {
        await table.delete(id)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and record rollback both failed; the pending marker remains recoverable`,
        )
      }
      try {
        await this.setState(state)
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' order write and pending-marker rollback both failed`,
        )
      }
      throw error
    }
    return entity
  }

  private async deleteKnown(id: WorkspaceId): Promise<boolean> {
    const entity = this.entities.get(id)
    if (entity === undefined) return false
    const state = this.requireState()
    const nextState = {
      initialized: true,
      workspaceIds: state.workspaceIds.filter(workspaceId => workspaceId !== id),
      archivedSessionIds: state.archivedSessionIds,
      hiddenWorkspaceIds: state.hiddenWorkspaceIds.filter(workspaceId => workspaceId !== id),
      sessionHomes: state.sessionHomes,
    }
    await this.setState({
      ...nextState,
      pendingMutation: { operation: 'delete', workspaceId: id },
    })
    this.entities.delete(id)
    try {
      await this.requireTable().delete(id)
    } catch (error) {
      this.entities.set(id, entity)
      try {
        await this.setState(state)
      } catch (rollbackError) {
        // The durable marker still says to finish deletion, so the cache must
        // agree with that recoverable direction rather than republish a row
        // absent from the persisted order.
        this.entities.delete(id)
        throw new AggregateError(
          [error, rollbackError],
          `workspace '${id}' record deletion and registry-order rollback both failed`,
        )
      }
      throw error
    }
    try {
      await this.setState(nextState)
    } catch (error) {
      // The deletion committed at the table write and was already published
      // to Host streams. Keep the durable marker for startup recovery rather
      // than reporting failure after the requested state became true.
      this.ctx.logger.warn(
        `workspace '${id}' was deleted but its pending marker could not be cleared: ${String(error)}`,
      )
    }
    return true
  }

  /**
   * Complete the one mutation explicitly named by durable state. Unexplained
   * order/table divergence still reaches {@link validateStoredState} and
   * fails loud; this path never guesses which operation created a row from its shape alone.
   */
  private async recoverPendingMutation(): Promise<void> {
    const state = this.requireState()
    const pending = state.pendingMutation
    if (pending === undefined) return
    if (state.workspaceIds.includes(pending.workspaceId)) {
      throw new Error(
        `workspace domain is inconsistent: pending ${pending.operation} workspace `
        + `'${pending.workspaceId}' is still present in registry order`,
      )
    }
    await this.requireTable().delete(pending.workspaceId)
    await this.setState({
      initialized: state.initialized,
      workspaceIds: state.workspaceIds,
      archivedSessionIds: state.archivedSessionIds,
      hiddenWorkspaceIds: state.hiddenWorkspaceIds,
      sessionHomes: state.sessionHomes,
    })
  }

  private async bootstrap(headers: readonly SessionHeader[]): Promise<void> {
    const table = this.requireTable()
    const state = this.requireState()
    const groupsByPath = new Map<string, SessionHeader[]>()
    for (const header of headers) {
      const path = this.sessionPaths.get(header.id)
      if (path === undefined) continue
      const group = groupsByPath.get(path)
      if (group === undefined) groupsByPath.set(path, [header])
      else group.push(header)
    }
    const groups: BootstrapGroup[] = [...groupsByPath].map(([path, groupHeaders]) => {
      groupHeaders.sort(compareHeaders)
      const newest = groupHeaders[0] as SessionHeader
      return { path, headers: groupHeaders, newestAt: newest.createdAt }
    }).sort((left, right) =>
      right.newestAt - left.newestAt || left.path.localeCompare(right.path))

    const byPath = new Map<string, WorkspaceId>()
    const accounted = new Map<SessionId, WorkspaceId>()
    for (const [id, record] of table.entries()) {
      byPath.set(record.path, id)
      for (const sessionId of record.sessionIds) accounted.set(sessionId, id)
    }

    for (const group of groups) {
      let id = byPath.get(group.path)
      if (id === undefined) {
        const sessionIds = group.headers
          .map(header => header.id)
          .filter(sessionId => !accounted.has(sessionId))
        if (sessionIds.length === 0) continue
        id = WorkspaceId(randomUUID())
        const createdAt = new Date(group.newestAt).toISOString()
        const record: WorkspaceRecord = {
          path: group.path,
          title: defaultWorkspaceTitle(group.path),
          folders: [],
          sessionIds,
          createdAt,
          updatedAt: createdAt,
        }
        await table.put(id, record)
        byPath.set(group.path, id)
        for (const sessionId of sessionIds) accounted.set(sessionId, id)
        continue
      }

      const current = table.get(id) as WorkspaceRecord
      const historical = group.headers
        .map(header => header.id)
        .filter(sessionId => accounted.get(sessionId) === undefined || accounted.get(sessionId) === id)
      const historicalSet = new Set(historical)
      const sessionIds = [
        ...historical,
        ...current.sessionIds.filter(sessionId => !historicalSet.has(sessionId)),
      ]
      if (sameSessionIds(current.sessionIds, sessionIds)) continue
      await table.update(id, record => ({
        ...record,
        sessionIds,
        updatedAt: new Date().toISOString(),
      }))
      for (const sessionId of historical) accounted.set(sessionId, id)
    }

    const groupRank = new Map(groups.map(group => [group.path, group.newestAt]))
    const priorRank = new Map(state.workspaceIds.map((id, index) => [id, index]))
    const workspaceIds = [...table.entries()]
      .sort(([leftId, left], [rightId, right]) => {
        const leftTime = groupRank.get(left.path) ?? Date.parse(left.createdAt)
        const rightTime = groupRank.get(right.path) ?? Date.parse(right.createdAt)
        return rightTime - leftTime
          || (priorRank.get(leftId) ?? Number.MAX_SAFE_INTEGER)
            - (priorRank.get(rightId) ?? Number.MAX_SAFE_INTEGER)
          || String(leftId).localeCompare(String(rightId))
      })
      .map(([id]) => id)

    if (!sameIds(state.workspaceIds, workspaceIds)) {
      await this.setState({
        initialized: false,
        workspaceIds,
        archivedSessionIds: state.archivedSessionIds,
        hiddenWorkspaceIds: state.hiddenWorkspaceIds,
        sessionHomes: state.sessionHomes,
      })
    }
    await this.setState({
      initialized: true,
      workspaceIds,
      archivedSessionIds: state.archivedSessionIds,
      hiddenWorkspaceIds: state.hiddenWorkspaceIds,
      sessionHomes: state.sessionHomes,
    })
  }

  private validateStoredState(state: WorkspaceDomainState): void {
    const table = this.requireTable()
    const order = new Set<WorkspaceId>()
    for (const id of state.workspaceIds) {
      if (order.has(id)) {
        throw new Error(`workspace domain is inconsistent: registry order repeats workspace '${id}'`)
      }
      if (table.get(id) === undefined) {
        throw new Error(`workspace domain is inconsistent: registry order references missing workspace '${id}'`)
      }
      order.add(id)
    }
    if (state.initialized && order.size !== table.size) {
      const orphan = [...table.keys()].find(id => !order.has(id))
      throw new Error(
        `workspace domain is inconsistent: workspace '${orphan as WorkspaceId}' is absent from registry order`,
      )
    }

    const paths = new Map<string, WorkspaceId>()
    const accounted = new Map<SessionId, WorkspaceId>()
    const claimPath = (claimed: string, id: WorkspaceId): void => {
      const pathHolder = paths.get(claimed)
      if (pathHolder !== undefined) {
        throw new Error(
          `workspace domain is inconsistent: path '${claimed}' is claimed `
          + `by both workspace '${pathHolder}' and workspace '${id}'`,
        )
      }
      paths.set(claimed, id)
    }
    for (const [id, record] of table.entries()) {
      claimPath(record.path, id)
      for (const folder of record.folders) {
        if (folder === record.path) {
          throw new Error(
            `workspace domain is inconsistent: workspace '${id}' lists its primary path as an additional folder`,
          )
        }
        claimPath(folder, id)
      }
      for (const sessionId of record.sessionIds) {
        const holder = accounted.get(sessionId)
        if (holder !== undefined) {
          throw new Error(
            `workspace domain is inconsistent: session '${sessionId}' is accounted `
            + `by both workspace '${holder}' and workspace '${id}'`,
          )
        }
        accounted.set(sessionId, id)
      }
    }
  }

  private rebuildEntities(): void {
    this.entities.clear()
    for (const id of this.requireState().workspaceIds) {
      const record = this.requireTable().get(id) as WorkspaceRecord
      this.entities.set(id, new WorkspaceEntity(this.host, id, record))
    }
  }

  private async replaceHeaderIndex(
    headers: readonly StoredHeaderEntry[],
    options: { overlays: boolean },
  ): Promise<void> {
    this.headers.clear()
    this.sessionPaths.clear()
    this.invalidSessionPaths.clear()
    const updates = await this.indexHeaders(headers, options)
    await this.flushSessionHomes(updates, headers)
  }

  private async indexHeaders(
    headers: readonly StoredHeaderEntry[],
    options: { overlays: boolean } = { overlays: false },
  ): Promise<Map<SessionId, SessionHomeMemory>> {
    const memoryUpdates = new Map<SessionId, SessionHomeMemory>()
    for (const entry of headers) {
      await this.indexHeader(entry.header, options, entry.revision, memoryUpdates)
    }
    return memoryUpdates
  }

  private async indexHeader(
    header: SessionHeader,
    options: { overlays: boolean } = { overlays: false },
    revision?: SessionPersistenceRevision,
    memoryUpdates?: Map<SessionId, SessionHomeMemory>,
  ): Promise<void> {
    this.headers.set(header.id, header)
    const live = this.ctx.get('sessions')?.get(header.id)
    let events: readonly SessionEvent[] | undefined = live?.snapshotEvents()
    let rememberedHome: string | undefined
    let remembered = false
    if (options.overlays && events === undefined && this.accountedSessionIds().has(header.id)) {
      const memo = live === undefined && revision !== undefined
        ? this.requireState().sessionHomes[header.id]
        : undefined
      if (memo !== undefined && memo.revision === revision) {
        rememberedHome = memo.home
        remembered = true
      } else {
        const inspected = await this.inspectSession(header.id)
        if (inspected.ok) {
          if (inspected.events !== undefined) events = inspected.events
        } else {
          this.ctx.logger.warn(
            `workspace ignored overlay for session '${header.id}': inspect failed: ${inspected.reason}`,
          )
        }
        // A refused migration repeats identically on every read, so the
        // header-cwd fallback is remembered too: the next boot with the same
        // artifact revision must not pay for the same refusal again.
        if (live === undefined && revision !== undefined) {
          memoryUpdates?.set(header.id, { revision, home: membershipHome(header.cwd, events) })
        }
      }
    }
    if (!options.overlays && events === undefined && this.sessionPaths.has(header.id)) return
    const home = remembered ? rememberedHome : membershipHome(header.cwd, events)
    if (home === undefined) {
      this.sessionPaths.delete(header.id)
      this.invalidSessionPaths.set(header.id, 'header has no home')
      return
    }
    try {
      const path = await realpathNormalize(home)
      if (!(await stat(path)).isDirectory()) {
        this.sessionPaths.delete(header.id)
        this.invalidSessionPaths.set(header.id, `home '${home}' is not a directory`)
        return
      }
      this.sessionPaths.set(header.id, path)
      this.invalidSessionPaths.delete(header.id)
    } catch {
      this.sessionPaths.delete(header.id)
      this.invalidSessionPaths.set(header.id, `home '${home}' does not resolve`)
    }
  }

  private accountedSessionIds(): Set<SessionId> {
    const accounted = new Set<SessionId>()
    for (const [, record] of this.requireTable().entries()) {
      for (const sessionId of record.sessionIds) accounted.add(sessionId)
    }
    return accounted
  }

  private async inspectSession(id: SessionId): Promise<
    | { ok: true; header: SessionHeader; events: readonly SessionEvent[] }
    | { ok: true; header?: undefined; events?: undefined }
    | { ok: false; reason: string }
  > {
    const persistence = this.ctx.sessionPersistence
    if (typeof persistence.open !== 'function') return { ok: true }
    try {
      const handle = await persistence.open(id, 'read')
      try {
        return { ok: true, header: handle.header, events: (await handle.read()).events }
      } finally {
        await handle.close()
      }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Every stored session's header, projected from the persistence snapshot listing. */
  private async listStoredHeaders(): Promise<readonly StoredHeaderEntry[]> {
    const snapshots = await this.ctx.sessionPersistence.list()
    return snapshots.map(snapshot => ({ header: snapshot.header, revision: snapshot.revision }))
  }

  /**
   * Commit session-home memories from one indexing pass. Entries in
   * `listed` (a full stored listing) bound the table: memories for sessions
   * absent from it are dropped so the table cannot outgrow the store.
   * @param updates - memories resolved during indexing; an artifact whose
   *   revision already remembers the same answer is not rewritten.
   * @param listed - the full stored listing this pass indexed, when it was one.
   */
  private async flushSessionHomes(
    updates: ReadonlyMap<SessionId, SessionHomeMemory>,
    listed?: readonly StoredHeaderEntry[],
  ): Promise<void> {
    let changed = false
    const state = this.requireState()
    const pending = new Map([...updates].map(([id, memory]) => [String(id), memory] as const))
    const present = listed === undefined ? undefined : new Set(listed.map(entry => String(entry.header.id)))
    // Rebuilt forward rather than deleted in place: the table is a plain JSON
    // record, and dynamic deletes would push it into dictionary mode.
    const next: Record<string, SessionHomeMemory> = {}
    for (const [key, memory] of Object.entries(state.sessionHomes)) {
      if (present !== undefined && !present.has(key)) {
        changed = true
        continue
      }
      const update = pending.get(key)
      pending.delete(key)
      if (update !== undefined && (update.revision !== memory.revision || update.home !== memory.home)) {
        next[key] = update
        changed = true
        continue
      }
      next[key] = memory
    }
    for (const [key, memory] of pending) {
      next[key] = memory
      changed = true
    }
    if (!changed) return
    await this.setState({ ...state, sessionHomes: next })
  }

  private async indexLiveSessions(): Promise<void> {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) return
    // Live sessions carry no stored revision yet; their snapshotEvents() answer is
    // free, so no memory is consulted or written for them.
    await this.indexHeaders(sessions.list().map(session => ({ header: session.header })), { overlays: true })
  }

  private reportFilteredCandidates(): void {
    for (const entity of this.entities.values()) {
      const record = this.requireTable().get(entity.id) as WorkspaceRecord
      for (const sessionId of record.sessionIds) {
        const path = this.sessionPaths.get(sessionId)
        if (path === record.path) continue
        const reason = this.invalidSessionPaths.get(sessionId)
          ?? (this.headers.has(sessionId)
            ? `canonical home '${path}' differs from workspace path '${record.path}'`
            : 'session header is missing')
        this.ctx.logger.warn(
          `workspace '${entity.id}' filtered session '${sessionId}' from membership: ${reason}`,
        )
      }
    }
  }

  private async readSessionHeader(id: SessionId): Promise<SessionHeader> {
    const live = this.ctx.get('sessions')?.get(id)
    if (live !== undefined) {
      this.headers.set(id, live.header)
      return live.header
    }
    const cached = this.headers.get(id)
    if (cached !== undefined) return cached

    const headers = await this.listStoredHeaders()
    const updates = await this.indexHeaders(headers, { overlays: true })
    await this.flushSessionHomes(updates, headers)
    const header = this.headers.get(id)
    if (header === undefined) {
      throw new Error(`cannot validate session '${id}': session persistence holds no such session`)
    }
    return header
  }

  private requireTable(): KvTable<WorkspaceId, WorkspaceRecord> {
    if (this.table === undefined) throw new Error('workspace registry is not started yet')
    return this.table
  }

  private requireState(): WorkspaceDomainState {
    if (this.state === undefined) throw new Error('workspace registry is not started yet')
    return this.state
  }

  private async setState(state: WorkspaceDomainState): Promise<void> {
    await (this.global as DomainGlobal<WorkspaceDomainState>).set(state)
    this.state = state
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(async () => {
      // A committed delete may leave only its marker cleanup pending. Retry
      // recovery before another create/delete can overwrite that pending operation record.
      await this.recoverPendingMutation()
      return await operation()
    })
    this.operationTail = result.then(() => {}, () => {})
    return result
  }
}

const sameSessionIds = (left: readonly SessionId[], right: readonly SessionId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

export default WorkspaceRegistry
