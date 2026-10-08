/** Library writes go through settings.replace. */

import { describe, expect, it, vi } from 'vitest'
import type { ClientRemote, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { messageOf, parseToolList, refreshIfLoaded, slugFromName, SubagentsStore } from '../src/client/store.ts'

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value }
}

function view(section: { definitions: unknown[] }, revision = 1): SettingsNamespaceView {
  return {
    ns: 'user-subagents',
    schema: {},
    value: section as SettingsNamespaceView['value'],
    applies: 'live',
    autoGenerate: false,
    secrets: [],
    revision,
  }
}

function api(initial: { definitions?: unknown[] } = {}): {
  settings: Pick<ClientRemote, 'settings'>['settings']
  replace: ReturnType<typeof vi.fn>
} {
  let current = view({ definitions: initial.definitions ?? [] })
  const replace = vi.fn(async (_ns: string, section: { definitions: unknown[] }, expectedRevision?: number) => {
    current = view(section, (expectedRevision ?? current.revision) + 1)
    return ok(current)
  })
  return {
    settings: {
      describe: vi.fn(async () => ok({ writable: true, hasDocument: true, namespaces: [current] })),
      replace,
    },
    replace,
  } as unknown as {
    settings: Pick<ClientRemote, 'settings'>['settings']
    replace: ReturnType<typeof vi.fn>
  }
}

describe('messageOf', () => {
  it('stringifies a non-Error rejection', () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf('plain')).toBe('plain')
  })
})

describe('slugFromName', () => {
  it('slugs a display name and avoids collisions', () => {
    expect(slugFromName('Code Reviewer', [])).toBe('code-reviewer')
    expect(slugFromName('Code Reviewer', ['code-reviewer'])).toBe('code-reviewer-2')
    expect(slugFromName('!!!', [])).toBe('agent')
  })
})

describe('parseToolList', () => {
  it('splits a comma list and treats blanks as omitted', () => {
    expect(parseToolList(' read, edit , ')).toEqual(['read', 'edit'])
    expect(parseToolList('  ')).toBeUndefined()
  })
})

