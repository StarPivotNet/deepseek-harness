// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageSection } from '../src/client/UsageSection.tsx'
import type { UsageSectionInjected, UsageSectionProps } from '../src/client/UsageSection.tsx'
import { zh, type UsageSettingsKey } from '../src/client/locales.ts'
import type { UsageOverviewValue } from '@deepseek-ai/dsh-api-remotes/client'

afterEach(cleanup)

const t = ((key: UsageSettingsKey, params?: Record<string, string | number>): string => {
  const template = zh[key]
  if (params === undefined) return template
  return Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template)
}) as UsageSectionProps['t']

function props(load: UsageSectionInjected['load']): UsageSectionProps {
  return { t, load } as UsageSectionProps
}

function metricText(label: string): string | null {
  return screen.getByText(label).parentElement?.querySelector('dd')?.textContent ?? null
}

const OVERVIEW: UsageOverviewValue = {
  tokens: 5_940_000_000,
  peakTokens: 260_000_000,
  durationMs: 5_000,
  peakDurationMs: (5 * 60 + 5) * 60_000,
  currentStreakDays: 34,
  longestStreakDays: 34,
  firstActivityAt: Date.parse('2026-03-04T00:00:00.000Z'),
  lastActivityAt: Date.parse('2026-03-05T00:00:00.000Z'),
  days: [
    { day: '2026-03-04', tokens: 10, durationMs: 2_000, models: { flash: 10 } },
    { day: '2026-03-05', tokens: 20, durationMs: 3_000, models: { flash: 15, pro: 5 } },
  ],
  models: [
    { model: 'flash', tokens: 25 },
    { model: 'pro', tokens: 5 },
  ],
}

describe('UsageSection', () => {
  it('renders totals, activity heatmap, trend, and model shares', async () => {
    const deferred = Promise.withResolvers<UsageOverviewValue>()
    const load = vi.fn(() => deferred.promise)
    render(<UsageSection {...props(load)} />)
    expect(screen.getByText(zh.loading)).toBeTruthy()
    await act(async () => { deferred.resolve(OVERVIEW) })
    expect(load).toHaveBeenCalledOnce()
    expect(screen.getByText(zh.metricTokens)).toBeTruthy()
    expect(metricText(zh.metricTokens)).toBe('59.4亿')
    expect(metricText(zh.metricPeakTokens)).toBe('2.6亿')
    expect(metricText(zh.metricLongestChat)).toBe('5小时5分')
    expect(metricText(zh.metricCurrentStreak)).toBe('34 天')
    expect(metricText(zh.metricLongestStreak)).toBe('34 天')
    expect(document.querySelectorAll('[data-level]')).toHaveLength(364)
    expect(screen.getByText(zh.activity)).toBeTruthy()
    expect(screen.getByText(zh.trend)).toBeTruthy()
    expect(screen.getByText(zh.models)).toBeTruthy()
    expect(screen.getAllByText('flash').length).toBeGreaterThan(0)
    expect(screen.getAllByText('pro').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: zh.activityWeekly }))
    fireEvent.click(screen.getByRole('button', { name: zh.activityCumulative }))
    fireEvent.click(screen.getByRole('button', { name: zh.range30 }))
    fireEvent.click(screen.getByRole('button', { name: zh.activityDaily }))
    fireEvent.click(screen.getByRole('button', { name: zh.range7 }))
    expect(screen.getByRole('button', { name: zh.range30 })).toBeTruthy()
  })

  it('shows a generic failure and retries into the empty state', async () => {
    const load = vi.fn<UsageSectionInjected['load']>()
      .mockRejectedValueOnce(new Error('private transport detail'))
      .mockResolvedValueOnce({
        tokens: 0, peakTokens: 0, durationMs: 0, peakDurationMs: 0,
        currentStreakDays: 0, longestStreakDays: 0,
        firstActivityAt: null, lastActivityAt: null, days: [], models: [],
      })
    render(<UsageSection {...props(load)} />)
    expect((await screen.findByRole('alert')).textContent).toBe(zh.error)
    expect(screen.queryByText('private transport detail')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    expect(await screen.findByText(zh.empty)).toBeTruthy()
  })

  it('does not commit a late load after unmount', async () => {
    const deferred = Promise.withResolvers<UsageOverviewValue>()
    const load = vi.fn(() => deferred.promise)
    const view = render(<UsageSection {...props(load)} />)
    view.unmount()
    await act(async () => { deferred.resolve(OVERVIEW) })
    expect(screen.queryByText(zh.metricTokens)).toBeNull()
  })

  it('does not commit a late failure after unmount', async () => {
    const deferred = Promise.withResolvers<UsageOverviewValue>()
    const load = vi.fn(() => deferred.promise)
    const view = render(<UsageSection {...props(load)} />)
    view.unmount()
    await act(async () => { deferred.reject(new Error('gone')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
