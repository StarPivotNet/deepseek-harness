/**
 * 根会话身份：工具只认 exec.agent，沿 parentSession 走到根；子会话共用根板。
 * 落盘 <cwd>/.super-goals/<session>/board.json（cwd = 根会话 header.cwd）。
 */
import { join } from 'node:path'
import { BoardError } from './schema.js'

export const BOARD_REL_DIR = '.super-goals'
export const BOARD_FILE = 'board.json'

export interface AgentLike {
  id: string
  session?: {
    header?: {
      cwd?: string
      parentSession?: string
    }
  }
}

export type AgentLookup = (id: string) => AgentLike | undefined

export interface BoardIdentity {
  rootId: string
  workspace: string
  boardDir: string
  boardFile: string
}

/** 目录名：去掉路径分隔符，其余保持 session id。 */
export function sessionDirName(id: string): string {
  const trimmed = id.trim()
  if (trimmed === '' || trimmed === '.' || trimmed === '..') {
    throw new BoardError('BAD_SESSION', '非法 session id')
  }
  if (/[\\/]/.test(trimmed)) return trimmed.replace(/[^A-Za-z0-9._-]+/g, '_')
  return trimmed
}

export function rootAgentOf(agent: AgentLike, lookup: AgentLookup): AgentLike {
  let current = agent
  const seen = new Set<string>()
  while (true) {
    const parentId = current.session?.header?.parentSession
    if (parentId == null || parentId === '') return current
    if (seen.has(current.id)) throw new BoardError('SESSION_CYCLE', 'parentSession 成环: ' + current.id)
    seen.add(current.id)
    const parent = lookup(parentId)
    if (parent == null) {
      throw new BoardError('NO_ROOT', '根会话未挂载: ' + parentId + '（从 ' + agent.id + ' 上溯）')
    }
    current = parent
  }
}

export function boardIdentityOf(agent: AgentLike, lookup: AgentLookup): BoardIdentity {
  const root = rootAgentOf(agent, lookup)
  const workspace = root.session?.header?.cwd ?? process.cwd()
  const rootId = sessionDirName(root.id)
  const boardDir = join(workspace, BOARD_REL_DIR, rootId)
  return { rootId, workspace, boardDir, boardFile: join(boardDir, BOARD_FILE) }
}

export function identityFromSessionId(sessionId: string, lookup: AgentLookup): BoardIdentity {
  const id = sessionId.trim()
  if (id === '') throw new BoardError('BAD_SESSION', 'sessionId 必填')
  const agent = lookup(id)
  if (agent == null) throw new BoardError('NO_SESSION', 'session 未挂载: ' + id)
  return boardIdentityOf(agent, lookup)
}
