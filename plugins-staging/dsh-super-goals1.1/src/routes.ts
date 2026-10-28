/**
 * HTTP 传输面（host half）：/_dsh/dsh-super-goals/ 前缀路由。
 * 门禁：仅 loopback 对端；变更类 POST 追加同源校验；JSON 体上限 64KB；错误一律 {ok:false,error:{code,message}}。
 * 板身份走 sessionId（沿 parentSession 到根），不再收项目绝对路径。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import { Board, BoardError, EditOp, topoOrder } from './schema.js'
import { PlanStore, StoreOpts } from './store.js'
import { identityFromSessionId, type AgentLookup, type BoardIdentity } from './session.js'

export const ROUTE_PREFIX = '/_dsh/dsh-super-goals'
const MAX_JSON_BODY_BYTES = 64 * 1024

export interface RegistryHost {
  lookup: AgentLookup
  opts: StoreOpts
}

export class BoardRegistry {
  readonly lookup: AgentLookup
  readonly opts: StoreOpts
  readonly subscribers = new Set<(msg: unknown) => void>()
  private remembered = new Map<string, { ident: BoardIdentity; name: string; at: string }>()
  /** PlanStore 广播入口：事件 → 所有 /stream 订阅者。 */
  readonly onEvent = (rootId: string, ev: unknown): void => {
    this.broadcast({ kind: 'event', rootId, event: ev })
  }
  broadcast(msg: unknown): void {
    for (const s of this.subscribers) { try { s(msg) } catch { /* 单订阅者失败不拖垮其他 */ } }
  }
  constructor(host: RegistryHost) {
    this.lookup = host.lookup
    this.opts = host.opts
  }
  identityOf(sessionId: string): BoardIdentity {
    return identityFromSessionId(sessionId, this.lookup)
  }
  open(sessionId: string): PlanStore {
    const ident = this.identityOf(sessionId)
    const store = PlanStore.open(ident, this.opts, this.onEvent)
    this.remember(ident, store.board.plan.name)
    return store
  }
  identities(): BoardIdentity[] {
    return [...this.remembered.values()].map(r => r.ident)
  }
  remember(ident: BoardIdentity, name: string): void {
    const cur = this.remembered.get(ident.boardFile)
    if (cur != null && cur.name === name) return
    this.remembered.set(ident.boardFile, { ident, name, at: new Date().toISOString() })
  }
  sessions(): Record<string, { name: string; at: string; rootId: string }> {
    const out: Record<string, { name: string; at: string; rootId: string }> = {}
    for (const r of this.remembered.values()) {
      out[r.ident.rootId] = { name: r.name, at: r.at, rootId: r.ident.rootId }
    }
    return out
  }
}

function isLoopbackPeer(remote: string | undefined): boolean {
  if (remote == null || remote === '') return false
  if (remote === '::1') return true
  const m = /^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/i.exec(remote)
  if (m != null) return Number(m[1]) === 127
  if (isIP(remote) === 4) return remote.startsWith('127.')
  return false
}

function sameOriginHost(req: Pick<IncomingMessage, 'headers'>): boolean {
  const origin = req.headers.origin
  if (origin == null) return true
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string' || host.trim() === '') return false
  try { return new URL(origin).host.trim().toLowerCase() === host.trim().toLowerCase() } catch { return false }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function sendErr(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { ok: false, error: { code, message } })
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let aborted = false
    req.on('data', (d: Buffer) => {
      if (aborted) return
      size += d.length
      if (size > MAX_JSON_BODY_BYTES) { aborted = true; req.pause(); resolve(null); return }
      chunks.push(d)
    })
    req.on('end', () => {
      if (aborted) return
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        const parsed = text.trim() === '' ? {} : (JSON.parse(text) as unknown)
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) resolve(null)
        else resolve(parsed as Record<string, unknown>)
      } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}

function stationOf(b: Board): string | null {
  const doing = b.nodes.filter(n => n.type === 'task' && n.status === 'doing')
  return doing.length > 0 ? doing[doing.length - 1].id : null
}

function sessionIdOf(u: URL, body?: Record<string, unknown>): string {
  const fromQuery = (u.searchParams.get('sessionId') ?? '').trim()
  if (fromQuery !== '') return fromQuery
  const raw = body?.sessionId
  return typeof raw === 'string' ? raw.trim() : ''
}

