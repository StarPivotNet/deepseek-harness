---
description: "Workspace entity registry (ctx.workspaceRegistry) for hosts choosing, mounting, or debugging durable workspace records and header-validated session membership."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace

English | [中文](README.zh.md)

## Summary

Use this package to keep an ordered, persistent list of project directories and the sessions run in each directory. Hosts can build project sidebars, hide sessions from grouping without deleting their histories, and remove projects without deleting folders, files, or sessions. Re-adding a removed directory creates a fresh project, while sessions whose directories cannot be validated remain ungrouped. Choose it for GUI or host workflows that need durable project grouping; it is invisible to models and adds no prompt or request-context cost, but requires session persistence and storage backends.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Use this package to give the product a project list: named directories the user works in, the sessions that ran in each, a stable order, and a way to hide sessions without losing them or bring them back. The API contracts behind each action live in the implementation section.

### When to use it

Use it when the product shows a persistent workspace surface — a sidebar, session grouping, or automation that names directories and orders them. It is invisible to the model, so it adds no token or request cost. Skip it when there is no grouping surface; nothing else in the harness needs it.

### Setting up

The package takes no configuration of its own; it needs a session store, a session persistence backend, and the storage rows that keep its records. A minimal composition:

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-workspace'
```

With these rows mounted, creating a project shows up in the list immediately and survives a restart; the first start also groups existing sessions by the directory they ran in. If a required peer is missing, the workspace feature stays unavailable until it is mounted.

### Creating and ordering projects

Create a project from any fully qualified directory that exists: filesystem roots such as `C:\` and ordinary directories are valid. Relative paths, Windows drive-relative paths such as `C:work`, missing paths, and files are rejected without creating a project; creating a project for a directory that already has one returns the existing project unchanged. Rename a project at any time, and move it to any position in the list:

```text
// Host consumer code, after the composition above is loaded:
const project = await ctx.workspaceRegistry.create('/path/to/dir', 'My Project')
await project.setTitle('Renamed')
ctx.workspaceRegistry.list() // shows the project, newest first
```

### Grouping sessions under a project

A session joins the project of the directory it runs in: create a session in a project's directory and it appears under that project, newest first. A session can only belong to one project. A session whose directory cannot be validated — no recorded directory, or a moved or deleted folder — cannot join and stays ungrouped.

### Hiding and restoring sessions, and removing projects

Hide a session from the grouping when it should stop appearing there: it disappears from the visible list, while its session, history, and place in the project stay intact. Restore a hidden session when it should appear again: it returns to its recorded position under its project, or to the ungrouped sessions when it belongs to none. Remove a project when it is no longer needed: it leaves the list, and its folder, files, and session histories are never touched — those sessions become ungrouped. Adding the same directory again afterwards starts a fresh project without the old sessions.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the feature and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **One record per canonical path.** `fs.realpath` is the single uniqueness canon: paths are stored canonicalized, so a symlink to an owned directory collides, and uniqueness is string equality of canonical paths.
- **Membership is ownership plus a live cwd fact.** The record's ordered `sessionIds` is the ownership truth; the startup header index validates it, and `sessionIds` filters on read while the next mutation prunes durably.
- **Header-only reads.** Bootstrap and attach validation read `SessionHeader` fields only; event bodies are never loaded.
- **Two-write mutations with an explicit marker.** Create and delete persist a `pendingMutation` marker before the record/order pair can diverge, so startup completes exactly the interrupted operation and unmarked divergence fails loud as corruption.
- **Serialized writes.** Registry operations run on one operation chain; entity mutations go through `table.update` on the domain write chain, stamping `updatedAt` and deciding membership at their chain slot.

### API behavior

The API is one small family with two owners: `WorkspaceRegistry` creates, orders, and deletes projects, manages their session accounting, and archives or restores single sessions; the `Workspace` entity exposes the display title, directory status, and the session projection. Per-method contracts live in the code, not this README — see [src/index.ts](src/index.ts) and [src/entity.ts](src/entity.ts).
The API is one small family with two owners: `WorkspaceRegistry` creates, orders, and deletes projects and manages their session accounting; the `Workspace` entity exposes the display title, directory status, and the session projection. Per-method contracts live in the code, not this README — see [src/index.ts](src/index.ts) and [src/entity.ts](src/entity.ts).
- `ctx.workspaceRegistry.create(path, title?)` — canonicalizes `path` via `fs.realpath`, rejects a nonexistent or non-directory path, creates at most one record per canonical path, and prepends a new record to durable workspace order. Repeated calls for that path return the existing workspace without changing its title or its registry-order position; a hidden owner of that path is shown in place as part of the same serialized write. Different paths may share a display title.
- `ctx.workspaceRegistry.get(id)` / `list()` / `resolveByPath(path)` — cache-served lookups. `list()` is synchronous and follows durable registry order; `resolveByPath` is async because it applies the same `realpath` canon and rejects a missing path rather than creating it.
- `ctx.workspaceRegistry.insertBefore(id, before?)` — moves a registered Workspace within durable registry order, DOM-insertBefore-like: before the anchor, or appended when the anchor is omitted. A source or anchor absent from the registry rejects without writing; a self-anchor or move to the current position resolves without writing. The returned id list is the complete committed order.
- `ctx.workspaceRegistry.delete(id)` — removes only the Workspace registration, its durable order entry, its session account, and that id from the hidden set in the same serialized operation. Unknown ids return `false`; a removed record returns `true`. The directory, user files, live Sessions, and persisted session logs are never touched, so those Sessions become Ungrouped. A table-write failure restores the prior order and published entity.
- `Workspace.attachSession(id)` — validates the session's membership home (last `workspace/home`, else header cwd) against the workspace path and prepends a new id. Live logs win; otherwise cold attach inspects persistence without `load`. Unknown sessions, absent/unresolvable/non-directory homes, and mismatches reject without writing. `detachSession` removes only the candidate index entry. `git/worktree` does not change membership.
- `Workspace.insertSessionBefore(id, before?)` — moves an accounted session within the manual order, DOM-insertBefore-like: before the anchor, or appended when the anchor is omitted. A session or anchor absent from the account rejects without writing; a move to the current position resolves without writing. Registry Workspace order never changes.
- `ctx.workspaceRegistry.archiveSession(id)` / `unarchiveSession(id)` / `archivedSessionIds` — the registry-global archive set, layered over workspace accounting: an archived session disappears from grouping surfaces but keeps its session log and its `sessionIds` slot, so unarchive restores its position. Archiving accepts any live or persisted session (accounted or Ungrouped). Unarchive drops an archived id and keeps remaining ids in relative order; a known id that is not archived resolves without writing. Both reject an unknown id. Persistence listing failures propagate as themselves. State written before the field existed parses with an empty set.
- `ctx.workspaceRegistry.hide(id)` / `show(id)` / `hiddenWorkspaceIds` — the registry-global hidden set, layered over registry order: a hidden workspace leaves grouping lists but keeps its `workspaceIds` slot and its `sessionIds` account, so Show restores the prior durable position. Hide and Show return `false` for an unknown id (an idempotent no-op with no write) and `true` for a registered id; an already-hidden Hide or an already-visible Show succeeds without writing. State written before the field existed parses with an empty set.
- `Workspace.sessionIds` — synchronous id-plus-canonical-home membership projection in durable candidate order. Missing headers, invalid homes, and mismatches are filtered; the next workspace mutation prunes them. A medium indexing one session under two workspaces, claiming one primary or additional path from two records, or diverging from durable workspace order rejects at startup.
- `Workspace.folders` — additional canonical directories in durable add order. Never includes the primary `path`.
- `Workspace.addFolder(path)` / `removeFolder(path)` — append or drop one additional existing directory. The primary path cannot be removed. A path already claimed by another workspace rejects. A vanished additional folder can still be removed by its stored spelling.
- `Workspace.status()` — uncached directory check, `'ok' | 'missing-dir'`; a missing directory never mutates the record.
`storageDomain` and `sessionPersistence` are required startup dependencies. An unavailable peer leaves the plugin pending and cannot commit an empty initialized marker. On the first successful start, the registry calls `SessionPersistence.list()` and uses only header `id`, `cwd`, and `createdAt` to group valid historical directories and persist initial order; it never reads event bodies. After the initialized marker, accounted sessions are projected by last `workspace/home` (else header cwd) via non-mutating `inspect`; inspect failure for one session falls back to header cwd and does not abort startup. Each resolution is remembered in the domain state keyed by the persistence artifact revision, so a later boot over an unchanged artifact replays it from memory without reading the log — including the refusal fallback, which would otherwise re-pay a full refused-migration read on every start. Live logs still win over the memory, a changed revision re-inspects, and memories for sessions that left the store are dropped. Later header lookups that lack overlay events keep an already-indexed overlay home. Later cwd-only sessions remain Ungrouped.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `WorkspaceRegistry` service, header index, bootstrap, operation serialization |
| [`src/entity.ts`](src/entity.ts) | Package-private `Workspace` implementation and its single `mutate` write path |
| [`src/spec.ts`](src/spec.ts) | Domain declaration: record schema, registry state, `defineDomain` spec |
| [`src/types.ts`](src/types.ts) | Public `Workspace` interface and `WorkspaceId` brand |
| [`src/paths.ts`](src/paths.ts) | The `realpath` uniqueness canon |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: the entity cache mirrors the durable table |

### Durable shape

The registry opens the `workspace` domain (version 2): a `workspaces` table keyed by `WorkspaceId` plus one global state holding `workspaceIds` (the authoritative display order), `archivedSessionIds`, and the optional `pendingMutation` marker. Records written before `archivedSessionIds` existed parse with an empty set through the schema default. Archiving and unarchiving both rewrite only that global state, so a restore is one filtered write of the same field; unarchive runs no session-existence probe, because dropping an id from the set cannot introduce an unknown one, while archive verifies the session before adding it.

### Lifecycle

On start, the registry opens the domain, completes a marked mutation if one is pending, validates stored state — duplicate paths, duplicate session accounts, and order drift all fail loud — and, when not yet initialized, bootstraps history from persisted headers before writing the initialized marker last, so an interrupted bootstrap resumes safely. A fresh empty registry is real once initialized; it never re-bootstraps.

### Failure and recovery

A create or delete whose second write fails rolls the cache and the prior order back; when both the operation and its rollback fail, the durable marker still names the interrupted operation and the next startup completes or rolls it back. A committed delete whose marker cleanup fails still reports success, and the next startup clears the marker idempotently.

### Invariant

The `workspace-invariant` companion registers the owned relationship: every durable `domain/changed` for the `workspaces` table must name a record the entity cache already holds — a delete is valid only after the registry removed the entity from its cache, so a bypassing write path fails the invariant.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when this package's view is not enough: the subsystem reference is the authoritative feature contract, and the Agent Notes record why projects start from session history and why removal is non-destructive.

- [Workspace subsystem](../../../docs/subsystems/workspace.md) — the feature contract for projects and their sessions, and the generated API for the workspace service.
- [Workspace package map](../README.md) — the group's single package and its repository position.
- [domain KV storage Agent Note](../../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md) — why project records use the domain data form.
- [Workspace UI product-flow Agent Note](../../../.agents/notes/archived/feature/2026-07-25-workspace-ui-product-flow.md) — how the first start builds projects from session history and how the GUI orders them.
- [Workspace registration deletion decision](../../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md) — why removing a project never deletes its folder or sessions.

-----

<a id="model-experience"></a>
## Model Experience

### Workspace records and session accounts

#### What the model sees

Nothing from this package directly. `ctx.workspaceRegistry` still registers no tools and writes no session events. When a session's owning workspace has additional folders, `dsh-sandbox-policy` copies that list into the runtime-context snapshot as `workspace:folders`, and default grep/glob plus instruction/skill discovery reuse the same list.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the project list is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Removal never deletes data** — removing a project leaves its folder, files, and session histories in place; those sessions become ungrouped, and session deletion or folder removal are separate, absent capabilities ([decision](../../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)).
- **A session joins only with a recorded directory** — a session belongs to a project only when its record carries a directory that resolves to the project's path; sessions without one stay ungrouped, and a session from another directory cannot be moved in.
- **External changes are seen late** — if another process deletes or damages a directory, the project reflects it only at the next refresh or restart.
- **Archive and unarchive enforce different session checks** — a restore only drops an id from the archive set, so an entry whose session is gone still unarchives and leaves no unknown referent; a restore of an id that is not archived resolves without writing, while `archiveSession` rejects a session that is neither live nor persisted.
- **Re-adding a directory starts fresh** — after removal, adding the same directory again creates a new project with an empty session list; the old sessions do not come back automatically.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and directions that are not decided. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Open: the `create(path, title?)` title parameter

The `title` parameter has no production caller since the gateway's create-by-name branch was removed; a code TODO proposes dropping the parameter and its `@param` clause together ([note](../../../.agents/notes/archived/simplification/2026-07-31-one-route-to-add-a-workspace.md)).

</details>
