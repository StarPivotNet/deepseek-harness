/**
 * Pure types of the session-stats domain: the ONE home of the `sessionStats`
 * and `sessionUsage` projection-key declarations, free of this package's
 * host-side value imports (cordis context, zod, the llm chunk predicate).
 * Two namespace projections serve it — `./types` for host consumers,
 * `./client` for client aggregates — with zero content duplication.
 *
 * @module @deepseek-ai/dsh-session-stats/types
 */

import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * One UTC calendar day of session activity folded by {@link SessionUsageProjection}.
 * The Host usage Remote rebases `day` onto the caller's IANA zone.
 */
export interface SessionUsageDay {
  /** UTC calendar day `YYYY-MM-DD` of the contributing events. */
  day: string
  /** Provider-reported tokens recorded on this day. */
  tokens: number
  /** Summed model wall time recorded on this day, milliseconds. */
  durationMs: number
  /** Tokens recorded on this day, keyed by the request-header model id. */
  models: Readonly<Record<string, number>>
}

/** One model id and its whole-log token total. */
export interface SessionUsageModel {
  /** Provider-owned model id from the latest request header covering the usage. */
  model: string
  /** Provider-reported tokens attributed to this model. */
  tokens: number
}

/**
 * Whole-log usage figures for the Settings usage page. Token totals match the
 * four-bucket `tokenUsage` sum; duration matches assembled-message model wall
 * time. Calendar rows stay UTC until the Host Remote rebases them.
 */
export interface SessionUsageProjection {
  /** Summed provider-reported tokens over the whole log. */
  tokens: number
  /** Highest running token total observed while folding the log. */
  peakTokens: number
  /** Summed model wall time over steps that assembled a message, milliseconds. */
  durationMs: number
  /** Highest running duration observed while folding the log, milliseconds. */
  peakDurationMs: number
  /** Earliest contributing event time, or null before the first activity. */
  firstActivityAt: number | null
  /** Latest contributing event time, or null before the first activity. */
  lastActivityAt: number | null
  /** Calendar rows in ascending UTC day order. */
  days: readonly SessionUsageDay[]
  /** Model rows in descending token order, then model id. */
  models: readonly SessionUsageModel[]
}

/**
 * Whole-log conversation figures, independent of how much history a client
 * has paged in. Counts and wall times all fold from the complete durable log;
 * every field is 0 until its first contributing event lands. Field names
 * mirror the client window fold so an assembly without this unit can fall
 * back to it wholesale.
 */
export interface SessionStatsProjection {
  /** Distinct turns carrying at least one closed step (`step/end`); rejected or empty turns are uncounted. */
  turns: number
  /** Closed steps (`step/end` events) — completed, failed, and cancelled steps alike. */
  steps: number
  /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
  llmMs: number
  /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
  toolMs: number
  /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
  decodeMs: number
  /** Summed provider output tokens over the same decode-timed steps. */
  decodeTokens: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Whole-log turn/step counts and wall times; see
     * {@link SessionStatsProjection}. Excluded from Session summary payloads:
     * no list row renders these figures.
     */
    sessionStats: SessionProjectionSummaryExcluded<SessionStatsProjection>
    /** Whole-log tokens, duration, and UTC calendar/model rows; see {@link SessionUsageProjection}. */
    sessionUsage: SessionUsageProjection
  }
}
