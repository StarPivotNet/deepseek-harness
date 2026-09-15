/** Workspace command implementation and stable Remote failure mapping. */

import { mkdir, realpath } from 'node:fs/promises'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Context } from '@deepseek-ai/cordis'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  WorkspaceId,
  WorkspaceMoveInvalidError,
  WorkspaceOrderInvalidError,
  WorkspaceUnknownSessionError,
} from '@deepseek-ai/dsh-workspace'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { workspaceView } from './feed.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceUnarchiveSessionRequest,
  WorkspaceValue,
} from './types.ts'

/** Implements Workspace mutations against the authoritative registry. */
export class WorkspaceCommands {
  private operationTail = Promise.resolve()

  /** @param ctx - Host context containing the Workspace registry. */
  constructor(private readonly ctx: Context) {}

  /**
   * Create or resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.enqueue(async () => {
      try {
        const existing = await this.ctx.workspaceRegistry.resolveByPath(request.path)
        if (existing !== undefined) {
          return { workspace: workspaceView(existing), created: false }
        }
        const workspace = await this.ctx.workspaceRegistry.create(request.path)
        return { workspace: workspaceView(workspace), created: true }
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError(
          'workspace/invalid-path',
          `cannot create a Workspace at "${request.path}": ${errorMessage(error)}`,
          { path: request.path },
          { cause: error },
        )
      }
    })
  }

  /**
   * Rename one Workspace after serializing title ownership checks.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    const title = request.title.trim()
    if (title === '') {
      return Promise.reject(new RemoteError('gateway/bad-request', 'Workspace rename requires a non-blank title', {}))
    }
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      if (title !== workspace.title) {
        if (this.ctx.workspaceRegistry.list().some(candidate =>
          candidate.id !== workspace.id && candidate.title === title)) {
          throw new RemoteError(
            'workspace/name-conflict',
            `Workspace name '${title}' is already in use`,
            { name: title },
          )
        }
        await workspace.setTitle(title)
      }
      return { workspace: workspaceView(workspace) }
    })
  }

  /**
   * Delete one Workspace registration without deleting its directory or Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.enqueue(async () => {
      if (!await this.ctx.workspaceRegistry.delete(WorkspaceId(request.workspaceId))) {
        throw workspaceNotFound(request.workspaceId)
      }
      return { deleted: true }
    })
  }

  /**
   * Move one Workspace within the durable registry order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  async insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    try {
      const workspaceIds = await this.ctx.workspaceRegistry.insertBefore(
        WorkspaceId(request.workspaceId),
        request.beforeWorkspaceId === undefined
          ? undefined
          : WorkspaceId(request.beforeWorkspaceId),
      )
      return { workspaceIds: [...workspaceIds] }
    } catch (error) {
      if (!(error instanceof WorkspaceOrderInvalidError)) throw error
      throw workspaceNotFound(error.workspaceId)
    }
  }

  /**
   * Move one accounted Session within a Workspace's manual order.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  async insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    const workspace = this.requireWorkspace(request.workspaceId)
    try {
      await workspace.insertSessionBefore(request.sessionId, request.beforeSessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceMoveInvalidError)) throw error
      throw new RemoteError(
        'workspace/move-invalid',
        error.message,
        {
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...request.beforeSessionId === undefined
            ? {}
            : { beforeSessionId: request.beforeSessionId },
        },
        { cause: error },
      )
    }
    return { workspace: workspaceView(workspace) }
  }

  /**
   * Add one known Session to the registry-global archive set.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  async archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    try {
      await this.ctx.workspaceRegistry.archiveSession(request.sessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceUnknownSessionError)) throw error
      throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId }, { cause: error })
    }
    return { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] }
  }

  /**
   * Drop one Session from the registry-global archive set. An id that is not
   * archived is not an error: the call is idempotent, so a lost race with
   * another surface resolves as a no-op.
   * @param request - Session identity to unarchive.
   * @returns the complete resulting archive set.
   */
  async unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    await this.ctx.workspaceRegistry.unarchiveSession(request.sessionId)
    return { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] }
  }

  /**
   * Append one existing directory as an additional Workspace folder.
   * @param workspaceId - owning Workspace.
   * @param path - existing directory to add.
   * @returns the updated Workspace projection.
   */
  async addFolder(workspaceId: WorkspaceId, path: string): Promise<WorkspaceValue> {
    const workspace = this.requireWorkspace(workspaceId)
    const owner = await this.ctx.workspaceRegistry.resolveByPath(path).catch(() => undefined)
    if (owner !== undefined && owner.id !== workspace.id) {
      throw new RemoteError(
        'workspace/folder-conflict',
        `path "${path}" is already a folder of workspace "${owner.id}"`,
        { path, workspaceId: owner.id },
      )
    }
    try {
      await workspace.addFolder(path)
    } catch (error) {
      throw new RemoteError(
        'workspace/invalid-path',
        `cannot add folder "${path}" to workspace "${workspaceId}": ${errorMessage(error)}`,
        { path },
        { cause: error },
      )
    }
    return { workspace: workspaceView(workspace) }
  }

  /**
   * Remove one additional Workspace folder.
   * @param workspaceId - owning Workspace.
   * @param path - additional folder to drop.
   * @returns the updated Workspace projection.
   */
  async removeFolder(workspaceId: WorkspaceId, path: string): Promise<WorkspaceValue> {
    const workspace = this.requireWorkspace(workspaceId)
    try {
      await workspace.removeFolder(path)
    } catch (error) {
      throw new RemoteError(
        'workspace/invalid-path',
        `cannot remove folder "${path}" from workspace "${workspaceId}": ${errorMessage(error)}`,
        { path },
        { cause: error },
      )
    }
    return { workspace: workspaceView(workspace) }
  }

  /**
   * Hide one registered Workspace from grouping surfaces.
   * @param workspaceId - Workspace to hide.
   * @returns the complete resulting hidden set.
   */
  async hide(workspaceId: WorkspaceId): Promise<{ hiddenWorkspaceIds: readonly WorkspaceId[] }> {
    if (!await this.ctx.workspaceRegistry.hide(WorkspaceId(workspaceId))) {
      throw workspaceNotFound(workspaceId)
    }
    return { hiddenWorkspaceIds: [...this.ctx.workspaceRegistry.hiddenWorkspaceIds] }
  }

  /**
   * Show one registered Workspace in grouping surfaces.
   * @param workspaceId - Workspace to show.
   * @returns the complete resulting hidden set.
   */
  async show(workspaceId: WorkspaceId): Promise<{ hiddenWorkspaceIds: readonly WorkspaceId[] }> {
    if (!await this.ctx.workspaceRegistry.show(WorkspaceId(workspaceId))) {
      throw workspaceNotFound(workspaceId)
    }
    return { hiddenWorkspaceIds: [...this.ctx.workspaceRegistry.hiddenWorkspaceIds] }
  }

  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) throw workspaceNotFound(workspaceId)
    return workspace
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function workspaceNotFound(workspaceId: WorkspaceId): RemoteError<'workspace/not-found'> {
  return new RemoteError(
    'workspace/not-found',
    `Workspace "${workspaceId}" not found`,
    { workspaceId },
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Canonical No Repo directory under the Harness home; created if missing. */
export async function ensureNoRepoDirectory(): Promise<string> {
  const path = dshHomePath('no-repo')
  await mkdir(path, { recursive: true })
  return await realpath(path)
}

/**
 * Register $DSH_HOME/no-repo as the No Repo workspace when that path is unowned.
 * @param ctx - Host context whose workspace registry is already active.
 * @returns the canonical No Repo directory.
 */
export async function ensureNoRepoWorkspace(ctx: Context): Promise<string> {
  const canonical = await ensureNoRepoDirectory()
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return canonical
  if (await registry.resolveByPath(canonical) === undefined) {
    await registry.create(canonical, 'No Repo')
  }
  return canonical
}
