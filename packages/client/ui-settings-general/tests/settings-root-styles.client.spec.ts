/** Settings shell trigger hit-target and carrier geometry contracts. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SettingsRoot.module.css', import.meta.url)), 'utf8')

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

describe('SettingsRoot.module.css', () => {
  it('splits the wide account bar into two real buttons without overlay hit targets', () => {
    expect(declarations('.splitTrigger')?.get('display')).toBe('flex')
    expect(declarations('.accountMenu')?.get('flex')).toBe('1')
    expect(declarations('.accountTrigger')?.get('flex')).toBe('1')
    expect(declarations('.accountTrigger')?.get('pointer-events')).toBeUndefined()
    expect(declarations('.settingsTrigger')?.get('width')).toBe('42px')
    expect(declarations('.settingsTrigger')?.get('pointer-events')).toBeUndefined()
    expect(css).not.toContain('pointer-events: none')
    expect(css).not.toContain('.settingsTrigger::after')
  })

  it('keeps the indicator carrier full-width without inspecting account state', () => {
    expect(css).toMatch(/\.triggerRow\s*\{[^}]*width: 100%;[^}]*margin: 4px 0;/)
    expect(css).not.toContain('data-signed-out')
    expect(css).toMatch(/\.triggerRow\.railRow\s*\{[^}]*width: 36px;/)
  })
})
