/**
 * 4 个 agent 工具（上下文经济门 7：描述短、能脚本不注册）。
 * 运行时绑定当前根会话：不收 path/project/cwd。子会话共用根板。
 * L1 单发号硬锁 / L2 改图必留 reason / L3 证据门 / L4 git 交叉核对 / L5 漂移阻断。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
// 本地定义 JsonValue：dsh 0.1.5 起 dsh-tools 不再 re-export 该类型（改为从 dsh-util-values 引入），
// 继续 import 会让 host tsc 门禁变红（TS2614）；本地定义等价且不受 dsh 版本漂移影响。
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
import { BoardError, BoardNode, EditOp, readyTasks, topoOrder, transitionOk, moduleTransitionOk, isStatus, unmetDeps } from './schema.js'
import { PlanStore, StoreOpts, EventBroadcast } from './store.js'
import { boardIdentityOf, type AgentLike, type AgentLookup, type BoardIdentity } from './session.js'

type JsonObj = Record<string, JsonValue>
type ToolCtx = { agent?: AgentLike; signal?: AbortSignal }

export const TOOL_NAMES = ['super_goals_map', 'super_goals_edit', 'super_goals_next', 'super_goals_update'] as const

export interface BoardToolHost {
  lookup: AgentLookup
  opts: StoreOpts
  onEvent?: EventBroadcast
  onOpen?: (ident: BoardIdentity, name: string) => void
}

function toJson(x: unknown): JsonObj {
  return JSON.parse(JSON.stringify(x)) as JsonObj
}

function errJson(e: unknown): JsonObj {
  if (e instanceof BoardError) return { ok: false, code: e.code, error: e.message }
  return { ok: false, code: 'TOOL_FAILED', error: e instanceof Error ? e.message : String(e) }
}

function actorOf(ctx: ToolCtx): string {
  return 'agent:' + (ctx.agent?.id ?? 'unknown')
}

function textMap(store: PlanStore): { text: string; station: string | null } {
  const b = store.board
  const order = topoOrder(b)
  const lines: string[] = []
  lines.push('SuperGoals v' + b.version + ' [' + b.plan.name + '] 目标: ' + b.plan.goal)
  const doing = b.nodes.filter(n => n.status === 'doing' && n.type === 'task')
  lines.push('station: ' + (doing.length > 0 ? doing.map(n => '#' + (order.get(n.id) ?? '?') + ' ' + n.id + ' ' + n.title).join('; ') : '(无进行中任务)'))
  lines.push('driftBlock: ' + (b.driftBlock != null ? '⛔ ' + b.driftBlock.reason : '无'))
  const mods = b.nodes.filter(n => n.type === 'module')
  if (mods.length === 0) lines.push('(空板 — 用 super_goals_edit init_board + add_node 建立计划)')
  for (const m of mods) {
    lines.push('[' + m.status + '] ' + m.id + ' ' + m.title)
    for (const t of b.nodes.filter(n => n.type === 'task' && n.parent === m.id)) {
      const ord = order.get(t.id)
      const deps = (t.deps ?? []).map(d => '#' + (order.get(d) ?? '?')).join(',')
      lines.push('  ' + (ord != null ? '#' + ord + ' ' : '') + t.id + ' ' + t.title + ' — ' + t.status + (deps !== '' ? ' (deps ' + deps + ')' : '') + (t.priority != null && t.priority !== 3 ? ' P' + t.priority : ''))
    }
  }
  const station = doing.length > 0 ? doing[doing.length - 1].id : null
  return { text: lines.join('\n'), station }
}

export function registerBoardTools(
  tools: { register(tool: unknown): void },
  host: BoardToolHost,
): void {
  const { lookup, opts, onEvent, onOpen } = host
  const openStore = (ctx: ToolCtx, init?: { name: string; goal: string }): PlanStore => {
    const agent = ctx.agent
    if (agent == null) throw new BoardError('NO_AGENT', 'super_goals_* 必须由会话 agent 调用')
    const ident = boardIdentityOf(agent, lookup)
    const store = init != null ? PlanStore.ensure(ident, opts, init, onEvent) : PlanStore.open(ident, opts, onEvent)
    try { onOpen?.(ident, store.board.plan.name) } catch { /* 记忆失败不阻断工具 */ }
    return store
  }

  tools.register(defineTool({
    name: 'super_goals_map',
    description: 'Read the current session plan board as compact mind-map text (modules/tasks with topo order #N, status, deps) plus station and drift block. Bound to the root session; takes no path. ALWAYS call this first in a new or compacted session before project work.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: String((v as JsonObj).text ?? JSON.stringify(v)) }] },
    execute: async (_args, ctx: ToolCtx) => {
      try {
        const store = openStore(ctx)
        const m = textMap(store)
        return toJson({ ok: true, text: m.text, version: store.board.version, digest: store.board.digest, station: m.station, driftBlock: store.board.driftBlock ?? null, rootId: store.rootId })
      } catch (e) { return errJson(e) }
    },
    timeoutMs: 10_000,
  }))

  tools.register(defineTool({
    name: 'super_goals_edit',
    description: 'Change the session plan board. ops: init_board{name,goal} / add_node / update_node / remove_node / set_deps (JSON). All ops apply at once. reason is mandatory. Takes no path.',
    parameters: {
      ops: { type: 'array', required: true, description: 'EditOp 列表，元素形如 {"op":"add_node","node":{...}} 或 {"op":"init_board","name":"...","goal":"..."}' },
      reason: { type: 'string', required: true, description: '为什么改图（强制，审计留痕）' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    execute: async (args, ctx: ToolCtx) => {
      try {
        const a = args as { ops?: unknown; reason?: unknown }
        if (!Array.isArray(a.ops)) throw new BoardError('BAD_OPS', 'ops 必须是数组')
        const reason = typeof a.reason === 'string' && a.reason.trim() !== '' ? a.reason : null
        if (reason == null) throw new BoardError('REASON_REQUIRED', 'super_goals_edit 必须带 reason（L2 审计留痕）')
        const ops = a.ops as EditOp[]
        const initOp = ops.find(op => op.op === 'init_board') as { name?: unknown; goal?: unknown } | undefined
        const store = openStore(
          ctx,
          initOp != null ? { name: String(initOp.name ?? '未命名计划'), goal: String(initOp.goal ?? '') } : undefined,
        )
        const actor = actorOf(ctx)
        const now = new Date().toISOString()
        store.mutate(actor, 'plan_edit_applied', { reason, ops }, (_b) => { store.applyEditOps(ops, now) })
        const m = textMap(store)
        return toJson({ ok: true, applied: ops.length, status: 'applied', text: m.text, rootId: store.rootId })
      } catch (e) { return errJson(e) }
    },
    timeoutMs: 15_000,
  }))

  tools.register(defineTool({
    name: 'super_goals_next',
    description: 'Issue THE single next ready task (dependency-resolved, priority-sorted): marks it doing and returns its full spec (acceptance, scope, deps). Refuses when a drift block is active (L5) or another task is already doing (L1 single-issue lock). Takes no path.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    execute: async (_args, ctx: ToolCtx) => {
      try {
        const store = openStore(ctx)
        if (store.board.driftBlock != null) {
          throw new BoardError('DRIFT_BLOCKED', '存在未处置漂移警报，super_goals_next 拒绝发号（L5）。人须在面板「解除阻断」: ' + store.board.driftBlock.reason)
        }
        const doing = store.board.nodes.filter(n => n.type === 'task' && n.status === 'doing')
        if (doing.length > 0) {
          throw new BoardError('SINGLE_ISSUE', '已有进行中任务 ' + doing[0].id + '（' + doing[0].title + '）。先 super_goals_update 它为 done/blocked 再取下一个（L1 单发号硬锁）')
        }
        const ready = readyTasks(store.board)
        if (ready.length === 0) {
          const m = textMap(store)
          const waiting = store.board.nodes
            .filter(n => n.type === 'task' && (n.status === 'planned' || n.status === 'ready'))
            .map(t => ({ id: t.id, waitingOn: unmetDeps(store.board, t) }))
            .filter(w => w.waitingOn.length > 0)
            .slice(0, 8)
          const detail = waiting.length > 0
            ? '；仍在等待: ' + waiting.map(w => w.id + ' ← ' + w.waitingOn.join(', ')).join(' · ')
            : ''
          return toJson({ ok: true, issued: null, reason: '没有依赖就绪的任务（全部完成或被阻塞）' + detail, waiting, text: m.text, rootId: store.rootId })
        }
        const task = ready[0]
        const now = new Date().toISOString()
        store.mutate(actorOf(ctx), 'task_issued', { taskId: task.id, title: task.title }, (b) => {
          const n = b.nodes.find(x => x.id === task.id)
          if (n != null) { n.status = 'doing'; n.startedAt = now; n.updatedAt = now }
        })
        const m = textMap(store)
        return toJson({ ok: true, issued: { id: task.id, title: task.title, acceptance: task.acceptance ?? [], scope: task.scope ?? [], deps: task.deps ?? [], note: task.note ?? '' }, text: m.text, rootId: store.rootId })
      } catch (e) { return errJson(e) }
    },
    timeoutMs: 15_000,
  }))

  tools.register(defineTool({
    name: 'super_goals_update',
    description: 'Transition a task status: planned/ready -> doing -> done/blocked (-> planned). Also closes a module container: planned -> done (evidence required) or -> canceled; a module is otherwise satisfied automatically once all its tasks are done/canceled. done REQUIRES evidence (test output/screenshot/file path) — L3 evidence gate. Every change is audited; a git cross-check (L4) runs against the task scope and may raise a drift block. Takes no path.',
    parameters: {
      taskId: { type: 'string', required: true, description: '任务节点 id' },
      status: { type: 'string', required: true, description: 'planned|ready|doing|blocked|done|canceled' },
      evidence: { type: 'array', description: '证据列表（测试输出/截图/文件路径）。done 必填' },
      note: { type: 'string', description: '补充说明' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    execute: async (args, ctx: ToolCtx) => {
      try {
        const a = args as { taskId?: unknown; status?: unknown; evidence?: unknown; note?: unknown }
        const taskId = String(a.taskId ?? '')
        const status = String(a.status ?? '')
        if (!isStatus(status)) throw new BoardError('BAD_STATUS', '非法 status: ' + status)
        const store = openStore(ctx)
        const t = store.boardNode(taskId)
        if (t == null) throw new BoardError('NO_NODE', '节点不存在: ' + taskId)
        if (t.type === 'module') {
          if (!moduleTransitionOk(t.status, status)) throw new BoardError('BAD_TRANSITION', '模块只支持 planned ⇄ done 或 → canceled，不允许 ' + t.status + ' -> ' + status)
        } else if (!transitionOk(t.status, status)) {
          throw new BoardError('BAD_TRANSITION', '不允许 ' + t.status + ' -> ' + status)
        }
        if (status === 'done' && !(Array.isArray(a.evidence) && a.evidence.length > 0)) {
          throw new BoardError('EVIDENCE_REQUIRED', t.type + ' ' + taskId + ' done 必须附证据（L3 证据门）: 测试输出/截图路径/文件路径等')
        }
        const actor = actorOf(ctx)
        const now = new Date().toISOString()
        store.mutate(actor, 'status_changed', { taskId, from: t.status, to: status, note: a.note ?? null }, (b) => {
          const n = b.nodes.find(x => x.id === taskId) as BoardNode | undefined
          if (n == null) throw new BoardError('NO_NODE', '任务不存在: ' + taskId)
          n.status = status
          n.updatedAt = now
          if (status === 'doing' && !n.startedAt) n.startedAt = now
          if (Array.isArray(a.evidence)) n.evidence = a.evidence.map(String)
          if (typeof a.note === 'string' && a.note !== '') n.note = a.note
        })
        const drift = store.driftCheck(taskId, actor)
        const m = textMap(store)
        return toJson({ ok: true, taskId, status, drift, text: m.text, rootId: store.rootId })
      } catch (e) { return errJson(e) }
    },
    timeoutMs: 20_000,
  }))
}
