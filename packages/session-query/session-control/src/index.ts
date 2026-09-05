/**
 * Trusted in-process session directory. Callers search every logical session
 * with live driver status, stop an attached turn, and deliver a later message
 * to a live Agent.
 *
 * @module @deepseek-ai/dsh-session-control
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRecord, SessionTitleObservationResult } from '@deepseek-ai/dsh-session-query'
import {
  DEFAULT_SEARCH_LIMIT,
  SessionControlError,
  type Config,
} from './config.ts'
import type {
  SessionControlActivity,
  SessionControlArchiveFilter,
  SessionControlDeliveryMode,
  SessionControlEntry,
  SessionControlSearchRequest,
  SessionControlSendReceipt,
  SessionControlSendRequest,
  SessionControlStopReceipt,
} from './types.ts'

export type * from './types.ts'
export type { Config, SessionControlErrorCode } from './config.ts'
export { DEFAULT_SEARCH_LIMIT, SessionControlError } from './config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionControl: SessionControl
  }
}

/** Trusted directory, stop, and delivery operations over the logical session corpus. */
export class SessionControl extends Service {
  static inject = ['sessionQuery', 'agents', 'sessions']

  private readonly searchLimit: number

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'sessionControl')
    this.searchLimit = config.searchLimit ?? DEFAULT_SEARCH_LIMIT
    if (!Number.isSafeInteger(this.searchLimit) || this.searchLimit <= 0) {
      throw new SessionControlError(
        'session-control: searchLimit must be a positive safe integer',
        'SESSION_CONTROL_INVALID_CONFIG',
      )
    }
  }

  /**
   * Search every logical session and attach live driver status.
   * Optional `archive` defaults to `all` and includes archived rows from
   * `ctx.workspaceRegistry` when that service is mounted. The filter runs
   * before `limit`.
   * @param request - optional case-insensitive query, result cap, and archive filter.
   * @param signal - optional cancellation for persistence listing and title reads.
   * @returns matching directory rows in newest-first corpus order.
   */
  async search(
    request: SessionControlSearchRequest = {},
    signal?: AbortSignal,
  ): Promise<SessionControlEntry[]> {
    const limit = request.limit ?? this.searchLimit
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new SessionControlError(
        'search limit must be a positive safe integer',
        'SESSION_CONTROL_INVALID_REQUEST',
      )
    }
    const archive = resolveArchiveFilter(request.archive)
    assertNotCancelled(signal)
    const records = await settleWithCancellation(this.ctx.sessionQuery.listSessions(signal), signal)
    const archivedIds = this.archivedIds()
    const filtered = records.filter(record => matchesArchive(archivedIds.has(record.header.id), archive))
    const needle = request.query?.toLocaleLowerCase() ?? ''
    const matches: SessionControlEntry[] = []
    for (let offset = 0; offset < filtered.length && matches.length < limit;) {
      assertNotCancelled(signal)
      const inspected = filtered.slice(offset, offset + limit - matches.length)
      const observations = await settleWithCancellation(
        this.ctx.sessionQuery.readTitleSnapshots(inspected.map(record => record.header.id), signal),
        signal,
      )
      for (const [index, record] of inspected.entries()) {
        const observation = observations[index] as SessionTitleObservationResult
        const title = observation.status === 'fulfilled'
          ? observation.value.title?.title ?? record.header.id
          : record.header.id
        if (needle === ''
          || record.header.id.toLocaleLowerCase().includes(needle)
          || record.header.cwd?.toLocaleLowerCase().includes(needle) === true
          || title.toLocaleLowerCase().includes(needle)) {
          matches.push(this.toEntry(record, title, archivedIds.has(record.header.id)))
        }
      }
      offset += inspected.length
    }
    return matches
  }

  /**
   * Read one logical session and its live driver status.
   * @param sessionId - live or persisted session id.
   * @param signal - optional cancellation for title observation.
   * @returns the directory row for that identity.
   */
  async get(sessionId: SessionId, signal?: AbortSignal): Promise<SessionControlEntry> {
    const record = await this.findRecord(sessionId, signal)
    if (record === undefined) {
      throw new SessionControlError(
        'session "' + sessionId + '" was not found',
        'SESSION_CONTROL_SESSION_NOT_FOUND',
      )
    }
    const observation = (await settleWithCancellation(
      this.ctx.sessionQuery.readTitleSnapshots([sessionId], signal),
      signal,
    ))[0] as SessionTitleObservationResult
    const title = observation.status === 'fulfilled'
      ? observation.value.title?.title ?? record.header.id
      : record.header.id
    return this.toEntry(record, title, this.archivedIds().has(record.header.id))
  }

  /**
   * Stop the current turn of an attached session and keep pending inbox work.
   * A storage-only identity is an accepted no-op: there is no live driver to
   * cancel, and this call never resumes a cold session.
   * @param sessionId - live or persisted session id.
   * @param signal - optional cancellation for the corpus existence check.
   * @returns whether a live Agent received the cancel signal.
   */
  async stop(sessionId: SessionId, signal?: AbortSignal): Promise<SessionControlStopReceipt> {
    const agent = this.ctx.agents.get(sessionId)
    if (agent !== undefined) {
      agent.cancel({ kind: 'user' }, { keepInbox: true })
      return { accepted: true, attached: true }
    }
    if (this.ctx.sessions.get(sessionId) !== undefined) {
      return { accepted: true, attached: false }
    }
    if (await this.findRecord(sessionId, signal) !== undefined) {
      return { accepted: true, attached: false }
    }
    throw new SessionControlError(
      'session "' + sessionId + '" was not found',
      'SESSION_CONTROL_SESSION_NOT_FOUND',
    )
  }

  /**
   * Deliver one later user-role message to a live Agent. A storage-only
   * identity fails with SESSION_CONTROL_RESUME_REQUIRED; this service does
   * not resume, because resume owns an AgentHandle that the caller or the
   * subagent continuation manager must retain.
   * @param request - target id, text, and inbox placement.
   * @param signal - optional cancellation for the corpus existence check.
   * @returns the accepted message id.
   */
  async send(
    request: SessionControlSendRequest,
    signal?: AbortSignal,
  ): Promise<SessionControlSendReceipt> {
    if (request.message.length === 0) {
      throw new SessionControlError(
        'send request must contain a non-empty message',
        'SESSION_CONTROL_INVALID_REQUEST',
      )
    }
    const mode: SessionControlDeliveryMode = request.mode ?? 'queue'
    const agent = await this.requireLiveAgent(request.sessionId, signal)
    const message = createUserMessage({
      content: [{ type: 'text', text: request.message }],
      source: { kind: 'plugin', plugin: 'session-control' },
    })
    try {
      if (mode === 'steer') agent.steer(message)
      else agent.followup(message)
    } catch (error: unknown) {
      throw new SessionControlError(
        'message was not delivered to session "' + request.sessionId + '": '
          + (error instanceof Error ? error.message : String(error)),
        'SESSION_CONTROL_DELIVERY_FAILED',
        { cause: error },
      )
    }
    return { messageId: message.id }
  }

  private async requireLiveAgent(sessionId: SessionId, signal?: AbortSignal): Promise<Agent> {
    const agent = this.ctx.agents.get(sessionId)
    if (agent !== undefined) return agent
    if (this.ctx.sessions.get(sessionId) !== undefined) {
      throw new SessionControlError(
        'session "' + sessionId + '" is attached without a live Agent',
        'SESSION_CONTROL_NOT_ATTACHED',
      )
    }
    if (await this.findRecord(sessionId, signal) !== undefined) {
      throw new SessionControlError(
        'session "' + sessionId + '" is not live; resume it before sending',
        'SESSION_CONTROL_RESUME_REQUIRED',
      )
    }
    throw new SessionControlError(
      'session "' + sessionId + '" was not found',
      'SESSION_CONTROL_SESSION_NOT_FOUND',
    )
  }

  private async findRecord(sessionId: SessionId, signal?: AbortSignal): Promise<SessionRecord | undefined> {
    assertNotCancelled(signal)
    const records = await settleWithCancellation(
      this.ctx.sessionQuery.filterSessions([{ kind: 'id', values: [sessionId] }], signal),
      signal,
    )
    return records[0]
  }

  private archivedIds(): ReadonlySet<SessionId> {
    const registry = this.ctx.get('workspaceRegistry') as
      | { archivedSessionIds?: readonly SessionId[] }
      | undefined
    return new Set(registry?.archivedSessionIds ?? [])
  }

  private toEntry(record: SessionRecord, title: string, archived: boolean): SessionControlEntry {
    const agent = this.ctx.agents.get(record.header.id)
    const activity: SessionControlActivity = agent === undefined
      ? 'ready'
      : agent.status === 'running' ? 'running' : 'idle'
    return {
      sessionId: record.header.id,
      title,
      ...record.header.cwd === undefined ? {} : { cwd: record.header.cwd },
      ...record.header.parentSession === undefined ? {} : { parentSessionId: record.header.parentSession },
      ...record.header.origin === undefined ? {} : { origin: record.header.origin },
      ...record.header.agentPreset === undefined ? {} : { agentPreset: record.header.agentPreset },
      createdAt: record.header.createdAt,
      activity,
      live: record.live,
      persisted: record.persisted,
      archived,
    }
  }
}

function resolveArchiveFilter(archive: unknown): SessionControlArchiveFilter {
  if (archive === undefined) return 'all'
  if (archive === 'all' || archive === 'only' || archive === 'exclude') return archive
  throw new SessionControlError(
    'search archive must be all, only, or exclude',
    'SESSION_CONTROL_INVALID_REQUEST',
  )
}

function matchesArchive(archived: boolean, archive: SessionControlArchiveFilter): boolean {
  return archive === 'all' || archived === (archive === 'only')
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw cancelled(signal)
}

function settleWithCancellation<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return work
  if (signal.aborted) return Promise.reject(cancelled(signal))
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(cancelled(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) reject(cancelled(signal))
        else resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(signal.aborted ? cancelled(signal) : error)
      },
    )
  })
}

function cancelled(signal: AbortSignal): SessionControlError {
  return new SessionControlError(
    'session-control operation was cancelled',
    'SESSION_CONTROL_CANCELLED',
    { cause: signal.reason },
  )
}

export default SessionControl
