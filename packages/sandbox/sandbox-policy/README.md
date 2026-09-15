---
description: "The shared per-call sandbox policy resolver and current model context for users and maintainers composing, configuring, or debugging file-effect policy across enforcing capabilities."
kind: "package-reference"
---

# @deepseek-ai/dsh-sandbox-policy

English | [中文](README.zh.md)

## Summary

Use this package to apply one file-effect policy to every confined bash, filesystem, and terminal call. Deployments choose a default mode and fallback workspace root, while each session can switch modes independently. Session choices survive restart, and all enforcing capabilities use the same mode and workspace for a call. Before each model request, the model receives the effective policy and workspace without an inventory of mounted capabilities.

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

Mount this package in any composition where sandbox-enforcing capabilities run: it owns the deployment default and the per-session overrides those capabilities consume, and it contributes the current policy to the model's runtime-context snapshot.

### When to choose it

Choose it for every composition with confined capabilities (bash, filesystem, terminal) so one policy home keeps them from drifting into different modes or workspace roots. Skip it only when nothing enforces sandbox policy — with no consumers, the resolved policy has no effect.

### Minimal configuration

Load the package with a default mode; the fail-safe default is `read-only`, and a deployment that wants a workspace-writable agent opts into `workspace-write` explicitly.

```yaml
- name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: workspace-write
    workspaceRoot: /absolute/path/to/workspace
```

| Field | Default | Meaning |
|---|---|---|
| `mode` | `read-only` | The deployment default mode a session starts from, validated at load |
| `workspaceRoot` | `process.cwd()` | Absolute fallback root for agentless calls or sessions without a cwd; relative values fail at load. Normal agent calls use the session's immutable cwd |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-sandbox-policy) is the exhaustive source for every accepted field and its JSDoc.

### Switching a session's mode

A session's mode can be switched at runtime through a UI policy control or an explicit switch; the switch is recorded in the session log and takes effect on the session's next confined call. The switch survives restart through replay, and each session keeps its own mode — two sessions never see each other's state. A switched session keeps its immutable workspace cwd as the writable boundary.

### Failures and recovery

An invalid configured mode is rejected when the plugin loads, so a typo fails loud instead of silently changing policy. A session without a cwd, and agentless calls, fall back to the configured workspace root; a call with an approved explicit mode uses that mode for exactly that call.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>
- `mode` — the deployment default `SandboxMode` (`read-only` / `workspace-write` / `danger-full-access`), validated at load. Default `read-only` (fail-safe).
- `workspaceRoot` — the fallback directory `workspace-write` may write under for agentless calls or sessions without a cwd. Default `process.cwd()`, resolved to its absolute filesystem identity either way. A normal agent call uses its session header's immutable `cwd` instead.
- `gitDescribeCacheMs` — milliseconds to reuse a successful `git.describe` snapshot for the same worktree path. Default `500`. `0` disables the cache. Checkout and createBranch always return a fresh snapshot.

