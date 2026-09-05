import { describe, expect, it } from 'vitest'
import { ProductUpdateSettingsSchema } from '../src/update-settings.ts'

describe('ProductUpdateSettingsSchema', () => {
  it('leaves an empty document empty', () => {
    expect(ProductUpdateSettingsSchema({})).toEqual({})
  })

  it('keeps a desktop artifact on lastResult.latest when present', () => {
    const artifact = {
      name: 'DeepSeek Harness-1.2.4-win.zip',
      url: 'https://github.com/StarPivotNet/deepseek-harness/releases/download/desktop-v1.2.4/DeepSeek%20Harness-1.2.4-win.zip',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      size: 12,
      platform: 'win32' as const,
    }
    expect(ProductUpdateSettingsSchema({
      lastResult: {
        available: true,
        currentVersion: '1.2.3',
        latest: {
          tag: 'desktop-v1.2.4',
          version: '1.2.4',
          url: 'https://github.com/StarPivotNet/deepseek-harness/releases/tag/desktop-v1.2.4',
          notes: '',
          artifact,
        },
        checkedAt: 1,
        channel: 'desktop',
      },
    })).toMatchObject({ lastResult: { latest: { artifact } } })
  })

  it('keeps lastResult.latest omitted when absent', () => {
    expect(ProductUpdateSettingsSchema({
      lastResult: {
        available: false,
        currentVersion: '1.2.3',
        checkedAt: 1,
        channel: 'dsh',
      },
    })).toEqual({
      lastResult: {
        available: false,
        currentVersion: '1.2.3',
        checkedAt: 1,
        channel: 'dsh',
      },
    })
  })
})
