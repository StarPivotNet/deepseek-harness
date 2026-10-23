import { describe, expect, it } from 'vitest'
import { sessionUsageProjectionDefinition } from '../src/usage.ts'
import { aggregateUsage, rebaseUsageDay, zonedDayKey } from '../src/aggregate.ts'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'

type UsageState = ReturnType<typeof sessionUsageProjectionDefinition.init>
function usage(input: number, output: number, extra: Partial<TokenUsage> = {}): TokenUsage {
  return { inputTokens: input, outputTokens: output, ...extra }
}
function apply(state: UsageState, event: unknown): UsageState {
  return sessionUsageProjectionDefinition.apply(state, event as never)
}

describe('sessionUsage remaining folds', () => {
  it('keeps an unchanged request header, ignores non-usage chunks, and closes an unmatched step', () => {
    let state = sessionUsageProjectionDefinition.init()
    state = apply(state, { type: 'request/header', seq: 0, time: 1, data: { header: { config: { provider: 'mock', model: 'a' } }, reason: 'initial' } })
    const same = apply(state, { type: 'request/header', seq: 1, time: 2, data: { header: { config: { provider: 'mock', model: 'a' } }, reason: 'initial' } })
    expect(same).toBe(state)
    state = apply(state, { type: 'step/start', seq: 2, time: 10, data: { turn: 1, step: 1 } })
    expect(apply(state, { type: 'tool/result', seq: 3, time: 11, data: {} })).toBe(state)
    expect(apply(state, { type: 'assistant/message', seq: 4, time: 12, data: { turn: 9, step: 9, message: {} } }).openStep).not.toBeNull()
    const closed = apply(state, { type: 'step/end', seq: 5, time: 13, data: { turn: 1, step: 1 } })
    expect(closed.openStep).toBeNull()
    expect(apply(closed, { type: 'step/end', seq: 6, time: 14, data: { turn: 1, step: 1 } })).toBe(closed)
    expect(apply(closed, { type: 'user/message', seq: 7, time: 15, data: {} })).toBe(closed)
  })

  it('replaces retry usage, records cache buckets, and ignores usage without an open step', () => {
    let state = sessionUsageProjectionDefinition.init()
    state = apply(state, { type: 'request/header', seq: 0, time: 1000, data: { header: { config: { provider: 'mock', model: 'a' } }, reason: 'initial' } })
    state = apply(state, { type: 'step/start', seq: 1, time: 1000, data: { turn: 1, step: 1 } })
    state = apply(state, { type: 'assistant/message', seq: 2, time: 1100, data: { turn: 1, step: 1, message: {}, usage: usage(4, 6, { cacheReadTokens: 1, cacheWriteTokens: 1 }) } })
    expect(sessionUsageProjectionDefinition.wire.view(state).tokens).toBe(12)
    expect(sessionUsageProjectionDefinition.wire.view(state).durationMs).toBe(100)
    const ignored = apply(state, { type: 'llm/retry-started', seq: 3, time: 1200, data: { turn: 9, step: 9 } })
    expect(ignored).toBe(state)
    state = apply(state, { type: 'step/start', seq: 4, time: 1200, data: { turn: 1, step: 2 } })
    state = apply(state, { type: 'assistant/message', seq: 5, time: 1500, data: { turn: 1, step: 2, message: {}, usage: usage(10, 0) } })
    const view = sessionUsageProjectionDefinition.wire.view(state)
    expect(view.tokens).toBe(22)
    expect(view.durationMs).toBe(400)
    expect(apply(state, { type: 'tool/result', seq: 6, time: 1600, data: {} })).toBe(state)
    const same = apply(state, { type: 'assistant/message', seq: 7, time: 1500, data: { turn: 1, step: 1, message: {}, usage: usage(10, 0) } })
    expect(same.tokens).toBe(state.tokens)
  })

  it('keeps totals when a zero-delta usage sample arrives and records duration without a model', () => {
    let state = sessionUsageProjectionDefinition.init()
    state = apply(state, { type: 'step/start', seq: 1, time: 1000, data: { turn: 1, step: 1 } })
    state = apply(state, { type: 'assistant/message', seq: 2, time: 1100, data: { turn: 1, step: 1, message: {}, usage: usage(0, 0) } })
    expect(sessionUsageProjectionDefinition.wire.view(state).tokens).toBe(0)
    expect(sessionUsageProjectionDefinition.wire.view(state).durationMs).toBe(100)
    state = apply(state, { type: 'step/start', seq: 3, time: 1200, data: { turn: 1, step: 2 } })
    state = apply(state, { type: 'assistant/message', seq: 4, time: 1500, data: { turn: 1, step: 2, message: {} } })
    expect(sessionUsageProjectionDefinition.wire.view(state).durationMs).toBe(400)
    expect(sessionUsageProjectionDefinition.wire.view(state).models).toEqual([])
    const retry = apply(state, { type: 'step/start', seq: 4, time: 2000, data: { turn: 2, step: 1 } })
    expect(apply(retry, { type: 'llm/retry-started', seq: 5, time: 2100, data: { turn: 2, step: 1 } })).toBe(retry)
  })

  it('returns the same state when a replacement sample has a zero token delta', () => {
    let state = sessionUsageProjectionDefinition.init()
    state = apply(state, { type: 'request/header', seq: 0, time: 1, data: { header: { config: { provider: 'mock', model: 'a' } }, reason: 'initial' } })
    state = apply(state, { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } })
    state = apply(state, { type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 1, message: {}, usage: usage(5, 5) } })
    state = apply(state, { type: 'step/start', seq: 3, time: 3, data: { turn: 1, step: 2 } })
    const replaced = apply(state, { type: 'assistant/message', seq: 4, time: 4, data: { turn: 1, step: 2, message: {}, usage: usage(0, 0) } })
    expect(replaced.tokens).toBe(10)
  })

  it('sorts models by token count then id and records duration-only days', () => {
    let state = sessionUsageProjectionDefinition.init()
    state = apply(state, { type: 'request/header', seq: 0, time: Date.parse('2026-03-01T00:00:00.000Z'), data: { header: { config: { provider: 'mock', model: 'b' } }, reason: 'initial' } })
    state = apply(state, { type: 'step/start', seq: 1, time: Date.parse('2026-03-01T00:00:00.000Z'), data: { turn: 1, step: 1 } })
    state = apply(state, { type: 'assistant/message', seq: 2, time: Date.parse('2026-03-01T00:00:01.000Z'), data: { turn: 1, step: 1, message: {}, usage: usage(1, 1) } })
    state = apply(state, { type: 'request/header', seq: 3, time: Date.parse('2026-03-02T00:00:00.000Z'), data: { header: { config: { provider: 'mock', model: 'a' } }, reason: 'change' } })
    state = apply(state, { type: 'step/start', seq: 4, time: Date.parse('2026-03-02T00:00:00.000Z'), data: { turn: 2, step: 1 } })
    state = apply(state, { type: 'assistant/message', seq: 5, time: Date.parse('2026-03-02T00:00:01.000Z'), data: { turn: 2, step: 1, message: {}, usage: usage(1, 1) } })
    expect(sessionUsageProjectionDefinition.wire.view(state).models.map(row => row.model)).toEqual(['a', 'b'])
  })
})

