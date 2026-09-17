// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import {
  donutSegments, formatCompactNumber, formatDuration, heatmapCells, heatmapLevel,
  polyline, shiftDay, trendDays,
} from '../src/client/format.ts'
import type { Translate } from '../src/client/format.ts'

const tZh = ((key, params) => {
  const template = zh[key]
  if (params === undefined) return template
  return Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template)
}) as Translate

const tEn = ((key, params) => {
  const template = en[key]
  if (params === undefined) return template
  return Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template)
}) as Translate

describe('usage formatters', () => {
  it('formats compact Chinese and English magnitudes', () => {
    expect(formatCompactNumber(243_000_000, tZh, true)).toBe('2.4亿')
    expect(formatCompactNumber(12_200, tEn, false)).toBe('12.2K')
  })

  it('formats duration as hours and minutes', () => {
    expect(formatDuration(11 * 3_600_000 + 54 * 60_000, tZh)).toBe('11小时54分')
    expect(formatDuration(90_000, tEn)).toBe('2m')
  })

  it('builds a 364-day heatmap and weekly buckets', () => {
    const cells = heatmapCells([{ day: '2026-03-04', tokens: 10, durationMs: 0, models: {} }], 'weekly', '2026-03-05')
    expect(cells).toHaveLength(364)
    expect(cells.at(-1)?.day).toBe('2026-03-05')
    const week = cells.find(cell => cell.day === '2026-03-04')
    expect(week?.tokens).toBe(10)
  })

  it('maps heatmap intensity without rounding an empty day up', () => {
    expect(heatmapLevel(0, 100)).toBe(0)
    expect(heatmapLevel(10, 100)).toBe(1)
    expect(heatmapLevel(100, 100)).toBe(4)
  })

  it('fills a 7-day trend window and ranks donut percents', () => {
    const days = trendDays([{ day: '2026-03-05', tokens: 8, durationMs: 0, models: { a: 8 } }], 7, '2026-03-05')
    expect(days).toHaveLength(7)
    expect(days[0]?.day).toBe(shiftDay('2026-03-05', -6))
    expect(donutSegments([{ model: 'a', tokens: 75 }, { model: 'b', tokens: 25 }]).map(row => row.percent)).toEqual([75, 25])
  })

  it('projects a polyline across the chart width', () => {
    expect(polyline([0, 10], 100, 10)).toBe('0.00,10.00 100.00,0.00')
  })

  it('covers compact-number and heatmap remaining buckets', () => {
    expect(formatCompactNumber(12, tEn)).toBe('12')
    expect(formatCompactNumber(1_200_000, tEn)).toBe('1.2M')
    expect(formatCompactNumber(12_000, tZh, true)).toBe('1.2万')
    expect(heatmapLevel(40, 100)).toBe(2)
    expect(heatmapLevel(70, 100)).toBe(3)
    const cumulative = heatmapCells([{ day: '2026-03-05', tokens: 4, durationMs: 0, models: {} }], 'cumulative', '2026-03-05')
    expect(cumulative.at(-1)?.tokens).toBe(4)
    expect(polyline([], 10, 10)).toBe('')
    expect(polyline([5], 10, 10)).toBe('5.00,0.00')
    expect(donutSegments([])).toEqual([])
  })
})