describe('SubagentsStore', () => {
  it('loads the library', async () => {
    const wire = api({
      definitions: [{ id: 'reviewer', name: 'Reviewer', description: 'Reviews.', persona: 'Be careful.' }],
    })
    const store = new SubagentsStore(wire)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({
      status: 'ready',
      definitions: [{ id: 'reviewer', name: 'Reviewer', description: 'Reviews.', persona: 'Be careful.' }],
    })
    store.dispose()
    refreshIfLoaded(store)
  })

  it('creates a definition through settings.replace', async () => {
    const wire = api()
    const store = new SubagentsStore(wire)
    await store.load()
    store.beginCreate()
    store.setDraftName('Reviewer')
    store.setDraftDescription('Reviews a change.')
    store.setDraftPersona('You are a reviewer.')
    store.setDraftDeny('edit, write')
    await store.saveDraft()
    expect(wire.replace).toHaveBeenCalledWith(
      'user-subagents',
      {
        definitions: [{
          id: 'reviewer',
          name: 'Reviewer',
          description: 'Reviews a change.',
          persona: 'You are a reviewer.',
          deny: ['edit', 'write'],
        }],
      },
      1,
    )
    expect(store.store.getSnapshot().draft).toBeNull()
  })

  it('refuses an empty draft name or persona', async () => {
    const wire = api()
    const store = new SubagentsStore(wire)
    await store.load()
    store.beginCreate()
    store.setDraftPersona('text')
    await store.saveDraft()
    expect(store.store.getSnapshot().draft?.error).toBe('nameRequired')
    store.setDraftName('Reviewer')
    store.setDraftPersona('')
    await store.saveDraft()
    expect(store.store.getSnapshot().draft?.error).toBe('personaRequired')
    expect(wire.replace).not.toHaveBeenCalled()
  })

  it('edits and deletes a definition', async () => {
    const wire = api({
      definitions: [{ id: 'reviewer', name: 'Reviewer', description: '', persona: 'Be careful.' }],
    })
    const store = new SubagentsStore(wire)
    await store.load()
    store.beginEdit('reviewer')
    store.setDraftName('Voice')
    store.setDraftPersona('Speak plainly.')
    await store.saveDraft()
    expect(wire.replace.mock.calls.at(-1)?.[1].definitions[0]).toMatchObject({
      id: 'reviewer',
      name: 'Voice',
      persona: 'Speak plainly.',
    })
    store.confirmDelete('reviewer')
    await store.remove()
    expect(wire.replace.mock.calls.at(-1)?.[1].definitions).toEqual([])
    store.beginCreate()
    store.cancelDraft()
    expect(store.store.getSnapshot().draft).toBeNull()
  })

  it('loads malformed rows as an empty library and reports describe failures', async () => {
    const wire = api({
      definitions: [
        { id: 1 },
        null,
        { id: 'ok', name: 'Ok', description: 1, persona: 2, allow: ['read', 3], deny: ['edit'] },
      ],
    })
    const store = new SubagentsStore(wire)
    await store.load()
    expect(store.store.getSnapshot().definitions).toEqual([{
      id: 'ok', name: 'Ok', description: '', persona: '', allow: ['read'], deny: ['edit'],
    }])
    wire.settings.describe = vi.fn(async () => ({ rpcId: 'r', result: { ok: false, error: { message: 'down' } } })) as never
    await store.load()
    expect(store.store.getSnapshot().status).toBe('error')
    store.beginCreate()
    await store.saveDraft()
    store.confirmDelete('ok')
    await store.remove()
    store.cancelDraft()
    store.beginEdit('missing')
    expect(store.store.getSnapshot().draft).toBeNull()
    store.setDraftName('x')
    store.setDraftDescription('y')
    store.setDraftPersona('z')
    store.setDraftAllow('a')
    store.setDraftDeny('b')
    expect(store.store.getSnapshot().draft).toBeNull()
  })

  it('refuses writes when the page is read-only or has no draft', async () => {
    const wire = api()
    wire.settings.describe = vi.fn(async () => ok({
      writable: false,
      hasDocument: true,
      namespaces: [view({ definitions: [] })],
    })) as never
    const store = new SubagentsStore(wire)
    await store.load()
    store.beginCreate()
    store.setDraftName('Reviewer')
    store.setDraftPersona('Be careful.')
    await store.saveDraft()
    expect(wire.replace).not.toHaveBeenCalled()
    store.confirmDelete('reviewer')
    await store.remove()
    expect(wire.replace).not.toHaveBeenCalled()
    store.cancelDraft()
    await store.saveDraft()
  })

  it('does not write when the namespace view is gone', async () => {
    const wire = api()
    const store = new SubagentsStore(wire)
    await store.load()
    store.dispose()
    store.beginCreate()
    store.setDraftName('Reviewer')
    store.setDraftPersona('Be careful.')
    await store.saveDraft()
    expect(store.store.getSnapshot().draft?.error).toBe('unavailable')
    expect(wire.replace).not.toHaveBeenCalled()
  })

  it('surfaces a replace failure on the open draft', async () => {
    const wire = api()
    const store = new SubagentsStore(wire)
    await store.load()
    wire.replace.mockRejectedValueOnce(new Error('conflict'))
    store.beginCreate()
    store.setDraftName('Reviewer')
    store.setDraftPersona('Be careful.')
    await store.saveDraft()
    expect(store.store.getSnapshot().draft?.error).toBe('conflict')
    expect(store.store.getSnapshot().error).toBe('conflict')
  })

  it('ignores a late load after dispose', async () => {
    type DescribeValue = { writable: boolean; hasDocument: boolean; namespaces: SettingsNamespaceView[] }
    let release!: (value: ReturnType<typeof ok<DescribeValue>>) => void
    const pending = new Promise<ReturnType<typeof ok<DescribeValue>>>((resolve) => {
      release = resolve
    })
    const wire = api()
    wire.settings.describe = vi.fn(() => pending) as never
    const store = new SubagentsStore(wire)
    const loading = store.load()
    store.dispose()
    release(ok({ writable: true, hasDocument: true, namespaces: [view({ definitions: [] })] }))
    await loading
    expect(store.store.getSnapshot().status).toBe('loading')
    refreshIfLoaded(store)
  })

  it('marks the page unavailable when the namespace is absent', async () => {
    const wire = api()
    wire.settings.describe = vi.fn(async () => ok({ writable: true, hasDocument: true, namespaces: [] })) as never
    const store = new SubagentsStore(wire)
    await store.load()
    expect(store.store.getSnapshot().status).toBe('unavailable')
  })
})