This section explains policy resolution, the per-session store, and the model-visible contribution; the observable behavior is fully covered in [Use this package](#use-this-package).

### Resolution precedence
- `ctx.sandboxPolicy.resolve({ session?, mode? })` — resolves one complete per-call policy. An explicit approved mode outranks the session's last `sandbox/mode` event, which outranks `defaultMode`; the session's last `git/worktree` overlay outranks its immutable header `cwd` before becoming `workspaceRoot`, otherwise the configured fallback applies. Additional folders from the owning workspace become `additionalRoots` on the same policy. Canonicalization precedes lexical normalization so `symlink/..` agrees with process working-directory resolution.
- `ctx.sandboxPolicy.defaultMode` / `ctx.sandboxPolicy.workspaceRoot` — the deployment default and fallback root used by `resolve()`.
- `ctx.sandboxPolicy.foldersOf(session)` / `sessionSearchRoots(folders)` — the owning workspace's additional folders plus the existing-directory subset used by default grep/glob.
- `sandbox:policy` — a request-time cache-safe context contribution derived directly from `resolve({ session })`. It states the mode's capability-neutral file-effect contract and the canonical session workspace under `workspace-write`; tool owners retain operation-specific denial and escalation guidance.
- `workspace:folders` — a request-time cache-safe context contribution from `foldersOf(session)`. Empty for a single-folder workspace; otherwise it lists the session current working directory and every additional folder, including vanished ones marked `(missing)`.
- `effectiveSandboxMode(events)` — the pure fold of a session's `sandbox/mode` events (the last switch wins, or `undefined`), used inside `resolve()`.
- `setSandboxMode(session, mode)` — THE write path for a per-session override: appends exactly one `sandbox/mode` event. The switch IS its event; nothing mutates the mode out of band.
- `sessionWorkingDirectory(session)` / `setSessionHome(session, path)` / `setSessionWorktree(session, overlay)` — the last `workspace/home` or `git/worktree` by log time, or the header cwd; THE home write path appends exactly one `workspace/home` event.
- `SANDBOX_MODES` — every mode, for option advertisement and runtime validation.

`resolve({ session, mode })` returns one complete per-call policy: an approved explicit mode outranks the session's last `sandbox/mode` event, which outranks the deployment default. The session's immutable `cwd` supplies the workspace root; otherwise the configured fallback applies. Absolute execution-world spelling is preserved. Enforcing providers canonicalize the root on their own filesystem, so remote `symlink/..` paths are never resolved on the Harness host.

### The per-session store

A runtime switch is one log-only `sandbox/mode` event on the session it applies to — the switch IS its event, and nothing mutates mode state out of band. `effective = explicit grant ?? fold(events) ?? deployment default`, so an override survives restart by replay and two sessions never see each other's state. Workspace identity needs no event: the immutable `SessionHeader.cwd` recorded at creation is the root for every call in that session. The event stays log-only; before each request, the owner contributes the current fact to the full runtime-context snapshot, and the agent loop logs that snapshot as a sourced `user/message`.
A runtime switch is one log-only `sandbox/mode` event on the session it applies to. `effective = explicit grant ?? fold(events) ?? deployment default`, so an override survives restart by replay and two sessions never see each other's state. Birth cwd stays the persistence identity. Tool cwd folds the last `workspace/home` or `git/worktree` overlay. Workspace membership folds only `workspace/home`, else header cwd, so a branch overlay does not change the sidebar group. The events stay log-only; before the next request, the owner contributes the current fact to the full runtime-context snapshot.

### Model-visible text

The `sandbox:policy` contribution states the mode's capability-neutral file-effect contract and the recorded session workspace under `workspace-write`. It does not enumerate mounted capabilities; tool plugins retain operation-specific denial and escalation guidance, approval policy contributes separately to the same snapshot, and plan guidance remains `dsh-plan-mode`'s system section. The optional `./invariant` companion rejects a forged durable `sandbox/mode` event whose value falls outside the closed mode vocabulary.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `SandboxPolicyService`, `Config` schema, policy resolution and context contribution |
| [`src/session-mode.ts`](src/session-mode.ts) | The `sandbox/mode` event, its fold, and the write path |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion: rejects `sandbox/mode` values outside the closed vocabulary |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Start with the subsystem reference for the shared vocabulary, then the seam contract and the cross-family decision.

- [Process sandbox subsystem](../../../docs/subsystems/sandbox.md) — modes, per-call policy, and enforcement semantics.
- [Sandbox seam package](../sandbox/README.md) — the confinement contract every enforcing capability implements.
- [Cross-family file sandbox decision](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md) — why one shared policy home exists.

-----

<a id="model-experience"></a>
## Model Experience

### Current file sandbox policy

#### What the model sees

One `sandbox:policy` contribution in the current runtime-context snapshot for every agent session. It does not enumerate mounted capabilities. Tool plugins retain operation and escalation guidance, approval policy contributes separately to the same snapshot, and plan guidance remains `dsh-plan-mode`'s system section.

##### Read-only

```markdown
Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.
```

##### Workspace-write

```markdown
Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: "<workspace root>". Some platform temporary areas may also be writable.
```

##### Danger-full-access

```markdown
Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.
```

### Multi-folder workspace map

#### What the model sees

When the owning workspace has additional folders, the same runtime-context snapshot also carries `workspace:folders`, independent of the file-sandbox mode.

```markdown
This session's workspace has multiple folders.
Current working directory (relative tool paths resolve here): "<cwd>".
Additional folders in this workspace:
- "<extra>"
These additional folders are part of the same workspace. Use their absolute paths with bash workdir, read/write/edit, grep, and glob. Do not assume the checkout at the current working directory is the only tree.
```

A vanished additional folder stays listed with `(missing)`. A single-folder workspace contributes nothing.

#### Token effect

One concise durable context message on the first request and each effective policy change; unchanged requests add nothing. `workspace-write` carries only the recorded session workspace path; platform-specific temporary paths are summarized without adding host-dependent bytes.
One concise durable context message on the first request and each effective policy or folder-list change; unchanged requests add nothing. `workspace-write` carries only the canonical session workspace path; platform-specific temporary paths are summarized without adding host-dependent bytes. The multi-folder map adds its folder list only while extra folders exist.

#### KV Cache effect

The stable system prompt remains byte-identical across mode changes. A changed full context snapshot is appended after retained history, preserving the prior cached prefix; subsequent unchanged requests reuse that retained snapshot.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the policy surface this package provides. They are current package constraints, not a general sandbox comparison or a task backlog.

- **One primary workspace root per session** — policy resolves the last `workspace/home` or `git/worktree` overlay, else `SessionHeader.cwd`, as the process cwd; extra folders remain the owning workspace folders and appear in `workspace:folders` plus default grep/glob roots.
- **File-effect modes only** — `SandboxMode` governs file effects; network and process policy are outside its vocabulary, so no knob here restricts them.
- **Temporary areas are deliberately summarized** — enforcing backends grant different platform temporary areas, which are selected after policy resolution and therefore cannot be enumerated truthfully in the current context.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
