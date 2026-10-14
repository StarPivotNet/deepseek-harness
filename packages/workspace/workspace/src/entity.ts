/**
 * Package-private workspace entity: the single {@link Workspace}
 * implementation. Holds a record snapshot that is swapped in place after each
 * durable mutation; every write funnels through the private `mutate` so
 * `updatedAt` stamping and invalid-account pruning happen exactly once.
 * Not re-exported from the package entrypoint — consumers see only the
 * `Workspace` interface.
 * @module @deepseek-ai/dsh-workspace/src/entity
 */

import { stat } from 'node:fs/promises'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceRecord } from './spec.ts'
import type { Workspace, WorkspaceId } from './types.ts'
import { realpathNormalize } from './paths.ts'

/** An insertSessionBefore request named a session or anchor not on the account (storage failures stay plain errors). */
export class WorkspaceMoveInvalidError extends Error {
  /**
   * @param message - Which id was unaccounted and where.
   */
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceMoveInvalidError'
  }
}

/**
 * The registry-owned machinery an entity mutates through. Entities never see
 * the registry itself — only the open table, the canonical session-path
 * index backing the `sessionIds` projection, and attach-time header reads.
 */
export interface WorkspaceEntityHost {
  /**
   * Resolve the open `workspaces` table.
   * @returns the table; throws while the registry has not started yet.
   */
  table(): KvTable<WorkspaceId, WorkspaceRecord>

  /**
   * Validate an already-accounted session against its canonical membership
   * home, preserving ownership when that fully qualified home cannot resolve
   * because a path component is missing.
   * @param id - Session already present in this workspace's candidate account.
   * @param path - Workspace's stored canonical directory.
   * @returns whether the candidate remains a member.
   */
  candidateMatches(id: SessionId, path: string): boolean

  /**
   * Read one stored session header for attach validation.
   * @param id - The session whose header to read.
   * @returns the header; rejects when session persistence is absent or holds
   * no session with this id.
   */
  readSessionHeader(id: SessionId): Promise<SessionHeader>

  /**
   * Live session events when the session is attached in this process.
   * Cold attach inspects persistence when this is undefined.
   * @param id - Session whose live log is requested.
   */
  liveSessionEvents(id: SessionId): readonly SessionEvent[] | undefined

  /**
   * Persistently inspect one session without publishing it. Used for cold
   * attach when no live log is present.
   * @param id - Session whose stored log to inspect.
   * @returns header and events when inspect succeeds; undefined when inspect
   * is absent, the session is unknown, or inspect fails.
   */
  inspectSession(id: SessionId): Promise<{ header: SessionHeader; events: readonly SessionEvent[] } | undefined>

  /**
   * Publish a successfully validated canonical home to the projection index.
   * @param id - Validated session id.
   * @param path - Canonical existing directory from the membership home.
   */
  rememberSessionPath(id: SessionId, path: string): void

  /**
   * The workspace that already claims a canonical path as primary or additional
   * folder, if any.
   * @param path - Canonical existing directory.
   * @returns the owning workspace id, or `undefined` when the path is free.
   */
  ownerOfPath(path: string): WorkspaceId | undefined
}

/** Chain-slot abort sentinel thrown by the update fn when the record needs no change; only `mutate` observes it. */
const unchangedSentinel = new Error('workspace record unchanged (internal sentinel)')

/** The single {@link Workspace} implementation; constructed only by the registry. */
export class WorkspaceEntity implements Workspace {
  private record: WorkspaceRecord

  /**
   * @param host - Registry-owned table, session-path index, and header reads.
   * @param id - The record's stable id.
   * @param record - The validated record snapshot loaded or just written.
   */
  constructor(
    private readonly host: WorkspaceEntityHost,
    readonly id: WorkspaceId,
    record: WorkspaceRecord,
  ) {
    this.record = record
  }

  get path(): string {
    return this.record.path
  }

  get folders(): readonly string[] {
    return this.record.folders
  }

  get title(): string {
    return this.record.title
  }

  get createdAt(): string {
    return this.record.createdAt
  }

  get updatedAt(): string {
    return this.record.updatedAt
  }

  get sessionIds(): readonly SessionId[] {
    return this.record.sessionIds.filter(id => this.host.candidateMatches(id, this.record.path))
  }

  async setTitle(title: string): Promise<void> {
    await this.mutate(record => ({ ...record, title }))
  }

