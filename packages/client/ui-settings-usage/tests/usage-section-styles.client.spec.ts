/**
 * jsdom has no layout, so the wrapping and heatmap-fit contracts are pinned
 * as CSS declarations the five-column metrics and 52-week grid depend on.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/UsageSection.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('UsageSection.module.css', () => {
  it('keeps compact metric magnitudes on one line', () => {
    expect(declarations('.metricValue')?.get('white-space')).toBe('nowrap')
    expect(declarations('.metricValue')?.get('margin')).toBe('0')
    expect(declarations('.metric')?.get('margin')).toBe('0')
  })

  it('paints idle heatmap cells with overlay fill and fits 52 weeks in the card', () => {
    expect(declarations('.heatCell')?.get('background')).toBe('var(--dsw-alias-bg-overlay)')
    expect(declarations('.heatmap')?.get('grid-template-columns')).toBe('repeat(52, minmax(0, 1fr))')
    expect(declarations('.heatmap')?.get('width')).toBe('100%')
    expect(declarations('.heatmap')?.get('grid-auto-columns')).toBeUndefined()
    expect(css).not.toContain('grid-auto-columns: 10px')
    expect(declarations('.heatCell')?.get('background')).not.toBe('var(--dsw-alias-bg-layer-2)')
  })
})
