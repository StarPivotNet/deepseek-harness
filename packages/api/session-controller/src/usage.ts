/** Host-wide usage Remote for the Settings usage page. */

import type { Context } from '@deepseek-ai/cordis'
import { aggregateUsage, EMPTY_SESSION_USAGE } from '@deepseek-ai/dsh-session-stats'
import type { SessionUsageProjection } from '@deepseek-ai/dsh-session-stats/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { UsageOverviewRequest, UsageOverviewValue } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the usage Remote namespace. */
    sessionUsage: SessionUsageController
  }
}

const OVERVIEW_BATCH_SIZE = 8
/** One Session's observation budget; a hung read degrades to empty usage. */
const OVERVIEW_SESSION_TIMEOUT_MS = 15_000
/** Whole-page budget: past it, remaining Sessions count as empty and the
 * answer returns rather than holding the Settings page open forever. */
const OVERVIEW_TOTAL_BUDGET_MS = 120_000

/** Internal marker that one Session's observation ran past its budget. */
class SessionObservationTimeout extends Error {
  constructor(readonly sessionId: string) {
    super(`usage overview: session ${sessionId} observation timed out`)
  }
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

/** Host service backing `ctx.remote.usage` without activating cold Agents. */
export class SessionUsageController extends TypertRemoteService {
  static inject = ['sessionQuery', 'typert']

  /** @param ctx - Host context carrying Session reads and optional projections. */
  constructor(ctx: Context) {
    super(ctx, 'sessionUsage', { namespace: 'usage' })
  }

  /**
   * Sum every visible Session's usage onto the caller calendar.
   * @param request - caller IANA zone used to rebase UTC calendar rows.
   * @param signal - caller lifetime carried by the Remote transport.
   * @returns Host-wide totals, calendar rows, streaks, and model shares.
   * @throws RemoteError when the time zone is invalid or the caller aborts.
   */
  @Remote
  async overview(request: UsageOverviewRequest, signal: AbortSignal): Promise<UsageOverviewValue> {
    if (!isTimeZone(request.timeZone)) {
      throw new RemoteError('session/invalid-time-zone', 'time zone is not a valid IANA zone', { value: request.timeZone })
    }
    signal.throwIfAborted()
    const records = await this.ctx.sessionQuery.listSessions(signal)
    signal.throwIfAborted()
    const deadline = Date.now() + OVERVIEW_TOTAL_BUDGET_MS
    const views: SessionUsageProjection[] = []
    for (let offset = 0; offset < records.length; offset += OVERVIEW_BATCH_SIZE) {
      const remaining = deadline - Date.now()
      if (records.length - offset > 0 && remaining <= 0) {
        this.ctx.logger.warn(
          'usage: overview budget of %dms ran out with %d of %d Sessions unread; they count as empty',
          OVERVIEW_TOTAL_BUDGET_MS, records.length - offset, records.length,
        )
        break
      }
      const batch = records.slice(offset, offset + OVERVIEW_BATCH_SIZE)
      const perSession = Math.min(OVERVIEW_SESSION_TIMEOUT_MS, Math.max(remaining, 1))
      const settled = await Promise.allSettled(batch.map(record => this.readUsage(record.header.id, signal, perSession)))
      for (const result of settled) {
        if (result.status === 'rejected') throw result.reason
        views.push(result.value)
      }
    }
    return aggregateUsage(views, request.timeZone, Date.now())
  }

  private async readUsage(
    sessionId: Parameters<Context['sessionQuery']['observeSession']>[0],
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<SessionUsageProjection> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        this.observeUsage(sessionId, signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.ctx.logger.warn(
              'usage: session %s observation exceeded %dms; counting it as empty. Its store may hold a locked or pathological log.',
              sessionId, timeoutMs,
            )
            reject(new SessionObservationTimeout(sessionId))
          }, timeoutMs)
          timer.unref?.()
        }),
      ])
    } catch (unreadableSession: unknown) {
      if (timer !== undefined) clearTimeout(timer)
      // Abort must still fail the Remote; every other observation failure
      // (missing, corrupt, unreadable, or hung past its budget) contributes
      // empty usage so one bad Session cannot fail the Host-wide page.
      signal.throwIfAborted()
      void unreadableSession
      return EMPTY_SESSION_USAGE
    }
  }

  private async observeUsage(
    sessionId: Parameters<Context['sessionQuery']['observeSession']>[0],
    signal: AbortSignal,
  ): Promise<SessionUsageProjection> {
    using observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal, projectionMode: 'all' })
    return observation.projections?.values.sessionUsage ?? EMPTY_SESSION_USAGE
  }
}

export default SessionUsageController