  async attachSession(sessionId: SessionId): Promise<void> {
    // Validation is skipped when the settled snapshot already accounts the
    // id. A later rehome updates the indexed path before attach. Membership
    // itself is decided on the write chain inside `mutate`, never on this
    // snapshot.
    if (!this.record.sessionIds.includes(sessionId)) {
      const header = await this.host.readSessionHeader(sessionId)
      const liveEvents = this.host.liveSessionEvents(sessionId)
      const inspected = liveEvents === undefined ? await this.host.inspectSession(sessionId) : undefined
      const home = membershipHome(header.cwd, liveEvents ?? inspected?.events)
      if (home === undefined) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + 'its stored header carries no cwd to validate against',
        )
      }
      let cwd: string
      try {
        cwd = await realpathNormalize(home)
      } catch (error) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd '${home}' does not resolve, so it cannot be validated`,
          { cause: error },
        )
      }
      if (!(await stat(cwd)).isDirectory()) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd '${home}' is not a directory`,
        )
      }
      if (cwd !== this.record.path) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd resolves to '${cwd}'`,
        )
      }
      this.host.rememberSessionPath(sessionId, cwd)
    }
    await this.mutate(record => record.sessionIds.includes(sessionId)
      ? record
      : { ...record, sessionIds: [sessionId, ...record.sessionIds] })
  }

  async insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void> {
    await this.mutate((record) => {
      if (!record.sessionIds.includes(sessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' in workspace '${record.path}': the session is not accounted`,
        )
      }
      if (beforeSessionId !== undefined && !record.sessionIds.includes(beforeSessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' before '${beforeSessionId}' in workspace '${record.path}': `
          + 'the anchor session is not accounted',
        )
      }
      if (beforeSessionId === sessionId) return record
      const without = record.sessionIds.filter(id => id !== sessionId)
      const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId)
      const sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)]
      return sessionIds.every((id, index) => id === record.sessionIds[index])
        ? record
        : { ...record, sessionIds }
    })
  }

  async detachSession(sessionId: SessionId): Promise<void> {
    await this.mutate(record => record.sessionIds.includes(sessionId)
      ? { ...record, sessionIds: record.sessionIds.filter(id => id !== sessionId) }
      : record)
  }

  async addFolder(path: string): Promise<void> {
    const canonical = await realpathNormalize(path)
    if (!(await stat(canonical)).isDirectory()) {
      throw new Error(`cannot add folder '${canonical}' to workspace '${this.record.path}': path is not a directory`)
    }
    const owner = this.host.ownerOfPath(canonical)
    if (owner !== undefined && owner !== this.id) {
      throw new Error(
        `cannot add folder '${canonical}' to workspace '${this.record.path}': `
        + `workspace '${owner}' already claims that path`,
      )
    }
    await this.mutate((record) => {
      if (canonical === record.path || record.folders.includes(canonical)) return record
      return { ...record, folders: [...record.folders, canonical] }
    })
  }

  async removeFolder(path: string): Promise<void> {
    let canonical: string
    try {
      canonical = await realpathNormalize(path)
    } catch {
      // A missing or unreadable spelling still matches a stored folder by
      // exact string so a vanished additional folder can be removed.
      canonical = path
    }
    await this.mutate((record) => {
      if (canonical === record.path) {
        throw new Error(`cannot remove the primary folder '${record.path}' from workspace '${this.id}'`)
      }
      if (!record.folders.includes(canonical)) return record
      return { ...record, folders: record.folders.filter(folder => folder !== canonical) }
    })
  }

  async status(): Promise<'ok' | 'missing-dir'> {
    try {
      return (await stat(this.record.path)).isDirectory() ? 'ok' : 'missing-dir'
    } catch {
      // Any stat failure (ENOENT, dangling parent, permission loss) means the
      // directory is not usable right now; the record itself never mutates.
      return 'missing-dir'
    }
  }

  /**
   * The single write path: run `fn` on the domain write chain via
   * `table.update`, stamping `updatedAt` and pruning candidates that no
   * longer pass the candidate membership check, then swap the
   * snapshot.
   *
   * `fn` sees the value current at its chain slot, so membership decisions
   * (attach/detach idempotence) are race-free against queued writes; a fn
   * signalling no change by returning `current` verbatim aborts the slot
   * through the sentinel when pruning also finds nothing, so a no-op neither
   * rewrites the medium nor emits a change event.
   */
  private async mutate(fn: (record: WorkspaceRecord) => WorkspaceRecord): Promise<void> {
    let next: WorkspaceRecord
    try {
      next = await this.host.table().update(this.id, (current) => {
        const changed = fn(current)
        const sessionIds = changed.sessionIds.filter(
          id => this.host.candidateMatches(id, changed.path),
        )
        if (changed === current && sessionIds.length === current.sessionIds.length) {
          throw unchangedSentinel
        }
        return { ...changed, sessionIds, updatedAt: new Date().toISOString() }
      })
    } catch (error) {
      if (error === unchangedSentinel) return
      throw error
    }
    this.record = next
  }
}

/**
 * Workspace membership home: last `workspace/home` overlay, else header cwd.
 * `git/worktree` is a same-repo overlay and does not change membership.
 * @param headerCwd - birth cwd from the session header.
 * @param events - live or inspected log, or undefined when none is available.
 */
export function membershipHome(
  headerCwd: string | undefined,
  events: readonly SessionEvent[] | undefined,
): string | undefined {
  if (events !== undefined) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event === undefined) continue
      // workspace/home is declared on dsh-sandbox-policy; this package only
      // reads the overlay without depending on that plugin.
      if ((event.type as string) !== 'workspace/home') continue
      const path = (event.data as { path?: unknown }).path
      if (typeof path === 'string' && path.length > 0) return path
    }
  }
  return headerCwd
}
