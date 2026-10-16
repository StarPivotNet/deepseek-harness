/** User subagent-definition library over the live volatile Config. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import UserSubagents, {
  compositionFromUserSubagent,
  findUserSubagent,
  USER_SUBAGENTS_SETTINGS_SCHEMA,
  validateUserSubagents,
  type UserSubagentDefinition,
} from '../src/index.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

const REVIEWER = {
  id: 'reviewer',
  name: 'Reviewer',
  description: 'Reviews a change without editing it.',
  persona: 'You are a careful code reviewer.',
  deny: ['edit', 'write'],
}

async function boot(definitions: UserSubagentDefinition[] = []): Promise<{ ctx: Context }> {
  const ctx = new Context()
  await liveConfig(ctx, UserSubagents, { definitions })
  return { ctx }
}

describe('USER_SUBAGENTS_SETTINGS_SCHEMA', () => {
  it('fills omitted description, persona, and filter lists', () => {
    expect(USER_SUBAGENTS_SETTINGS_SCHEMA({
      definitions: [{ id: 'plain', name: 'Plain' } as UserSubagentDefinition],
    }).definitions[0]).toMatchObject({
      id: 'plain', name: 'Plain', description: '', persona: '',
    })
  })
})

describe('validateUserSubagents', () => {
  it('accepts a unique library', () => {
    expect(() => validateUserSubagents({ definitions: [REVIEWER] })).not.toThrow()
  })

  it('rejects a duplicate id', () => {
    expect(() => validateUserSubagents({
      definitions: [REVIEWER, { ...REVIEWER, name: 'Other' }],
    })).toThrow('listed more than once')
  })

  it('rejects an invalid id', () => {
    expect(() => validateUserSubagents({
      definitions: [{ ...REVIEWER, id: '1bad' }],
    })).toThrow('must match')
  })

  it('rejects an empty name', () => {
    expect(() => validateUserSubagents({
      definitions: [{ ...REVIEWER, name: '  ' }],
    })).toThrow('needs a name')
  })

  it('rejects an empty allow or deny name', () => {
    expect(() => validateUserSubagents({
      definitions: [{ ...REVIEWER, allow: [''] }],
    })).toThrow('empty filter name')
    expect(() => validateUserSubagents({
      definitions: [{ id: 'reader', name: 'Reader', description: '', persona: 'x', deny: [''] }],
    })).toThrow('empty filter name')
  })

  it('accepts a non-empty allow list', () => {
    expect(() => validateUserSubagents({
      definitions: [{ ...REVIEWER, allow: ['read'], deny: ['edit'] }],
    })).not.toThrow()
  })
})

describe('findUserSubagent and compositionFromUserSubagent', () => {
  it('returns undefined for a missing id', () => {
    expect(findUserSubagent({ definitions: [REVIEWER] }, 'missing')).toBeUndefined()
  })

  it('omits toolFilter when neither allow nor deny is set', () => {
    expect(compositionFromUserSubagent({
      id: 'plain',
      name: 'Plain',
      description: '',
      persona: 'You are a helper.',
    })).toEqual({ persona: 'You are a helper.' })
  })

  it('preserves a deny-only filter without materializing allow', () => {
    expect(compositionFromUserSubagent(REVIEWER)).toEqual({
      persona: 'You are a careful code reviewer.',
      toolFilter: { deny: ['edit', 'write'] },
    })
  })

  it('preserves an allow-and-deny filter', () => {
    expect(compositionFromUserSubagent({
      id: 'mixed',
      name: 'Mixed',
      description: '',
      persona: 'Mixed.',
      allow: ['read'],
      deny: ['edit'],
    })).toEqual({
      persona: 'Mixed.',
      toolFilter: { allow: ['read'], deny: ['edit'] },
    })
  })

  it('preserves an allow-only filter', () => {
    expect(compositionFromUserSubagent({
      id: 'reader',
      name: 'Reader',
      description: '',
      persona: 'Read only.',
      allow: ['read'],
    })).toEqual({
      persona: 'Read only.',
      toolFilter: { allow: ['read'] },
    })
  })
})

describe('UserSubagents', () => {
  it('returns an empty library until Settings supplies definitions', async () => {
    const { ctx } = await boot()
    expect(ctx.userSubagents.current()).toEqual({ definitions: [] })
    expect(ctx.userSubagents.get('reviewer')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('serves a stored definition through current() and get()', async () => {
    const { ctx } = await boot([REVIEWER])
    expect(ctx.userSubagents.get('reviewer')).toMatchObject(REVIEWER)
    expect(ctx.userSubagents.current().definitions[0]?.deny).toEqual(['edit', 'write'])
    await ctx.fiber.dispose()
  })
})
