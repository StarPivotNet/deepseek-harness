/**
 * The workspace domain declaration: record schema and the `defineDomain` spec
 * the registry opens. The zod schema validates the shipped format at the
 * durability boundary and is the direct source of a future RPC wire projection.
 * @module @deepseek-ai/dsh-workspace/src/spec
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from './types.ts'

/** Workspace id schema at the durable boundary; branding has no runtime representation. */
const workspaceId = z.string().transform(value => value as WorkspaceId)

const sessionId = z.string().transform(value => brandString<SessionId>(value))

/**
 * Durable shape of one workspace record. `path` is the `fs.realpath` canon
 * stamped at create and remains the session cwd / primary folder; `folders`
 * is the ordered additional-folder account (defaulted so records written
 * before the field parse unchanged); `sessionIds` is the ordered ownership
 * account (array order is display order); timestamps are ISO-8601 strings.
 */
export const workspaceRecord = z.object({
  path: z.string(),
  title: z.string(),
  folders: z.array(z.string()).default([]),
  sessionIds: z.array(z.string().transform(value => brandString<SessionId>(value))),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored workspace record, inferred from {@link workspaceRecord}. */
export type WorkspaceRecord = z.infer<typeof workspaceRecord>

/**
 * Recoverable two-write mutation marker. The marker is persisted before the
 * record/order pair can diverge, so startup can distinguish an interrupted
 * registry operation from unexplained medium corruption.
 */
const workspacePendingMutation = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('create'), workspaceId }),
  z.object({ operation: z.literal('delete'), workspaceId }),
])

/**
 * One remembered membership-home resolution for one stored session, keyed by
 * the persistence artifact revision it was computed from. `home` records the
 * exact {@link membershipHome} answer — including `undefined` for "no home" —
 * so an unchanged artifact replays from memory instead of a full log read.
 * The value is derived data: dropping or stale-reading it costs one re-inspect.
 */
export const sessionHomeMemory = z.object({
  revision: z.string(),
  home: z.string().optional(),
})

/** One stored session-home memory, inferred from {@link sessionHomeMemory}. */
export type SessionHomeMemory = z.infer<typeof sessionHomeMemory>

/**
 * Durable registry state. `initialized` distinguishes a valid empty registry
 * from one that still needs the header-only history bootstrap;
 * `workspaceIds` is the authoritative display order. `archivedSessionIds` is
 * the registry-global archive set layered over workspace accounting: an
 * archived session keeps its `sessionIds` slot (unarchiving must restore the
 * position), so the set never participates in the one-owner accounting
 * invariant. `pinnedSessionIds` is the registry-global pin set in pin order
 * (most recently pinned first); pinning and archival are mutually
 * exclusive, so archiving drops the session's pin. `hiddenWorkspaceIds` is the registry-global hidden set layered
 * over registry order: a hidden workspace keeps its `workspaceIds` slot and
 * its `sessionIds` account (showing must restore the position), so the set
 * never participates in the one-owner accounting invariant. `sessionHomes`
 * remembers each stored session's membership-home resolution keyed by its
 * persistence artifact revision, so startup replays an unchanged artifact
 * from memory instead of reading and decoding its full log. All three
 * defaulted sets parse records written before the field exists unchanged.
 */
export const workspaceDomainState = z.object({
  initialized: z.boolean(),
  /** First-use Workspace identity, retained after its registration is deleted. */
  defaultWorkspaceId: workspaceId.optional(),
  workspaceIds: z.array(workspaceId),
  archivedSessionIds: z.array(sessionId).default([]),
  pinnedSessionIds: z.array(sessionId).default([]),
  hiddenWorkspaceIds: z.array(workspaceId).default([]),
  pendingMutation: workspacePendingMutation.optional(),
  sessionHomes: z.record(z.string(), sessionHomeMemory).default({}),
})

/** Durable registry state inferred from {@link workspaceDomainState}. */
export type WorkspaceDomainState = z.infer<typeof workspaceDomainState>

/**
 * The workspace domain spec: one `workspaces` table keyed by
 * {@link WorkspaceId} plus the bootstrap/order singleton. The registry opens
 * this through `ctx.storage.domain`; the spec object is the single source of
 * the domain's identity, version, and schemas.
 */
export const workspaceDomainSpec = defineDomain({
  name: 'workspace',
  version: 2,
  global: {
    schema: workspaceDomainState,
    initial: {
      initialized: false,
      workspaceIds: [],
      archivedSessionIds: [],
      pinnedSessionIds: [],
      hiddenWorkspaceIds: [],
      sessionHomes: {},
    },
  },
  tables: { workspaces: domainTable<WorkspaceId, WorkspaceRecord>(workspaceRecord) },
})
