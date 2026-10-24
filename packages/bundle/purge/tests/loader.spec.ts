import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as purge from '../src/index.ts'
import * as redteamModule from '../../redteam/src/index.ts'
import * as store from '../../redteam/src/store.ts'
import * as ui from '../../redteam/src/ui.ts'

const homes: string[] = []
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  vi.unstubAllEnvs()
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

describe('Purge and red-team runtime loading', () => {
  it('loads the root plugin through Cordis with prompt and tools enabled, without host writes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-purge-loader-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    vi.stubEnv('DSH_SURFACE', 'web')
    context = new Context()
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntime)
    const loader = Object.create(Loader.prototype) as Loader
    const fiber = await context.plugin(loader.unwrapExports(purge) as Parameters<Context['plugin']>[0], { autoApplyOnStart: false })
    expect(context.tools.schemas().map(tool => tool.name)).toEqual(expect.arrayContaining(['purge_status', 'purge_apply', 'purge_revert', 'purge_audit']))
    await fiber.dispose()
    expect(context.tools.get('purge_status')).toBeUndefined()
  })

  it('loads red-team bootstrap and store through the real module paths and closes the store', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-redteam-loader-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    context = new Context()
    const loader = Object.create(Loader.prototype) as Loader
    await context.plugin(loader.unwrapExports(redteamModule) as Parameters<Context['plugin']>[0])
    await context.plugin(loader.unwrapExports(store) as Parameters<Context['plugin']>[0], { root: join(home, 'redteam') })
    const redteam = context.get('redteam') as { root: string } | undefined
    const redteamMode = context.get('redteamMode') as { paths: { presetDir: string } } | undefined
    expect(redteam?.root).toBe(join(home, 'redteam'))
    expect(redteamMode?.paths.presetDir).toContain('redteam')
    const service = redteam
    await context.fiber.dispose()
    context = undefined
    expect(service?.root).toBe(join(home, 'redteam'))
  })

  it('keeps the HTTP bridge loader-compatible', () => {
    expect(ui.inject).toEqual(['redteam', 'webServer'])
    expect(ui.name).toBe('dsh-purge-redteam-ui')
    expect(typeof ui.apply).toBe('function')
  })
})
