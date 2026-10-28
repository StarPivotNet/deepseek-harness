# Agent Note: Session rehome and the No Repo workspace

Status: proposed

English | [中文](2026-08-20-session-rehome.zh.md)

## Problem

Web conversations bind to a workspace at create time through the immutable `SessionHeader.cwd`. A user who does not yet know which project the request belongs to must pick a workspace before the first send. After the agent infers the directory, the same conversation cannot change sidebar group or execution root: `attachSession` rejects a cwd mismatch, JSONL identity is the birth cwd, and AGENTS.md / skill / LSP still read the header. Cursor's Agents Window solves the corresponding start with a No Repo group and `move_agent_to_root` on the same chat.

The [Workspace UI product-flow](../../archived/feature/2026-07-25-workspace-ui-product-flow.md) left moving sessions across workspaces and Ungrouped adoption out of that flow. Git worktree overlay already splits execution root from membership, but only for same-repo branch isolation, and it never updates the sidebar account.

## Proposal

Keep birth cwd as the persistence identity. Record the current home as one log-only `workspace/home { path }` event. Tool cwd and the Web list `cwd` follow the effective home. Membership follows last `workspace/home`, else header cwd.

### Effective home

`sessionWorkingDirectory` folds, by log time, the last `workspace/home` or `git/worktree` event, else `SessionHeader.cwd`. A later `git/worktree` after a rehome still isolates a branch inside the new project. A later `workspace/home` covers a previous worktree overlay.

### Membership

`attachSession` validates the live or persisted session's membership home (last `workspace/home`, else header cwd) against the workspace path. The registry session-path index stores that home, not the birth cwd. First-boot grouping still uses header cwd only. After the initialized marker, accounted cold sessions inspect `workspace/home` so a rehomed session stays in its target workspace without being opened. `git/worktree` remains a same-repo overlay and does not change membership.

### Host `session.rehome`

`session.rehome({ sessionId, path })` is the only mutation path. It:

1. Canonicalizes `path`; missing or non-directory fails `workspace-invalid-path`.
2. Refuses the canonical No Repo directory (`session-rehome-no-repo`).
3. Refuses subagent-owned sessions (`agent-busy`).
4. `workspace.create(path)` for an existing directory (idempotent).
5. If the session's membership home (last `workspace/home`, else header cwd) already equals that path and the workspace already accounts it, returns success without appending. A matching `git/worktree` overlay is not this no-op.
6. Otherwise appends `workspace/home`, detaches from any previous workspace account, attaches to the target.

Host `session.create` without `workspaceId`/`cwd` uses the No Repo directory and attaches there. `host.describe.cwd` reports the same default so the UI default project matches.

### No Repo workspace

On workspace-registry start (Web composition), ensure `$DSH_HOME/no-repo` exists as a directory and `create` it with title `No Repo` when that canonical path is unowned. Path identity wins if a different title already owns the path.

Web New Session without an explicit workspace targets that workspace. The resident composer is not inert while the current session is already attached to No Repo.

### Plugin

`@wuxie/dsh-session-rehome` registers `move_agent_to_root({ rootPath })`, which calls `session.rehome` through the host API (or the in-process registry when running in the same composition). Policy: unique registered match from No Repo executes; already on a real project, or several matches, uses `ask_user_question` first. It does not mkdir.

### Consumers that must read effective home

- `dsh-sandbox-policy` `sessionWorkingDirectory` (already the tool-cwd owner for bash/fs)
- `dsh-agent-instructions`
- `dsh-tool-skill` catalog cwd
- `dsh-tool-lsp` session cwd
- Host `session.list` / `host/session-added` `cwd` field (so the client grouping key moves)
- Client list upsert must replace `cwd`, not fill-only

Git checkout continues to use the owning workspace's primary path as the repo root; after rehome that is the new home's workspace.

## Alternatives considered

**Rewrite `SessionHeader.cwd` and move the JSONL file.** Rejected: header identity is the persistence and projection-cache key; a rewrite races live append and HMR adoption.

**Reuse `git/worktree` as the project-move event.** Rejected: that overlay means an isolated checkout of the membership workspace. A project move must change membership.

**Derive grouping only from cwd without an explicit account move.** Rejected: membership is an explicit ledger plus a matching home; cwd-only sessions stay Ungrouped after bootstrap.

**Handoff summary into a new session.** Rejected by the accepted product contract: the same conversation must move.

**Plugin-only sidebar label.** Rejected: tools and AGENTS.md would keep the old root.

## Acceptance criteria

- No Repo directory exists, is registered, and is the omitted-project create target.
- Web can send the first prompt in that workspace without a picker click.
- `session.rehome` moves account + effective home in the current turn; bash/fs/AGENTS.md/skills/LSP follow.
- Rehome to No Repo and rehome of a subagent session fail.
- Plugin asks when leaving a real project or when the target is ambiguous; does not ask on a unique No Repo → registered match.
- JSONL stays under birth cwd.

## Risks

- Inspecting accounted cold logs at workspace-registry start costs I/O; one inspect failure falls back to header cwd instead of aborting startup.
- Client list previously treated `cwd` as immutable fill-only; replacing it is a behavior change that grouping depends on.
- Session-query same-cwd authorization stays on birth cwd in this delivery, so a rehomed session cannot list peers that were born in the new directory. Deferred, not silent expansion of query scope.