describe('usage aggregation remaining paths', () => {
  it('rejects an invalid UTC day and an empty-part time zone', () => {
    expect(() => rebaseUsageDay({ day: 'not-a-day', tokens: 1, durationMs: 0, models: {} }, 'UTC')).toThrow(/invalid UTC day/)
    expect(zonedDayKey(0, 'UTC')).toBe('1970-01-01')
  })

  it('merges overlapping local days and zeros a broken streak', () => {
    const overview = aggregateUsage([
      {
        tokens: 3, peakTokens: 3, durationMs: 10, peakDurationMs: 10,
        firstActivityAt: 1, lastActivityAt: 2,
        days: [
          { day: '2026-03-01', tokens: 1, durationMs: 4, models: { a: 1 } },
          { day: '2026-03-01', tokens: 2, durationMs: 6, models: { a: 2, b: 0 } },
        ],
        models: [{ model: 'a', tokens: 3 }],
      },
    ], 'UTC', Date.parse('2026-03-10T00:00:00.000Z'))
    expect(overview.currentStreakDays).toBe(0)
    expect(overview.days[0]?.tokens).toBe(3)
  })

  it('sorts equal-token models by id', () => {
    const overview = aggregateUsage([
      { tokens: 2, peakTokens: 2, durationMs: 0, peakDurationMs: 0, firstActivityAt: 1, lastActivityAt: 1, days: [], models: [{ model: 'b', tokens: 1 }, { model: 'a', tokens: 1 }] },
    ], 'UTC', 1)
    expect(overview.models.map(row => row.model)).toEqual(['a', 'b'])
  })
})
