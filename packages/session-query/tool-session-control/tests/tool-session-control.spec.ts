import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SessionControl from '@deepseek-ai/dsh-session-control'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolSessionControl from '@deepseek-ai/dsh-tool-session-control'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

class TestSessionQueryEngine extends SessionQueryEngine {
  override searchSessions(
    ..._args: Parameters<SessionQueryEngine['searchSessions']>
  ): ReturnType<SessionQueryEngine['searchSessions']> {
    return Promise.resolve({ items: [] })
  }

  override searchEvents(
    request: Parameters<SessionQueryEngine['searchEvents']>[0],
  ): ReturnType<SessionQueryEngine['searchEvents']> {
    return this.readSurface(request.sessionId).then(surface => ({
      session: surface.session,
      items: [],
    }))
  }
}

async function directoryHarness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TestSessionQueryEngine)
  await ctx.plugin(SessionControl)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ToolSessionControl)
  return ctx
}

async function titleHarness(): Promise<Context> {
  const ctx = await directoryHarness()
  await ctx.plugin(SessionTitle, {
    fallbackMaxWords: 5,
    fallbackMaxBytes: 40,
    maxTitleBytes: 80,
  })
  return ctx
}

async function harness(): Promise<Context> {
  const ctx = await directoryHarness()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(SessionTitle, {
    fallbackMaxWords: 5,
    fallbackMaxBytes: 40,
    maxTitleBytes: 80,
  })
  await ctx.plugin(WorkspaceRegistry)
  return ctx
}

let calls = 0
function callTool(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('call-' + String(++calls)),
    name,
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function idleAgent(session: ReturnType<Context['sessions']['create']>): Agent {
  return {
    id: session.id,
    session,
    status: 'idle',
    cancel: vi.fn(),
    followup: vi.fn(),
    steer: vi.fn(),
  } as unknown as Agent
}

const tempDirs: string[] = []
const previousDshHome = process.env.DSH_HOME

async function makeRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-tool-session-control-')))
  tempDirs.push(root)
  return root
}

async function makeDir(name: string): Promise<string> {
  const dir = join(await makeRoot(), name)
  await mkdir(dir)
  return dir
}