function boardErrorStatus(e: BoardError): number {
  if (e.code === 'PLAN_NOT_FOUND') return 404
  if (e.code === 'NO_SESSION') return 409
  return 400
}

export function mountRoutes(
  webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void },
  registry: BoardRegistry,
): () => void {
  const unregister = webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      try {
        if (!isLoopbackPeer(req.socket.remoteAddress)) { sendErr(res, 403, 'FORBIDDEN', '仅限本机访问'); return }
        const u = new URL(req.url ?? '/', 'http://localhost')
        const sub = u.pathname.slice(ROUTE_PREFIX.length) || '/'
        if (req.method === 'GET') {
          if (sub === '/stream') {
            const sessionId = sessionIdOf(u)
            if (sessionId === '') { sendErr(res, 400, 'BAD_SESSION', 'sessionId 必填'); return }
            const ident = registry.identityOf(sessionId)
            res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
            const send = (obj: unknown): void => { try { res.write(JSON.stringify(obj) + '\n') } catch { /* 连接已断 */ } }
            send({ kind: 'hello', sessionId, rootId: ident.rootId, at: new Date().toISOString() })
            const subFn = (msg: unknown): void => {
              const rec = msg as { rootId?: string }
              if (rec.rootId != null && rec.rootId !== ident.rootId) return
              send(msg)
            }
            registry.subscribers.add(subFn)
            const hb = setInterval(() => send({ kind: 'ping', at: new Date().toISOString() }), 15000)
            res.on('close', () => { clearInterval(hb); registry.subscribers.delete(subFn) })
            return
          }
          if (sub === '/state') {
            const sessionId = sessionIdOf(u)
            if (sessionId === '') { sendErr(res, 400, 'BAD_SESSION', 'sessionId 必填'); return }
            const store = registry.open(sessionId)
            const order: Record<string, number> = {}
            for (const [k, v] of topoOrder(store.board)) order[k] = v
            sendJson(res, 200, {
              ok: true, sessionId, rootId: store.rootId, board: store.board, order,
              station: stationOf(store.board), events: store.eventsTail(60),
            })
            return
          }
          if (sub === '/sessions') { sendJson(res, 200, { ok: true, sessions: registry.sessions() }); return }
          sendErr(res, 404, 'NOT_FOUND', '未知路径 ' + sub)
          return
        }
        if (req.method === 'POST') {
          if (!sameOriginHost(req)) { sendErr(res, 403, 'SAME_ORIGIN', '跨站请求被拒绝'); return }
          const body = await readJsonBody(req)
          if (body == null) { sendErr(res, 400, 'BAD_JSON', 'JSON 体缺失或非法（上限 64KB）'); return }
          const sessionId = sessionIdOf(u, body)
          if (sessionId === '') { sendErr(res, 400, 'BAD_SESSION', 'sessionId 必填'); return }
          const store = registry.open(sessionId)
          if (sub === '/unblock') {
            if (store.board.driftBlock == null) { sendJson(res, 200, { ok: true, unblocked: false, rootId: store.rootId }); return }
            store.mutate('human:panel', 'drift_unblocked', { cleared: store.board.driftBlock }, (b) => { b.driftBlock = null })
            sendJson(res, 200, { ok: true, unblocked: true, rootId: store.rootId })
            return
          }
          if (sub === '/edit') {
            const ops = body.ops
            if (!Array.isArray(ops)) { sendErr(res, 400, 'BAD_OPS', 'ops 必须是数组'); return }
            const now = new Date().toISOString()
            const changed = store.mutate('human:panel', 'human_edit', { ops, note: body.note ?? null }, (_b) => {
              store.applyEditOps(ops as EditOp[], now)
            })
            sendJson(res, 200, { ok: true, version: changed.version, changed: changed.nodes.length, rootId: store.rootId })
            return
          }
          sendErr(res, 404, 'NOT_FOUND', '未知路径 ' + sub)
          return
        }
        sendErr(res, 405, 'METHOD', '仅支持 GET/POST')
      } catch (e) {
        if (e instanceof BoardError) sendErr(res, boardErrorStatus(e), e.code, e.message)
        else sendErr(res, 500, 'INTERNAL', e instanceof Error ? e.message : String(e))
      }
    },
  })
  return unregister
}
