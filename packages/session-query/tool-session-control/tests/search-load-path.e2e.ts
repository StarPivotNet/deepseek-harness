/** Keyless session directory search through a YAML Loader composition. */

import { mkdtemp, readdir, rm, appendFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionControl from '@deepseek-ai/dsh-session-control'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolSessionControl from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  try {
    await context?.fiber.dispose()
  } finally {
    context = undefined
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  }
})

it('returns a recent title match without opening an unrelated broken older log', async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-session-control-loader-'))
  const persistenceRoot = join(root, 'sessions')
  const configPath = join(root, 'cordis.yml')
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-session-query-sqlite', SqliteSessionQueryEngine],
    ['@deepseek-ai/dsh-session-control', SessionControl],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-tool-session-control', ToolSessionControl],
  ])
  await writeFile(configPath, [...modules.keys()].map((name) => {
    const lines = [`- name: '${name}'`]
    if (name === '@deepseek-ai/dsh-session-persistence-jsonl') {
      lines.push('  config:', `    root: ${JSON.stringify(persistenceRoot)}`, '    compression: none')
    }
    if (name === '@deepseek-ai/dsh-session-query-sqlite') {
      lines.push('  config:', `    path: ${JSON.stringify(join(root as string, 'query.db'))}`)
    }
    return lines.join('\n')
  }).join('\n') + '\n')

  const ctx = context = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)).toEqual([])

  const older = SessionId('older-broken')
  const newer = SessionId('newer-match')
  for (const [id, createdAt] of [[older, 10], [newer, 20]] as const) {
    const writer = await ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION, id, createdAt, isSeeded: false,
    })
    await writer.append([{
      type: 'session/title', seq: SessionSeq(0), time: createdAt,
      data: { title: id === newer ? 'Deployment diagnosis' : 'Unrelated work', messageSeqs: [], source: { kind: 'user' } },
    }])
    await writer.close()
  }
  const files = await readdir(persistenceRoot, { recursive: true })
  const olderLog = files.find(file => file.includes(older) && file.endsWith(`session.v${String(SESSION_FORMAT_VERSION)}.jsonl`))
  expect(olderLog).toBeDefined()
  await appendFile(join(persistenceRoot, olderLog as string), '{broken json}\n')
  const opened = vi.spyOn(ctx.sessionPersistence, 'open')

  const result = await ctx.tools.execute({
    signal: new AbortController().signal, callId: ToolCallId('search-title'),
    name: 'session_control_search', arguments: { query: 'diagnosis', limit: 1 },
  })
  expect(result.isError).not.toBe(true)
  const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
  expect(text).toContain('newer-match')
  expect(text).toContain('Deployment diagnosis')
  expect(text).not.toContain('older-broken')
  expect(opened.mock.calls.some(([id]) => id === older)).toBe(false)
  expect(opened.mock.calls.some(([id]) => id === newer)).toBe(true)
})