afterEach(async () => {
  if (previousDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousDshHome
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('dsh-tool-session-control', () => {
  it('registers directory tools without a workspace registry', async () => {
    const ctx = await directoryHarness()
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'session_control_search',
      'session_control_send',
      'session_control_stop',
    ])
    await ctx.fiber.dispose()
  })

  it('registers rename once sessionTitle is present', async () => {
    const ctx = await titleHarness()
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'session_control_rename',
      'session_control_search',
      'session_control_send',
      'session_control_stop',
    ])
    await ctx.fiber.dispose()
  })

  it('registers library tools once workspaceRegistry is present', async () => {
    const ctx = await harness()
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'session_control_archive',
      'session_control_rehome',
      'session_control_rename',
      'session_control_reorder',
      'session_control_search',
      'session_control_send',
      'session_control_stop',
      'session_control_unarchive',
      'session_control_workspaces',
    ])
    expect(ctx.tools.get('session_control_search')?.isConcurrencySafe?.({})).toBe(true)
    expect(ctx.tools.get('session_control_workspaces')?.isConcurrencySafe?.({})).toBe(true)
    await ctx.fiber.dispose()
  })

  it('searches, stops, and sends through the session-control service', async () => {
    const ctx = await directoryHarness()
    const session = ctx.sessions.create(SessionId('live'))
    session.append('session/title', { title: 'Live work', messageSeqs: [], source: { kind: 'user' } })
    const agent = idleAgent(session)
    ctx.agents.register(agent)

    const listed = await callTool(ctx, 'session_control_search', { query: 'Live' })
    expect(listed.isError).toBe(false)
    expect(text(listed)).toContain('live idle Live work')

    const stopped = await callTool(ctx, 'session_control_stop', { session_id: 'live' })
    expect(stopped.isError).toBe(false)
    expect(text(stopped)).toBe('stop requested for session live')
    expect(agent.cancel).toHaveBeenCalled()

    const sent = await callTool(ctx, 'session_control_send', {
      session_id: 'live',
      message: 'hello',
      mode: 'queue',
    })
    expect(sent.isError).toBe(false)
    expect(text(sent)).toBe('message queued for session live')
    expect(agent.followup).toHaveBeenCalled()

    ctx.sessions.create(SessionId('child'), {
      meta: {
        cwd: '/tmp/child',
        parentSession: SessionId('live'),
        origin: 'subagent',
      },
    })
    const empty = await callTool(ctx, 'session_control_search', { query: 'zzz-no-match' })
    expect(text(empty)).toBe('No matching sessions.')
    const child = await callTool(ctx, 'session_control_search', { query: 'child' })
    expect(text(child)).toContain('cwd=/tmp/child')
    expect(text(child)).toContain('parent=live')
    expect(text(child)).toContain('origin=subagent')

    const detached = await callTool(ctx, 'session_control_stop', { session_id: 'child' })
    expect(detached.isError).toBe(false)
    expect(text(detached)).toContain('has no live driver')

    const badLimit = await callTool(ctx, 'session_control_search', { limit: 0 })
    expect(badLimit.isError).toBe(true)
    expect(text(badLimit)).toContain('positive safe integer')

    const missingStop = await callTool(ctx, 'session_control_stop', { session_id: 'ghost' })
    expect(missingStop.isError).toBe(true)
    expect(text(missingStop)).toContain('was not found')
    await ctx.fiber.dispose()
  })

  it('renames a live session and pins a user-source title', async () => {
    const ctx = await titleHarness()
    const session = ctx.sessions.create(SessionId('named'))
    const renamed = await callTool(ctx, 'session_control_rename', {
      session_id: 'named',
      title: '  Library tidy  ',
    })
    expect(renamed.isError).toBe(false)
    expect(renamed.value).toMatchObject({ sessionId: 'named', title: 'Library tidy' })
    const event = session.snapshotEvents().findLast(item => item.type === 'session/title')
    expect(event?.data).toMatchObject({ title: 'Library tidy', source: { kind: 'user' } })

    const empty = await callTool(ctx, 'session_control_rename', {
      session_id: 'named',
      title: '   ',
    })
    expect(empty.isError).toBe(true)
    expect(text(empty)).toContain('visible characters')

    ctx.sessions.create(SessionId('child'), {
      meta: { parentSession: SessionId('named'), origin: 'subagent' },
    })
    const child = await callTool(ctx, 'session_control_rename', {
      session_id: 'child',
      title: 'Child',
    })
    expect(child.isError).toBe(true)
    expect(text(child)).toContain('owned by subagent routing')

    const cold = await callTool(ctx, 'session_control_rename', {
      session_id: 'ghost',
      title: 'Gone',
    })
    expect(cold.isError).toBe(true)
    expect(text(cold)).toContain('Host session.rename is required')
    await ctx.fiber.dispose()
  })

  it('renames through Host when apiProxy is present', async () => {
    const ctx = await titleHarness()
    const rename = vi.fn(async (request: { payload: { sessionId: string; title: string } }) => ({
      rpcId: 'rpc',
      result: {
        ok: true as const,
        value: { title: request.payload.title.trim(), seq: 9 },
      },
    }))
    ctx.provide('apiProxy', { sessions: { rename } } as never)
    const result = await callTool(ctx, 'session_control_rename', {
      session_id: 'moved',
      title: 'Host title',
    })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ sessionId: 'moved', title: 'Host title', seq: 9 })
    expect(rename).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('surfaces a Host rename RPC error', async () => {
    const ctx = await titleHarness()
    ctx.provide('apiProxy', {
      sessions: {
        rename: async () => ({
          rpcId: 'rpc',
          result: { ok: false as const, error: { message: 'title-invalid: empty' } },
        }),
      },
    } as never)
    const failed = await callTool(ctx, 'session_control_rename', {
      session_id: 'moved',
      title: '   ',
    })
    expect(failed.isError).toBe(true)
    expect(text(failed)).toContain('title-invalid')
    await ctx.fiber.dispose()
  })

  it('surfaces a missing-session send as an errored tool result', async () => {
    const ctx = await directoryHarness()
    const result = await callTool(ctx, 'session_control_send', {
      session_id: 'missing',
      message: 'hello',
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('session "missing" was not found')
    await ctx.fiber.dispose()
  })

  it('lists workspaces without archived members and archives then unarchives', async () => {
    const ctx = await harness()
    const dir = await makeDir('alpha')
    const workspace = await ctx.workspaceRegistry.create(dir, 'Alpha')
    const session = ctx.sessions.create(SessionId('kept'), { meta: { cwd: dir } })
    await workspace.attachSession(session.id)

    const listed = await callTool(ctx, 'session_control_workspaces', {})
    expect(listed.isError).toBe(false)
    expect(listed.value).toMatchObject({
      workspaces: [{
        workspaceId: workspace.id,
        title: 'Alpha',
        path: workspace.path,
        hidden: false,
        sessionIds: ['kept'],
      }],
    })

    const archived = await callTool(ctx, 'session_control_archive', { session_id: 'kept' })
    expect(archived.isError).toBe(false)
    expect(archived.value).toEqual({ sessionId: 'kept', archived: true })
    expect(ctx.workspaceRegistry.archivedSessionIds).toEqual(['kept'])
    expect((await callTool(ctx, 'session_control_workspaces', {})).value).toMatchObject({
      workspaces: [{ sessionIds: [] }],
    })

    const again = await callTool(ctx, 'session_control_archive', { session_id: 'kept' })
    expect(again.isError).toBe(false)

    const all = await callTool(ctx, 'session_control_search', { query: 'kept' })
    expect(text(all)).toContain('kept')
    expect(text(all)).toContain('archived')
    expect(text(await callTool(ctx, 'session_control_search', { archive: 'only' }))).toContain('archived')
    expect(text(await callTool(ctx, 'session_control_search', { archive: 'exclude' }))).toBe('No matching sessions.')

    const unarchived = await callTool(ctx, 'session_control_unarchive', { session_id: 'kept' })
    expect(unarchived.isError).toBe(false)
    expect(unarchived.value).toEqual({ sessionId: 'kept', archived: false })
    expect(ctx.workspaceRegistry.archivedSessionIds).toEqual([])

    const missing = await callTool(ctx, 'session_control_unarchive', { session_id: 'ghost' })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain("unknown session 'ghost'")
    await ctx.fiber.dispose()
  })

  it('rehomes a live session through Host when apiProxy is present', async () => {
    const ctx = await harness()
    const rehome = vi.fn(async (request: { payload: { sessionId: string; path: string } }) => ({
      rpcId: 'rpc',
      result: {
        ok: true as const,
        value: { workspaceId: 'ws-host', path: request.payload.path, cwd: request.payload.path },
      },
    }))
    ctx.provide('apiProxy', { sessions: { rehome } } as never)
    const dir = await makeDir('beta')

    const result = await callTool(ctx, 'session_control_rehome', {
      session_id: 'moved',
      path: dir,
    })
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({
      sessionId: 'moved',
      workspaceId: 'ws-host',
      path: dir,
      cwd: dir,
    })
    expect(rehome).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('refuses No Repo rehome and live-only fallback when Host is absent', async () => {
    process.env.DSH_HOME = await makeRoot()
    const ctx = await harness()
    const noRepoPath = dshHomePath('no-repo')
    await mkdir(noRepoPath, { recursive: true })
    const noRepo = await callTool(ctx, 'session_control_rehome', {
      session_id: 'cold',
      path: noRepoPath,
    })
    expect(noRepo.isError).toBe(true)
    expect(text(noRepo)).toContain('No Repo')

    const cold = await callTool(ctx, 'session_control_rehome', {
      session_id: 'cold',
      path: await makeDir('gamma'),
    })
    expect(cold.isError).toBe(true)
    expect(text(cold)).toContain('Host session.rehome is required')
    await ctx.fiber.dispose()
  })

  it('reorders an accounted session and rejects an ungrouped one', async () => {
    const ctx = await harness()
    const dir = await makeDir('delta')
    const workspace = await ctx.workspaceRegistry.create(dir)
    const first = ctx.sessions.create(SessionId('first'), { meta: { cwd: dir } })
    const second = ctx.sessions.create(SessionId('second'), { meta: { cwd: dir } })
    await workspace.attachSession(first.id)
    await workspace.attachSession(second.id)
    expect(workspace.sessionIds).toEqual(['second', 'first'])

    const moved = await callTool(ctx, 'session_control_reorder', {
      session_id: 'first',
      before_session_id: 'second',
    })
    expect(moved.isError).toBe(false)
    expect(moved.value).toEqual({
      sessionId: 'first',
      workspaceId: workspace.id,
      sessionIds: ['first', 'second'],
    })

    ctx.sessions.create(SessionId('loose'))
    const loose = await callTool(ctx, 'session_control_reorder', { session_id: 'loose' })
    expect(loose.isError).toBe(true)
    expect(text(loose)).toContain('ungrouped')

    const appended = await callTool(ctx, 'session_control_reorder', { session_id: 'second' })
    expect(appended.isError).toBe(false)
    expect(appended.value).toEqual({
      sessionId: 'second',
      workspaceId: workspace.id,
      sessionIds: ['first', 'second'],
    })
    await ctx.fiber.dispose()
  })

  it('lists hidden workspaces and an empty registry', async () => {
    const ctx = await harness()
    expect(text(await callTool(ctx, 'session_control_workspaces', {}))).toBe('No registered workspaces.')

    const dir = await makeDir('hidden')
    const workspace = await ctx.workspaceRegistry.create(dir, 'Hidden')
    await ctx.workspaceRegistry.hide(workspace.id)
    const listed = await callTool(ctx, 'session_control_workspaces', {})
    expect(listed.value).toMatchObject({
      workspaces: [{ workspaceId: workspace.id, hidden: true, title: 'Hidden' }],
    })
    expect(text(listed)).toContain('hidden Hidden')
    await ctx.fiber.dispose()
  })

  it('rehomes a live session without Host and rejects a missing or non-directory path', async () => {
    const ctx = await harness()
    const oldDir = await makeDir('old-home')
    const newDir = await makeDir('new-home')
    const session = ctx.sessions.create(SessionId('walker'), { meta: { cwd: oldDir } })
    const origin = await ctx.workspaceRegistry.create(oldDir)
    await origin.attachSession(session.id)

    const moved = await callTool(ctx, 'session_control_rehome', {
      session_id: 'walker',
      path: newDir,
    })
    expect(moved.isError).toBe(false)
    expect(moved.value).toMatchObject({ sessionId: 'walker', path: newDir, cwd: newDir })
    expect(origin.sessionIds).not.toContain('walker')
    expect(ctx.workspaceRegistry.list().some(workspace => workspace.sessionIds.includes(session.id))).toBe(true)
    expect(session.snapshotEvents().some(event => event.type === 'workspace/home')).toBe(true)

    const missing = await callTool(ctx, 'session_control_rehome', {
      session_id: 'walker',
      path: join(newDir, 'nope'),
    })
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('path does not resolve')

    const file = join(newDir, 'file')
    await writeFile(file, 'x')
    const notDir = await callTool(ctx, 'session_control_rehome', {
      session_id: 'walker',
      path: file,
    })
    expect(notDir.isError).toBe(true)
    expect(text(notDir)).toContain('path is not a directory')
    await ctx.fiber.dispose()
  })

  it('refuses a live subagent session on the Host-absent rehome fallback', async () => {
    const ctx = await harness()
    const dir = await makeDir('child-home')
    ctx.sessions.create(SessionId('child'), {
      meta: {
        cwd: dir,
        parentSession: SessionId('parent'),
        origin: 'subagent',
      },
    })
    const refused = await callTool(ctx, 'session_control_rehome', {
      session_id: 'child',
      path: dir,
    })
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain('owned by subagent routing')
    expect(ctx.workspaceRegistry.list().some(workspace => workspace.sessionIds.includes(SessionId('child')))).toBe(false)
    await ctx.fiber.dispose()
  })

  it('falls back to live rehome when Host is present without a rehome RPC', async () => {
    process.env.DSH_HOME = await makeRoot()
    const ctx = await harness()
    ctx.provide('apiProxy', { sessions: {} } as never)
    const dir = await makeDir('plain-host')
    const session = ctx.sessions.create(SessionId('plain'), { meta: { cwd: dir } })
    const result = await callTool(ctx, 'session_control_rehome', {
      session_id: 'plain',
      path: dir,
    })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ sessionId: 'plain', path: dir })
    expect(session.snapshotEvents().some(event => event.type === 'workspace/home')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('surfaces a Host rehome failure and archives an unknown session as an error', async () => {
    const ctx = await harness()
    ctx.provide('apiProxy', {
      sessions: {
        rehome: async () => ({ result: { ok: false as const, error: { message: 'denied by host' } } }),
      },
    } as never)
    const denied = await callTool(ctx, 'session_control_rehome', {
      session_id: 'moved',
      path: await makeDir('host-fail'),
    })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('denied by host')

    const unknown = await callTool(ctx, 'session_control_archive', { session_id: 'ghost' })
    expect(unknown.isError).toBe(true)
    expect(text(unknown)).toContain("unknown session 'ghost'")

    const dir = await makeDir('reorder-throw')
    const workspace = await ctx.workspaceRegistry.create(dir)
    const session = ctx.sessions.create(SessionId('thrower'), { meta: { cwd: dir } })
    await workspace.attachSession(session.id)
    vi.spyOn(workspace, 'insertSessionBefore').mockRejectedValue('plain-throw')
    const failed = await callTool(ctx, 'session_control_reorder', { session_id: 'thrower' })
    expect(failed.isError).toBe(true)
    expect(text(failed)).toContain('plain-throw')
    await ctx.fiber.dispose()
  })

  it('unregisters library tools when workspaceRegistry unloads', async () => {
    const ctx = await directoryHarness()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend())
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
    const workspaceFiber = ctx.plugin(WorkspaceRegistry)
    await workspaceFiber
    expect(ctx.tools.schemas().some(schema => schema.name === 'session_control_workspaces')).toBe(true)
    await workspaceFiber.dispose()
    expect(ctx.tools.schemas().map(schema => schema.name).sort()).toEqual([
      'session_control_search',
      'session_control_send',
      'session_control_stop',
    ])
    await ctx.fiber.dispose()
  })
})
