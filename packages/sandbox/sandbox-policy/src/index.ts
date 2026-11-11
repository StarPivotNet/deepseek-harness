/**
 * The sandbox POLICY home (`ctx.sandboxPolicy`): the single owner of the
 * deployment's sandbox fallbacks plus per-session resolution: the file-effect
 * {@link SandboxMode}, the `workspace-write` root, the session's additional
 * workspace folders, the explicit extra writable directories from configuration
 * and live Session registrations, and the override
 * kit (the `sandbox/mode` event, its fold, and its write path; the fold is the
 * `sandboxMode` session-projection unit registered here, while the event and
 * write path come from `./session-mode.ts`).
 * Before each agent request, the owner also contributes the resolved policy and
 * the session's multi-folder workspace map to the cache-safe runtime-context
 * snapshot. The agent loop logs that snapshot as model history, so replay
 * reconstructs the same mode, root, and folder list the enforcing consumers
 * resolve without rewriting the stable system prompt.
 *
 * Enforcing filesystem, one-shot bash, and terminal backends read the SAME
 * resolved policy here. The context describes that policy without inventorying
 * capabilities, while each backend retains its own enforcement dialect and each
 * tool owns its operation-specific denial and escalation guidance. The service
 * reads session state once at each operation boundary; executors and providers
 * remain session-free.
 *
 * @module @deepseek-ai/dsh-sandbox-policy
 */

import { statSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { canonicalPath, SandboxInvalidRootError } from '@deepseek-ai/dsh-sandbox'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { setGitDescribeCacheMs } from './git-worktree.ts'
import { sessionWorkingDirectory } from './session-worktree.ts'

/** Whether a path is usable as an execution-world grant: absolute and free of NUL bytes. */
function isExecutionWorldPath(path: string): boolean {
  return isAbsolute(path) && !path.includes('\0')
}

/**
 * Resolve one workspace-registry folder to its filesystem identity. A stored
 * record may keep a symlinked or lexically unnormalized spelling, and folder
 * membership tests compare resolved paths.
 * @param path - stored absolute folder path from the workspace entity.
 * @returns the canonical absolute path.
 * @throws when the stored path is relative or contains a NUL byte.
 */
function canonicalWorkspaceFolder(path: string): string {
  if (!isExecutionWorldPath(path)) {
    throw new Error('sandbox-policy: workspace folders must be absolute execution-world paths without NUL bytes')
  }
  return resolvePath(canonicalPath(path))
}

/** Filesystem identity of one workspace path for folder membership tests. */
function folderIdentity(path: string): string {
  return isExecutionWorldPath(path) ? resolvePath(canonicalPath(path)) : path
}

/** One additional workspace folder as the model and search tools should see it. */
export interface WorkspaceFolderEntry {
  /** Canonical absolute path of the additional folder. */
  path: string
  /** Whether the stored path currently exists as a directory. */
  missing: boolean
}

/**
 * The session working directory plus additional folders from the owning
 * workspace. Search, instruction, and skill consumers reuse this list so they
 * do not re-implement membership lookup.
 */
export interface SessionWorkspaceFolders {
  /** Absolute process cwd / relative-path root for this session. */
  cwd: string
  /** Additional canonical folders, excluding {@link cwd}. */
  additional: readonly WorkspaceFolderEntry[]
}

/** True when the stored folder is missing or is not a directory. */
function isMissingDirectory(path: string): boolean {
  try {
    return !statSync(path).isDirectory()
  } catch {
    // stat failed: the path (or a prefix) is missing or unreadable.
    return true
  }
}

/**
 * Absolute roots a default grep/glob should search: the session cwd plus
 * additional folders that still exist as directories.
 * @param folders - result of {@link SandboxPolicyService.foldersOf}.
 * @returns cwd first, then existing extra folders in durable order.
 */
export function sessionSearchRoots(folders: SessionWorkspaceFolders): string[] {
  return [folders.cwd, ...folders.additional.filter(folder => !folder.missing).map(folder => folder.path)]
}

/**
 * Render the multi-folder map only when the session has extra folders.
 * @param folders - resolved cwd plus additional workspace folders.
 * @returns empty string for a single-folder workspace.
 */
export function renderWorkspaceFoldersContext(folders: SessionWorkspaceFolders): string {
  if (folders.additional.length === 0) return ''
  const extra = folders.additional.map((folder) => {
    const label = folder.missing ? `${JSON.stringify(folder.path)} (missing)` : JSON.stringify(folder.path)
    return `- ${label}`
  })
  return [
    "This session's workspace has multiple folders.",
    `Current working directory (relative tool paths resolve here): ${JSON.stringify(folders.cwd)}.`,
    'Additional folders in this workspace:',
    ...extra,
    'These additional folders are part of the same workspace. Use their absolute paths with bash workdir, read/write/edit, grep, and glob. Do not assume the checkout at the current working directory is the only tree.',
  ].join('\n')
}

export { SANDBOX_MODES, effectiveSandboxMode, setSandboxMode } from './session-mode.ts'
export {
  effectiveHome, effectiveWorktree, sessionWorkingDirectory, setSessionHome, setSessionWorktree,
  type SessionWorktree,
} from './session-worktree.ts'
export {
  checkoutSessionBranch, createSessionBranch, describeSessionGit, discoverRepoRoot,
  GitWorktreeError, invalidateGitDescribeCache, isValidBranchName, setGitDescribeCacheMs,
  type DescribeSessionGitOptions, type GitBranchEntry, type SessionGitState,
} from './git-worktree.ts'

/**
 * Validate and detach the configured extra writable directories. They stay in
 * their execution-world spelling here: a local host must not canonicalize a
 * remote path. The enforcing host validates each physical directory before granting.
 * @param roots - the configured extra roots, or the empty schema default.
 * @returns a frozen copy, or `undefined` when no extra grant exists.
 */
function resolveAdditionalWritableRoots(roots: readonly string[] | undefined): readonly string[] | undefined {
  if (roots === undefined || roots.length === 0) return undefined
  for (const root of roots) {
    if (!isAbsolute(root) || root.includes('\0')) {
      throw new Error('sandbox-policy: writable directories must be absolute execution-world paths without NUL bytes')
    }
  }
  return Object.freeze([...new Set(roots)])
}

/** Render the policy without claiming which capabilities are mounted. */
function renderPolicyContext(policy: SandboxExecutionPolicy): string {
  switch (policy.mode) {
    case 'read-only':
      return 'Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.'
    case 'workspace-write': {
      const additional = policy.additionalWritableRoots ?? []
      const extra = additional.length === 0
        ? ''
        : ` Additional writable directories: ${JSON.stringify(additional)}. On Windows, these additional grants apply to file tools only, not sandboxed processes.`
      return `Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: ${JSON.stringify(policy.workspaceRoot)}.${extra} Some platform temporary areas may also be writable.`
    }
    case 'danger-full-access':
      return 'Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.'
    /* v8 ignore next 4 -- SandboxMode is a typed same-process closed union; this branch is only the static exhaustiveness guard. */
    default: {
      const mode: never = policy.mode
      throw new Error(`unreachable sandbox mode: ${String(mode)}`)
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sandboxPolicy: SandboxPolicyService
  }
}

/**
 * Plugin config: the deployment's sandbox default. All optional — `Config`
 * supplies the defaults (`mode: 'read-only'` is the fail-safe default; a
 * deployment that wants a workspace-writable agent opts in explicitly). The
 * runner choice is NOT here (it is the `ctx.sandbox` provider's config), nor
 * is any per-family knob: this is the one shared policy home.
 */
export interface Config {
  /** File-sandbox mode a session starts from (default: `read-only`). */
  mode?: SandboxMode
  /**
   * Fallback root for agentless calls and sessions without a cwd (default:
   * `process.cwd()`). Normal agent calls use their session cwd instead.
   */
  workspaceRoot?: string
  /**
   * Milliseconds to reuse a successful `git.describe` snapshot for the same
   * worktree path. Default 500. `0` disables the cache.
   */
  gitDescribeCacheMs?: number
  /**
   * Extra physical absolute directories that `workspace-write` may also write under
   * (default: none). The supervisor names them explicitly; there is no
   * automatic repository or gitfile discovery. Entries are execution-world
   * paths: this service validates absoluteness and detaches the list, while
   * the enforcing host rejects missing, non-directory, or symlinked paths. They grant nothing under
   * `read-only`. Windows process confinement ignores them; harness file tools honor them.
   */
  additionalWritableRoots?: string[]
}

/** Inputs that select the sandbox policy for one capability call. */
export interface SandboxPolicyRequest {
  /** Calling session; its worktree overlay or immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
}

/** The sandbox-mode projection's state schema (state equals the public shape). */
const sandboxModeStateSchema = zod.union([
  zod.literal('read-only'),
  zod.literal('workspace-write'),
  zod.literal('danger-full-access'),
]).nullable()

/**
 * The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment
 * default mode, fallback workspace root, session-scoped directory grants, and
 * request-time policy section. Tool layers call {@link resolve} for each execution so a session's
 * mode log and immutable cwd travel together to every enforcing capability.
 */
export class SandboxPolicyService extends Service {
  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    mode: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('read-only'),
    // No schema default: process.cwd() is resolved in the constructor so the
    // stored root is always absolute regardless of how it was supplied.
    workspaceRoot: z.string(),
    gitDescribeCacheMs: z.number().step(1).min(0).default(500),
    additionalWritableRoots: z.array(z.string()).default([]),
  })

  static inject = ['sessionProjections']

  /** The deployment default mode — the fallback beneath a session override. */
  readonly defaultMode: SandboxMode
  /** The absolute `workspace-write` fallback root for calls without a session cwd. */
  readonly workspaceRoot: string
  /** The frozen extra writable directories shared by every resolved policy, or `undefined` for none. */
  readonly additionalWritableRoots: readonly string[] | undefined
  /** Independently owned grants for each live Session; never restored from its log. */
  private readonly writableRootRegistrations = new WeakMap<Session, Map<symbol, string>>()
  private sandboxModeProjectionHandle!: ProjectionHandle<SandboxMode | null>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'sandboxPolicy')
    // schemastery (static Config) already filled `mode`; the cast records that
    // runtime fact. `workspaceRoot` has NO schema default, so its fallback to
    // the process cwd is real branching, resolved absolute either way.
    this.defaultMode = config.mode as SandboxMode
    // Execution-world spelling is preserved; enforcing providers resolve filesystem identity on their host.
    const configuredRoot = config.workspaceRoot ?? process.cwd()
    if (!isExecutionWorldPath(configuredRoot)) {
      throw new Error('sandbox-policy: workspace root must be an absolute execution-world path without NUL bytes')
    }
    this.workspaceRoot = canonicalWorkspaceFolder(configuredRoot)
    setGitDescribeCacheMs(config.gitDescribeCacheMs as number)
    this.additionalWritableRoots = resolveAdditionalWritableRoots(config.additionalWritableRoots)
  }

  protected async [Service.init](): Promise<void> {
    const ctx = this.ctx
    this.sandboxModeProjectionHandle = await ctx.sessionProjections.register({
      key: 'sandboxMode',
      stateVersion: 1,
      stateSchema: sandboxModeStateSchema,
      init: () => null,
      apply: (state, event) => (event.type === 'sandbox/mode' ? event.data.mode : state),
    })

    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'workspace:folders',
        order: 105,
        text: (context) => {
          const session = context.agent?.session
          return session === undefined ? '' : renderWorkspaceFoldersContext(this.foldersOf(session))
        },
      })
      scope.systemPrompt.context({
        name: 'sandbox:policy',
        order: scope.systemPrompt.getContextOrder('SANDBOX_POLICY'),
        text: (context) => {
          const session = context.agent?.session
          return session === undefined
            ? ''
            : renderPolicyContext(this.resolve({ session }))
        },
      })
    })
  }

  /**
   * Resolve the complete policy for one capability call. An approved explicit
   * mode outranks the session's last `sandbox/mode` event, which outranks the
   * deployment default. A session's last `workspace/home` or `git/worktree`
   * overlay outranks its immutable header cwd as the primary workspace-write
   * boundary; additional
   * folders from the owning workspace join the same allow-list. The configured
   * root is the fallback for agentless calls and sessions without a cwd.
   * Configured extra roots and this Session's active registrations are
   * snapshotted together; existing operations and processes keep their policy.
   * @param request - optional session and approved mode override.
   * @returns the fully resolved per-call mode, primary workspace root, and extra folders.
   * @throws `SandboxInvalidRootError` (`SANDBOX_INVALID_ROOT`) when the session's recorded cwd is
   *   relative or contains a NUL byte.
   */
  resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy {
    const { session } = request
    const workspaceRoot = this.sessionWorkspaceRoot(session)
    const folderRoots = session === undefined
      ? []
      : this.foldersOf(session, workspaceRoot).additional.map(folder => folder.path)
    const registrations = session === undefined ? undefined : this.writableRootRegistrations.get(session)
    const additionalWritableRoots = resolveAdditionalWritableRoots([
      ...folderRoots,
      ...this.additionalWritableRoots ?? [],
      ...registrations?.values() ?? [],
    ])
    return {
      mode: request.mode ?? (session === undefined ? undefined : this.overrideOf(session)) ?? this.defaultMode,
      workspaceRoot,
      ...additionalWritableRoots === undefined ? {} : { additionalWritableRoots },
      ...session === undefined ? {} : { sessionId: session.id },
    }
  }

  /**
   * The session's effective working directory, or the configured root, as the
   * workspace-write boundary. A logged `workspace/home` or `git/worktree` overlay
   * outranks the immutable header cwd.
   * @param session - session whose boundary is resolved, or undefined for agentless calls.
   * @returns the boundary's canonical path, matching the folder identity and search roots derived from it.
   * @throws `SandboxInvalidRootError` when the recorded cwd is relative or contains a NUL byte.
   */
  private sessionWorkspaceRoot(session: Session | undefined): string {
    const cwd = session === undefined ? undefined : sessionWorkingDirectory(session)
    if (cwd === undefined) return this.workspaceRoot
    if (!isExecutionWorldPath(cwd)) {
      throw new SandboxInvalidRootError(cwd, 'the Session working directory must be an absolute execution-world path without NUL bytes', 'sandbox workspace root')
    }
    return canonicalWorkspaceFolder(cwd)
  }

  /**
   * Permit writes under one directory in this Session's future workspace-write
   * operations. The calling context owns the effect; disposal removes only this
   * registration. Other grants to the directory remain effective. Existing
   * operations and persistent processes retain their resolved permissions.
   * Grants are runtime-only and must be registered again after resume or fork.
   * On Windows, only harness file tools honor extra grants; process permissions stay unchanged.
   * @param session - exact live Session receiving the grant; other Sessions and agentless calls are unaffected.
   * @param directory - absolute execution-world path; execution rejects missing, non-directory, or symlinked paths.
   * @returns the exact Cordis effect disposer for this registration.
   * @throws when the directory is relative or contains a NUL byte.
   */
  registerWritableRoot(session: Session, directory: string): () => void {
    resolveAdditionalWritableRoots([directory])
    const dispose = this.ctx.effect(() => {
      let registrations = this.writableRootRegistrations.get(session)
      if (registrations === undefined) {
        registrations = new Map()
        this.writableRootRegistrations.set(session, registrations)
      }
      const key = Symbol()
      registrations.set(key, directory)
      return () => {
        registrations.delete(key)
        if (registrations.size === 0) this.writableRootRegistrations.delete(session)
      }
    }, 'sandboxPolicy.registerWritableRoot()')
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup preserves the exact Cordis effect disposer
    return dispose
  }

  /**
   * The session working directory plus additional folders from the owning
   * workspace. Agentless callers and sessions without a cwd receive the
   * configured fallback as `cwd` and an empty additional list.
   * @param session - session whose workspace folders are requested.
   * @param workspaceRoot - already-resolved primary root; omitted recomputes it.
   * @returns the cwd and extra folders; extra is empty without a registry match.
   */
  foldersOf(session: Session, workspaceRoot?: string): SessionWorkspaceFolders {
    const cwd = workspaceRoot ?? this.sessionWorkspaceRoot(session)
    const registry = this.ctx.get('workspaceRegistry')
    if (registry === undefined) return { cwd, additional: [] }
    const workspace = this.owningWorkspace(registry.list(), session, cwd)
    if (workspace === undefined) return { cwd, additional: [] }
    const extra: WorkspaceFolderEntry[] = []
    const seen = new Set([folderIdentity(cwd)])
    for (const folder of workspace.folders) {
      const root = canonicalWorkspaceFolder(folder)
      if (seen.has(root)) continue
      seen.add(root)
      extra.push({ path: root, missing: isMissingDirectory(root) })
    }
    return { cwd, additional: extra }
  }

  /**
   * The workspace that accounts this session, or the workspace whose primary
   * path equals the resolved session cwd when the session is not yet attached.
   */
  private owningWorkspace(
    workspaces: readonly Workspace[],
    session: Session,
    workspaceRoot: string,
  ): Workspace | undefined {
    for (const workspace of workspaces) {
      if (workspace.sessionIds.includes(session.id)) return workspace
    }
    const primary = folderIdentity(workspaceRoot)
    for (const workspace of workspaces) {
      if (folderIdentity(workspace.path) === primary) return workspace
    }
    return undefined
  }

  /**
   * Read the session override without applying the deployment default.
   * @param session - session whose log supplies the override.
   * @returns the last logged mode, or `undefined` without one.
   */
  overrideOf(session: Session): SandboxMode | undefined {
    return this.sandboxModeProjectionHandle.stateOf(session) ?? undefined
  }
}

export default SandboxPolicyService
