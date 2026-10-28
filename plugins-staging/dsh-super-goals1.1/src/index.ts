/**
 * @dsh-external/dsh-super-goals — host 入口（hybrid：4 工具 + 路由；无 module 级侧作用）。
 * 生命周期：apply 注入 agents/tools/webServer → 建注册表 → ctx.effect 挂路由/工具。
 * 工具绑定根会话，子会话共用根板。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { mountRoutes, BoardRegistry, ROUTE_PREFIX } from './routes.js'
import { registerBoardTools } from './tools.js'
import { StoreOpts } from './store.js'
import { authenticatedWebRoutes, type BrowserRequestGate } from './web-auth.js'
import type { AgentLike, AgentLookup } from './session.js'

export const name = 'dsh-super-goals'
export const inject = ['agents', 'tools', 'webServer'] as const

export interface Config {
  blockOnDrift: boolean
}

export const Config = z.object({
  blockOnDrift: z.boolean().default(true).description('L5 漂移阻断：git 交叉核对不匹配时拒绝发号，直到人在面板处置'),
})

type HostCtx = Context & {
  webServer: {
    register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void
    port?: number
  }
  tools: { register(tool: unknown): void }
  agents: { get(id: string): AgentLike | undefined }
  logger?: { info(msg: string): void; warn(msg: string): void; error(msg: string): void }
}

export function apply(ctx: HostCtx, config: Partial<Config> = {}): void {
  const opts: StoreOpts = { blockOnDrift: config.blockOnDrift ?? true }
  const lookup: AgentLookup = (id) => {
    try { return ctx.agents.get(id) } catch { return undefined }
  }
  const log = (msg: string): void => {
    try { ctx.logger?.info?.('[dsh-super-goals] ' + msg) } catch { /* logger 缺失不致命 */ }
  }
  const registry = new BoardRegistry({ lookup, opts })
  const web = authenticatedWebRoutes(ctx.webServer, () => ctx.get('connection') as BrowserRequestGate | undefined)

  ctx.effect(() => mountRoutes(web, registry), 'dsh-super-goals: routes')
  ctx.effect(() => {
    registerBoardTools(ctx.tools, {
      lookup,
      opts,
      onEvent: registry.onEvent,
      onOpen: (ident, name) => registry.remember(ident, name),
    })
  }, 'dsh-super-goals: tools')

  log('routes ready: ' + ROUTE_PREFIX + ' | blockOnDrift=' + String(opts.blockOnDrift))
}
