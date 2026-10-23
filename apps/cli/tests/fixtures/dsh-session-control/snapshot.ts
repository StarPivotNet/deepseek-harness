import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { unsupportedModel } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'

const overlayPath = process.argv[2]
if (overlayPath === undefined) throw new Error('dsh-session-control snapshot requires an overlay path')
const rootConfigPath = fileURLToPath(new URL('../../../../../packages/bundle/base/tests/fixtures/root.cordis.yml', import.meta.url))
const basePatchPath = fileURLToPath(new URL('../../../../../packages/bundle/base/cordis.patch.yml', import.meta.url))
const ctx = await boot('dsh-session-control-snapshot', rootConfigPath, [
  ...loadOverlayPatches('dsh-session-control-snapshot', basePatchPath),
  ...loadOverlayPatches('dsh-session-control-snapshot', overlayPath),
])

try {
  const agentId = SessionId('dsh-session-control-snapshot')
  const session = ctx.sessions.create(agentId, { meta: { cwd: process.cwd() } })
  const agent: Agent = {
    ctx: new Context(),
    id: agentId,
    options: {},
    model: unsupportedModel(),
    session,
    inbox: {
      nextTurn: [],
      nextStep: [],
      clear() {},
      append() {},
      prepend() {},
      replace() { return false },
      remove() { return false },
      move() { return false },
      splice() { return [] },
    },
    status: 'idle',
    send: () => {},
    followup: () => {},
    continueFromSurface: () => {},
    steer: () => {},
    inject: () => { throw new Error('dsh-session-control snapshot must receive the catalog at the step boundary') },
    cancel: () => {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [], turn: 1, step: 1, signal: new AbortController().signal, modelSelection: { provider: 'snapshot', model: 'snapshot' } },
    () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
  )
  const catalog = decision.kind === 'enter'
    ? decision.messages.find(message => message.role === 'user'
      && message.source.kind === 'skill-catalog')?.content
    : undefined
  const summary = (await ctx.skills.list()).find(skill => skill.name === 'dsh-session-control')
  const result = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: ToolCallId('dsh-session-control-snapshot'), name: 'skill', arguments: JSON.stringify({ name: 'dsh-session-control' }) }],
    signal: new AbortController().signal,
    agent,
  })
  const tools = ctx.tools.schemas().map(schema => schema.name).filter(name => name.startsWith('session_control_')).sort()
  process.stdout.write(`${JSON.stringify({ catalog: catalog ?? null, summary: summary ?? null, tools, result })}\n`)
} finally {
  await ctx.fiber.dispose()
}
